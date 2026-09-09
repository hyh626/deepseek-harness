/** Open-path and filesystem edge behavior for interactive preview. */

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { FsError } from '@deepseek-ai/dsh-fs'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import * as nodeHttp from 'node:http'
import { Server } from 'node:http'
import InteractivePreview from '../src/service.ts'
import { hasTraversalSegments, resolvePreviewPath } from '../src/paths.ts'
import { previewInternals } from './test-internals.ts'

const PARENT_ORIGIN = 'http://127.0.0.1:3000'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  vi.restoreAllMocks()
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) rmSync(root, { recursive: true, force: true })
  root = undefined
})

async function bootWorkspace(): Promise<InteractivePreview> {
  root = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-preview-cov-')))
  const appDir = join(root, 'app')
  mkdirSync(appDir)
  writeFileSync(join(appDir, 'index.html'), '<html>entry</html>')
  writeFileSync(join(appDir, 'index.htm'), '<html>htm</html>')
  writeFileSync(join(appDir, 'tiny.js'), 'x')

  context = new Context()
  await context.plugin(SessionStore)
  await context.plugin(LocalFileSystem, { cwd: root })
  await context.plugin(InteractivePreview, {
    bindHost: '127.0.0.1',
    hostnameSuffix: 'localhost',
    maxGrants: 8,
    maxAssetBytes: 64,
    inactivityTimeoutMs: 60_000,
  })
  return context.interactivePreview
}

async function bootPreview(): Promise<InteractivePreview> {
  const preview = await bootWorkspace()
  context!.sessions.create(SessionId('cov'), { meta: { cwd: root! } })
  return preview
}

function attachSession(id = SessionId('cov')): { sessionId: ReturnType<typeof SessionId>; detach: () => void } {
  const session = context!.sessions.prepare(id, { meta: { cwd: root! } })
  const detach = context!.sessions.enter(session)
  context!.sessions.announce(session)
  return { sessionId: id, detach }
}

describe('resolvePreviewPath edge behavior', () => {
  it('detects encoded traversal variants', async () => {
    expect(hasTraversalSegments('/%2E%2E/secret')).toBe(true)
    const localRoot = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-preview-paths-')))
    try {
      const ctx = new Context()
      await ctx.plugin(LocalFileSystem, { cwd: localRoot })
      const fs = ctx.fs
      const appRoot = await fs.resolve(localRoot, { signal: new AbortController().signal })
      const appRootPath = fs.processPath(appRoot)
      const signal = new AbortController().signal
      expect(await resolvePreviewPath(fs, appRoot, appRootPath, 'index.html', '/%E0%A4%A', signal))
        .toEqual({ kind: 'traversal' })
      expect(await resolvePreviewPath(fs, appRoot, appRootPath, 'index.html', '/index.html', signal))
        .toEqual({ kind: 'missing' })
    } finally {
      rmSync(localRoot, { recursive: true, force: true })
    }
  })
})

describe('InteractivePreview.open edge behavior', () => {
  it('rejects entries outside the session workspace', async () => {
    const preview = await bootPreview()
    const outsideRoot = mkdtempSync(join(tmpdir(), 'dsh-preview-outside-'))
    const outside = join(outsideRoot, 'outside.html')
    writeFileSync(outside, '<html></html>')
    try {
      await expect(preview.open({
        sessionId: SessionId('cov'),
        path: outside,
        parentOrigin: PARENT_ORIGIN,
      })).rejects.toMatchObject({ code: 'preview-outside-workspace' })
    } finally {
      rmSync(outsideRoot, { recursive: true, force: true })
    }
  })

  it('covers readBytes overflow', async () => {
    const preview = await bootPreview()
    const grant = await preview.open({
      sessionId: SessionId('cov'),
      path: 'app/index.html',
      parentOrigin: PARENT_ORIGIN,
    })
    const url = new URL(grant.origin)
    vi.spyOn(context!.fs, 'readBytes').mockRejectedValueOnce(new FsError('too big', 'FS_TOO_LARGE'))
    await new Promise<void>((resolve, reject) => {
      const req = nodeHttp.request({
        hostname: '127.0.0.1',
        port: url.port,
        path: '/tiny.js',
        method: 'GET',
        headers: { host: url.host },
      }, (res) => {
        expect(res.statusCode).toBe(413)
        res.resume()
        res.on('end', () => { resolve() })
      })
      req.on('error', reject)
      req.end()
    })
  })

  it('omits HEAD content-length when stat has no size', async () => {
    const preview = await bootPreview()
    const grant = await preview.open({
      sessionId: SessionId('cov'),
      path: 'app/index.html',
      parentOrigin: PARENT_ORIGIN,
    })
    const url = new URL(grant.origin)
    vi.spyOn(context!.fs, 'stat').mockResolvedValue({ version: 'v' as never, type: 'file' as const })
    await new Promise<void>((resolve, reject) => {
      const req = nodeHttp.request({
        hostname: '127.0.0.1',
        port: url.port,
        path: '/tiny.js',
        method: 'HEAD',
        headers: { host: url.host },
      }, (res) => {
        expect(res.statusCode).toBe(200)
        expect(res.headers['content-length']).toBeUndefined()
        res.resume()
        res.on('end', () => { resolve() })
      })
      req.on('error', reject)
      req.end()
    })
  })

  it('returns 404 when stat reports an absent target', async () => {
    const preview = await bootPreview()
    const grant = await preview.open({
      sessionId: SessionId('cov'),
      path: 'app/index.html',
      parentOrigin: PARENT_ORIGIN,
    })
    const url = new URL(grant.origin)
    const originalStat = context!.fs.stat.bind(context!.fs)
    vi.spyOn(context!.fs, 'stat').mockImplementation(async (target, signal) => {
      if (context!.fs.processPath(target).endsWith('tiny.js')) {
        return undefined
      }
      return await originalStat(target, signal)
    })
    await new Promise<void>((resolve, reject) => {
      const req = nodeHttp.request({
        hostname: '127.0.0.1',
        port: url.port,
        path: '/tiny.js',
        method: 'GET',
        headers: { host: url.host },
      }, (res) => {
        expect(res.statusCode).toBe(404)
        res.resume()
        res.on('end', () => { resolve() })
      })
      req.on('error', reject)
      req.end()
    })
  })

  it('returns 404 for generic read failures', async () => {
    const preview = await bootPreview()
    const grant = await preview.open({
      sessionId: SessionId('cov'),
      path: 'app/index.html',
      parentOrigin: PARENT_ORIGIN,
    })
    const url = new URL(grant.origin)
    vi.spyOn(context!.fs, 'readBytes').mockRejectedValueOnce(new Error('read failed'))
    await new Promise<void>((resolve, reject) => {
      const req = nodeHttp.request({
        hostname: '127.0.0.1',
        port: url.port,
        path: '/tiny.js',
        headers: { host: url.host },
      }, (res) => {
        expect(res.statusCode).toBe(404)
        res.resume()
        res.on('end', () => { resolve() })
      })
      req.on('error', reject)
      req.end()
    })
  })


  it('maps FS_NOT_FOUND during entry resolve to preview-entry-not-found', async () => {
    const preview = await bootPreview()
    const originalResolve = context!.fs.resolve.bind(context!.fs)
    vi.spyOn(context!.fs, 'resolve').mockImplementation(async (path, opts) => {
      if (path === 'app/does-not-exist.html') {
        throw new FsError('missing entry', 'FS_NOT_FOUND')
      }
      return await originalResolve(path, opts)
    })
    await expect(preview.open({
      sessionId: SessionId('cov'),
      path: 'app/does-not-exist.html',
      parentOrigin: PARENT_ORIGIN,
    })).rejects.toMatchObject({ code: 'preview-entry-not-found' })
  })

  it('rethrows non-not-found resolve failures during open', async () => {
    const preview = await bootPreview()
    const originalResolve = context!.fs.resolve.bind(context!.fs)
    vi.spyOn(context!.fs, 'resolve').mockImplementation(async (path, opts) => {
      if (path === 'app/index.html') {
        throw new FsError('broken entry', 'FS_IO_ERROR')
      }
      return await originalResolve(path, opts)
    })
    await expect(preview.open({
      sessionId: SessionId('cov'),
      path: 'app/index.html',
      parentOrigin: PARENT_ORIGIN,
    })).rejects.toMatchObject({ code: 'FS_IO_ERROR' })
  })

  it('maps disposed entry resolve failures to preview-disposed', async () => {
    await bootPreview()
    const originalResolve = context!.fs.resolve.bind(context!.fs)
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    vi.spyOn(context!.fs, 'resolve').mockImplementation(async (path, opts) => {
      if (path === 'app/index.html') {
        await gate
        throw new FsError('broken entry', 'FS_IO_ERROR')
      }
      return await originalResolve(path, opts)
    })
    const pending = context!.interactivePreview.open({
      sessionId: SessionId('cov'),
      path: 'app/index.html',
      parentOrigin: PARENT_ORIGIN,
    })
    await context!.fiber.dispose()
    release()
    await expect(pending).rejects.toMatchObject({ code: 'preview-disposed' })
  })

  it('destroys closed-grant requests and aborted reads', async () => {
    const preview = await bootPreview()
    const grant = await preview.open({
      sessionId: SessionId('cov'),
      path: 'app/index.html',
      parentOrigin: PARENT_ORIGIN,
    })
    const url = new URL(grant.origin)
    await preview.close(grant.id)
    await expect(new Promise<void>((resolve, reject) => {
      const req = nodeHttp.request({
        hostname: '127.0.0.1',
        port: url.port,
        path: '/',
        headers: { host: url.host },
      }, (res) => {
        res.resume()
        res.on('end', () => { resolve() })
      })
      req.on('error', reject)
      req.end()
    })).rejects.toThrow()

    const grant2 = await preview.open({
      sessionId: SessionId('cov'),
      path: 'app/index.html',
      parentOrigin: PARENT_ORIGIN,
    })
    const url2 = new URL(grant2.origin)
    vi.spyOn(context!.fs, 'readBytes').mockImplementationOnce((_target, signal) => new Promise((_resolve, reject) => {
      if (signal === undefined) throw new Error('expected abort signal')
      signal.addEventListener('abort', () => { reject(new Error('aborted')) })
    }))
    const req = nodeHttp.request({
      hostname: '127.0.0.1',
      port: url2.port,
      path: '/tiny.js',
      headers: { host: url2.host },
    })
    const pending = new Promise<void>((resolve, reject) => {
      req.on('error', () => { reject(new Error('aborted')) })
      req.on('response', (res) => {
        res.resume()
        res.on('end', () => { resolve() })
      })
    })
    req.end()
    req.destroy()
    await expect(pending).rejects.toThrow()
  })
})

describe('InteractivePreview session disposal during open', () => {
  it('does not publish a grant when the session disposes during entry resolve', async () => {
    const preview = await bootWorkspace()
    const { sessionId, detach } = attachSession()
    const originalResolve = context!.fs.resolve.bind(context!.fs)
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    vi.spyOn(context!.fs, 'resolve').mockImplementation(async (path, opts) => {
      if (path === 'app/index.html') {
        await gate
        return await originalResolve(path, opts)
      }
      return await originalResolve(path, opts)
    })
    const pending = preview.open({
      sessionId,
      path: 'app/index.html',
      parentOrigin: PARENT_ORIGIN,
    })
    detach()
    release()
    await expect(pending).rejects.toMatchObject({ code: 'preview-session-not-found' })
    expect(previewInternals(preview).grants.size).toBe(0)
  })

  it('does not publish a grant when the session disposes during listen', async () => {
    const preview = await bootWorkspace()
    const { sessionId, detach } = attachSession()
    const originalListen = Server.prototype.listen
    vi.spyOn(Server.prototype, 'listen').mockImplementation(function (this: Server, ...args: unknown[]) {
      const callback = args.at(-1)
      if (typeof callback !== 'function') {
        return originalListen.apply(this, args as never)
      }
      const prefix = args.slice(0, -1)
      return originalListen.apply(
        this,
        [
          ...prefix,
          () => {
            detach()
            ;(callback as () => void)()
          },
        ] as never,
      )
    })
    await expect(preview.open({
      sessionId,
      path: 'app/index.html',
      parentOrigin: PARENT_ORIGIN,
    })).rejects.toMatchObject({ code: 'preview-session-not-found' })
    expect(previewInternals(preview).grants.size).toBe(0)
  })

  it('closes a published grant when the session disposes', async () => {
    const preview = await bootWorkspace()
    const { sessionId, detach } = attachSession()
    const grant = await preview.open({
      sessionId,
      path: 'app/index.html',
      parentOrigin: PARENT_ORIGIN,
    })
    const url = new URL(grant.origin)
    detach()
    await vi.waitFor(() => {
      expect(previewInternals(preview).grants.size).toBe(0)
    })
    await expect(new Promise<void>((resolve, reject) => {
      const req = nodeHttp.request({
        hostname: '127.0.0.1',
        port: url.port,
        path: '/',
        headers: { host: url.host },
      }, (res) => {
        res.resume()
        res.on('end', () => { resolve() })
      })
      req.on('error', reject)
      req.end()
    })).rejects.toThrow()
  })

  it('maps entry stat failures through open abort classification', async () => {
    const preview = await bootPreview()
    vi.spyOn(context!.fs, 'stat').mockRejectedValueOnce(new Error('stat boom'))
    await expect(preview.open({
      sessionId: SessionId('cov'),
      path: 'app/index.html',
      parentOrigin: PARENT_ORIGIN,
    })).rejects.toThrow('stat boom')
  })

  it('maps app-root resolve failures through open abort classification', async () => {
    const preview = await bootPreview()
    const originalResolve = context!.fs.resolve.bind(context!.fs)
    vi.spyOn(context!.fs, 'resolve').mockImplementation(async (path, opts) => {
      const resolved = await originalResolve(path, opts)
      if (context!.fs.processPath(resolved) === join(root!, 'app') && path !== root) {
        throw new Error('app root failed')
      }
      return resolved
    })
    await expect(preview.open({
      sessionId: SessionId('cov'),
      path: 'app/index.html',
      parentOrigin: PARENT_ORIGIN,
    })).rejects.toThrow('app root failed')
  })

  it('aborts an unpublished open when the caller signal fires during resolve', async () => {
    const preview = await bootPreview()
    const abort = new AbortController()
    const originalResolve = context!.fs.resolve.bind(context!.fs)
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    vi.spyOn(context!.fs, 'resolve').mockImplementation(async (path, opts) => {
      if (path === 'app/index.html') {
        await gate
        return await originalResolve(path, opts)
      }
      return await originalResolve(path, opts)
    })
    const pending = preview.open({
      sessionId: SessionId('cov'),
      path: 'app/index.html',
      parentOrigin: PARENT_ORIGIN,
      signal: abort.signal,
    })
    abort.abort()
    release()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(previewInternals(preview).grants.size).toBe(0)
  })
})
