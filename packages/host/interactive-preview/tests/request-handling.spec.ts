/** Direct handleRequest behavior for stat and abort paths. */

import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { FsError } from '@deepseek-ai/dsh-fs'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import InteractivePreview from '../src/service.ts'
import { previewInternals, type PreviewGrantState } from './test-internals.ts'

const PARENT_ORIGIN = 'http://127.0.0.1:3000'

let context: Context | undefined
let root: string | undefined

afterEach(async () => {
  vi.restoreAllMocks()
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) rmSync(root, { recursive: true, force: true })
  root = undefined
})

async function bootWithGrant(): Promise<{
  preview: InteractivePreview
  grantState: PreviewGrantState | undefined
  hostAuthority: string
}> {
  root = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-preview-branches-')))
  mkdirSync(join(root, 'app'))
  writeFileSync(join(root, 'app/index.html'), '<html></html>')
  writeFileSync(join(root, 'app/tiny.js'), 'x')
  context = new Context()
  await context.plugin(SessionStore)
  await context.plugin(LocalFileSystem, { cwd: root })
  await context.plugin(InteractivePreview, {
    bindHost: '127.0.0.1',
    hostnameSuffix: 'localhost',
    maxGrants: 8,
    maxAssetBytes: 1024,
    inactivityTimeoutMs: 60_000,
  })
  context.sessions.create(SessionId('branch'), { meta: { cwd: root } })
  const preview = context.interactivePreview
  const grant = await preview.open({
    sessionId: SessionId('branch'),
    path: 'app/index.html',
    parentOrigin: PARENT_ORIGIN,
  })
  const url = new URL(grant.origin)
  return { preview, grantState: previewInternals(preview).grants.get(grant.id), hostAuthority: url.host }
}

function mockResponse(): ServerResponse & {
  destroy: ReturnType<typeof vi.fn>
  writeHead: ReturnType<typeof vi.fn>
  end: ReturnType<typeof vi.fn>
} {
  const destroy = vi.fn()
  const writeHead = vi.fn()
  const end = vi.fn()
  return Object.assign(new EventEmitter(), { destroy, writeHead, end }) as unknown as ServerResponse & {
    destroy: typeof destroy
    writeHead: typeof writeHead
    end: typeof end
  }
}

function mockRequest(hostAuthority: string, urlPath: string): IncomingMessage {
  const req = new EventEmitter() as IncomingMessage
  req.method = 'GET'
  req.url = urlPath
  req.headers = { host: hostAuthority, accept: '*/*' }
  return req
}

describe('handleRequest stat behavior', () => {
  it('returns 404 when stat reports an absent asset', async () => {
    const { preview, grantState, hostAuthority } = await bootWithGrant()
    const internal = previewInternals(preview)
    const originalStat = context!.fs.stat.bind(context!.fs)
    let statCalls = 0
    vi.spyOn(context!.fs, 'stat').mockImplementation(async (target, signal) => {
      statCalls += 1
      if (statCalls >= 2) return undefined
      return await originalStat(target, signal)
    })
    const res = mockResponse()
    await internal.handleRequest(grantState!, mockRequest(hostAuthority, '/tiny.js'), res)
    expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object))
    expect(res.end).toHaveBeenCalled()
  })

  it('destroys the response when stat fails on an aborted signal', async () => {
    const { preview, grantState, hostAuthority } = await bootWithGrant()
    const internal = previewInternals(preview)
    const originalStat = context!.fs.stat.bind(context!.fs)
    let statCalls = 0
    let statWaiting!: () => void
    const statReady = new Promise<void>((resolve) => { statWaiting = resolve })
    vi.spyOn(context!.fs, 'stat').mockImplementation(async (target, signal) => {
      statCalls += 1
      if (statCalls >= 2) {
        statWaiting()
        await new Promise<void>((_resolve, reject) => {
          if (signal === undefined) throw new Error('expected abort signal')
          signal.addEventListener('abort', () => { reject(new Error('generic')) })
        })
      }
      return await originalStat(target, signal)
    })
    const req = mockRequest(hostAuthority, '/tiny.js')
    const res = mockResponse()
    const pending = internal.handleRequest(grantState!, req, res)
    await statReady
    grantState!.abort.abort()
    await pending
    expect(res.destroy).toHaveBeenCalled()
  })

  it('destroys the response when stat throws AbortError', async () => {
    const { preview, grantState, hostAuthority } = await bootWithGrant()
    const internal = previewInternals(preview)
    const originalStat = context!.fs.stat.bind(context!.fs)
    let statCalls = 0
    vi.spyOn(context!.fs, 'stat').mockImplementation(async (target, signal) => {
      statCalls += 1
      if (statCalls >= 2) {
        throw new DOMException('aborted', 'AbortError')
      }
      return await originalStat(target, signal)
    })
    const res = mockResponse()
    await internal.handleRequest(grantState!, mockRequest(hostAuthority, '/tiny.js'), res)
    expect(res.destroy).toHaveBeenCalled()
  })

  it('rethrows unexpected stat failures', async () => {
    const { preview, grantState, hostAuthority } = await bootWithGrant()
    const internal = previewInternals(preview)
    const originalStat = context!.fs.stat.bind(context!.fs)
    let statCalls = 0
    vi.spyOn(context!.fs, 'stat').mockImplementation(async (target, signal) => {
      statCalls += 1
      if (statCalls >= 2) throw new Error('stat failed')
      return await originalStat(target, signal)
    })
    await expect(internal.handleRequest(
      grantState!,
      mockRequest(hostAuthority, '/tiny.js'),
      mockResponse(),
    )).rejects.toThrow('stat failed')
  })

  it('destroys the response when path resolve aborts without logging a failure', async () => {
    const { preview, grantState, hostAuthority } = await bootWithGrant()
    const internal = previewInternals(preview)
    const warn = vi.spyOn(context!.logger, 'warn')
    vi.spyOn(context!.fs, 'resolve').mockImplementation((_path, opts) => {
      if (opts?.signal?.aborted) {
        return Promise.reject(new DOMException('aborted', 'AbortError'))
      }
      return new Promise((_resolve, reject) => {
        opts?.signal?.addEventListener('abort', () => { reject(new DOMException('aborted', 'AbortError')) })
      })
    })
    const req = mockRequest(hostAuthority, '/tiny.js')
    const res = mockResponse()
    const pending = internal.handleRequest(grantState!, req, res)
    req.emit('aborted')
    await pending
    expect(res.destroy).toHaveBeenCalled()
    expect(res.writeHead).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })

  it('destroys the response when SPA fallback resolve aborts', async () => {
    const { preview, grantState, hostAuthority } = await bootWithGrant()
    const internal = previewInternals(preview)
    const originalResolve = context!.fs.resolve.bind(context!.fs)
    vi.spyOn(context!.fs, 'resolve').mockImplementation(async (path, opts) => {
      if (path === 'missing/route') throw new FsError('missing', 'FS_NOT_FOUND')
      if (path === 'index.html') throw new DOMException('aborted', 'AbortError')
      return await originalResolve(path, opts)
    })
    const req = mockRequest(hostAuthority, '/missing/route')
    req.headers.accept = 'text/html'
    const res = mockResponse()
    await internal.handleRequest(grantState!, req, res)
    expect(res.destroy).toHaveBeenCalled()
    expect(res.writeHead).not.toHaveBeenCalled()
  })

  it('rethrows unexpected SPA fallback resolve failures', async () => {
    const { preview, grantState, hostAuthority } = await bootWithGrant()
    const internal = previewInternals(preview)
    const originalResolve = context!.fs.resolve.bind(context!.fs)
    vi.spyOn(context!.fs, 'resolve').mockImplementation(async (path, opts) => {
      if (path === 'missing/route') throw new FsError('missing', 'FS_NOT_FOUND')
      if (path === 'index.html') throw new Error('fallback resolve failed')
      return await originalResolve(path, opts)
    })
    const req = mockRequest(hostAuthority, '/missing/route')
    req.headers.accept = 'text/html'
    await expect(internal.handleRequest(grantState!, req, mockResponse()))
      .rejects.toThrow('fallback resolve failed')
  })
})
