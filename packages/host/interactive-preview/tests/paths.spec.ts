/** Unit coverage for preview path resolution helpers. */

import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { FsError } from '@deepseek-ai/dsh-fs'
import {
  acceptsHtml,
  contentTypeForPath,
  hasTraversalSegments,
  isPreviewEntryPath,
  rawPathname,
  resolvePreviewPath,
} from '../src/paths.ts'

describe('rawPathname', () => {
  it('strips query and fragment without normalizing', () => {
    expect(rawPathname('/app.js?x=1#frag')).toBe('/app.js')
  })
})

describe('isPreviewEntryPath', () => {
  it('matches the grant root and entry basename only', () => {
    expect(isPreviewEntryPath('/', 'index.html')).toBe(true)
    expect(isPreviewEntryPath('/index.html', 'index.html')).toBe(true)
    expect(isPreviewEntryPath('/app.js', 'index.html')).toBe(false)
    expect(isPreviewEntryPath('/../index.html', 'index.html')).toBe(false)
    expect(isPreviewEntryPath('/%E0%A4%A', 'index.html')).toBe(false)
  })
})

describe('hasTraversalSegments', () => {
  it('detects encoded and decoded parent segments', () => {
    expect(hasTraversalSegments('/..%2fsecret')).toBe(true)
    expect(hasTraversalSegments('/../secret')).toBe(true)
    expect(hasTraversalSegments('/%zz')).toBe(false)
    expect(hasTraversalSegments('/safe/file')).toBe(false)
  })
})

describe('acceptsHtml', () => {
  it('matches text/html accept values only', () => {
    expect(acceptsHtml('text/html, */*')).toBe(true)
    expect(acceptsHtml('application/json')).toBe(false)
    expect(acceptsHtml(undefined)).toBe(false)
  })
})

describe('contentTypeForPath', () => {
  it('adds charset for text-like types and falls back to octet-stream', () => {
    expect(contentTypeForPath('app.js', () => 'text/javascript')).toContain('charset=utf-8')
    expect(contentTypeForPath('blob.bin', () => false)).toBe('application/octet-stream')
  })
})

describe('resolvePreviewPath', () => {
  it('resolves files under the app root and rejects traversal', async () => {
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-preview-paths-')))
    try {
      const appDir = join(root, 'app')
      mkdirSync(appDir)
      writeFileSync(join(appDir, 'index.html'), '<html></html>')
      writeFileSync(join(appDir, 'app.js'), 'js')
      writeFileSync(join(root, 'outside.txt'), 'x')

      const ctx = new Context()
      await ctx.plugin(LocalFileSystem, { cwd: root })
      const fs = ctx.fs
      const appRoot = await fs.resolve(appDir, { signal: new AbortController().signal })
      const appRootPath = fs.processPath(appRoot)
      const signal = new AbortController().signal

      const rootResolved = await resolvePreviewPath(fs, appRoot, appRootPath, 'index.html', '/', signal)
      expect(rootResolved.kind).toBe('file')
      if (rootResolved.kind === 'file') {
        expect(fs.processPath(rootResolved.target)).toBe(join(appDir, 'index.html'))
      }
      expect((await resolvePreviewPath(fs, appRoot, appRootPath, 'index.html', '/app.js', signal)).kind)
        .toBe('file')
      expect(await resolvePreviewPath(fs, appRoot, appRootPath, 'index.html', '/..%2foutside.txt', signal))
        .toEqual({ kind: 'traversal' })
      expect(await resolvePreviewPath(fs, appRoot, appRootPath, 'index.html', '/missing.js', signal))
        .toEqual({ kind: 'missing' })

      rmSync(join(appDir, 'index.html'))
      symlinkSync(join(root, 'outside.txt'), join(appDir, 'index.html'))
      expect(await resolvePreviewPath(fs, appRoot, appRootPath, 'index.html', '/', signal))
        .toEqual({ kind: 'traversal' })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('maps FS_NOT_FOUND to missing and propagates permission and resolve failures', async () => {
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-preview-path-resolve-')))
    try {
      const appDir = join(root, 'app')
      mkdirSync(appDir)
      writeFileSync(join(appDir, 'index.html'), '<html></html>')

      const ctx = new Context()
      await ctx.plugin(LocalFileSystem, { cwd: root })
      const fs = ctx.fs
      const appRoot = await fs.resolve(appDir, { signal: new AbortController().signal })
      const appRootPath = fs.processPath(appRoot)
      const signal = new AbortController().signal

      vi.spyOn(fs, 'resolve').mockRejectedValueOnce(new FsError('missing', 'FS_NOT_FOUND'))
      expect(await resolvePreviewPath(fs, appRoot, appRootPath, 'index.html', '/gone.js', signal))
        .toEqual({ kind: 'missing' })

      vi.spyOn(fs, 'resolve').mockRejectedValueOnce(new FsError('denied', 'FS_PERMISSION_DENIED'))
      await expect(resolvePreviewPath(fs, appRoot, appRootPath, 'index.html', '/secret.js', signal))
        .rejects.toMatchObject({ code: 'FS_PERMISSION_DENIED' })

      vi.spyOn(fs, 'resolve').mockRejectedValueOnce(new Error('resolve failed'))
      await expect(resolvePreviewPath(fs, appRoot, appRootPath, 'index.html', '/broken.js', signal))
        .rejects.toThrow('resolve failed')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rethrows when resolve is aborted instead of mapping to missing', async () => {
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-preview-path-abort-')))
    try {
      const appDir = join(root, 'app')
      mkdirSync(appDir)
      writeFileSync(join(appDir, 'index.html'), '<html></html>')

      const ctx = new Context()
      await ctx.plugin(LocalFileSystem, { cwd: root })
      const fs = ctx.fs
      const appRoot = await fs.resolve(appDir, { signal: new AbortController().signal })
      const appRootPath = fs.processPath(appRoot)
      const abort = new AbortController()
      vi.spyOn(fs, 'resolve').mockImplementation((_path, opts) => {
        if (opts?.signal?.aborted) {
          return Promise.reject(new DOMException('aborted', 'AbortError'))
        }
        return new Promise((_resolve, reject) => {
          opts?.signal?.addEventListener('abort', () => { reject(new DOMException('aborted', 'AbortError')) })
        })
      })
      abort.abort()
      await expect(resolvePreviewPath(fs, appRoot, appRootPath, 'index.html', '/slow.js', abort.signal))
        .rejects.toMatchObject({ name: 'AbortError' })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
