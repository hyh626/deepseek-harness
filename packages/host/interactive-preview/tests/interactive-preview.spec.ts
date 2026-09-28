/**
 * Direct service coverage: capability-hostname preview grants over loopback
 * HTTP with Host validation, containment, SPA fallback, limits, and teardown.
 */

import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { request as rawHttpRequest, Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import InteractivePreview, {
  InteractivePreviewId,
} from '../src/index.ts'
import type { Config } from '../src/index.ts'
import type { InteractivePreviewGrant } from '../src/types.ts'
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

function grantEndpoint(grant: InteractivePreviewGrant): { port: number; hostAuthority: string; origin: string } {
  const url = new URL(grant.origin)
  return { port: Number(url.port), hostAuthority: url.host, origin: grant.origin }
}

async function harness(
  options: {
    maxAssetBytes?: number
    inactivityTimeoutMs?: number
    maxGrants?: number
    bindHost?: '127.0.0.1' | '0.0.0.0'
    hostnameSuffix?: string
  } = {},
): Promise<{ preview: InteractivePreview; sessionId: ReturnType<typeof SessionId>; appDir: string }> {
  root = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-interactive-preview-')))
  const appDir = join(root, 'app')
  mkdirSync(appDir)
  writeFileSync(join(appDir, 'index.html'), '<html><body>entry</body></html>')
  writeFileSync(join(appDir, 'page.htm'), '<html><body>htm</body></html>')
  writeFileSync(join(appDir, 'app.js'), 'console.log("js")')
  writeFileSync(join(appDir, 'app.css'), 'body {}')
  writeFileSync(join(appDir, 'icon.svg'), '<svg/>')
  writeFileSync(join(appDir, 'data.json'), '{}')
  writeFileSync(join(appDir, 'app.wasm'), '\0asm')
  writeFileSync(join(appDir, 'font.woff2'), 'woff')
  writeFileSync(join(appDir, 'site.webmanifest'), '{}')
  writeFileSync(join(appDir, 'unknown.bin'), 'BIN')
  writeFileSync(join(root, 'outside-workspace.html'), '<html></html>')

  context = new Context()
  await context.plugin(SessionStore)
  await context.plugin(LocalFileSystem, { cwd: root })
  await context.plugin(InteractivePreview, {
    bindHost: options.bindHost ?? '127.0.0.1',
    hostnameSuffix: options.hostnameSuffix ?? 'localhost',
    maxGrants: options.maxGrants ?? 32,
    maxAssetBytes: options.maxAssetBytes ?? 1024 * 1024,
    inactivityTimeoutMs: options.inactivityTimeoutMs ?? 60_000,
  })

  const sessionId = SessionId('preview-session')
  context.sessions.create(sessionId, { meta: { cwd: root } })

  return { preview: context.interactivePreview, sessionId, appDir }
}

async function openEntry(
  preview: InteractivePreview,
  sessionId: ReturnType<typeof SessionId>,
  path: string,
): Promise<InteractivePreviewGrant> {
  return await preview.open({ sessionId, path, parentOrigin: PARENT_ORIGIN })
}

async function http(
  endpoint: { port: number; hostAuthority: string },
  path: string,
  init: {
    method?: string
    accept?: string
    host?: string
    omitHost?: boolean
  } = {},
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  return await new Promise((resolve, reject) => {
    const headers: Record<string, string> = {}
    if (!init.omitHost) headers.host = init.host ?? endpoint.hostAuthority
    if (init.accept !== undefined) headers.accept = init.accept
    const req = rawHttpRequest({
      hostname: '127.0.0.1',
      port: endpoint.port,
      path,
      method: init.method ?? 'GET',
      headers,
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk) => { chunks.push(chunk as Buffer) })
      res.on('end', () => {
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: init.method === 'HEAD' ? '' : Buffer.concat(chunks).toString('utf8'),
        })
      })
    })
    req.on('error', reject)
    req.end()
  })
}

describe('InteractivePreview.open', () => {
  it('assigns unique capability hostnames and ports for concurrent grants', async () => {
    const { preview, sessionId } = await harness()
    const a = await openEntry(preview, sessionId, 'app/index.html')
    const b = await openEntry(preview, sessionId, 'app/index.html')
    const ea = grantEndpoint(a)
    const eb = grantEndpoint(b)
    expect(ea.port).toBeGreaterThan(0)
    expect(eb.port).toBeGreaterThan(0)
    expect(ea.port).not.toBe(eb.port)
    expect(ea.hostAuthority).not.toBe(eb.hostAuthority)
    expect(a.origin).toMatch(/^http:\/\/[a-f0-9]{32}\.localhost:\d+$/)
    expect(InteractivePreviewId(a.id)).toBe(a.id)
  })

  it('rejects invalid parent origins and non-html entries', async () => {
    const { preview, sessionId } = await harness()
    await expect(preview.open({
      sessionId,
      path: 'app/index.html',
      parentOrigin: 'http://127.0.0.1:3000/path',
    })).rejects.toMatchObject({ code: 'preview-invalid-parent-origin' })
    await expect(openEntry(preview, sessionId, 'app/app.js')).rejects.toMatchObject({
      code: 'preview-entry-not-html',
    })
  })

  it('rejects directory, missing, and .htm entry paths', async () => {
    const { preview, sessionId } = await harness()
    await expect(openEntry(preview, sessionId, 'app')).rejects.toMatchObject({ code: 'preview-entry-not-file' })
    await expect(openEntry(preview, sessionId, 'missing.html')).rejects.toMatchObject({ code: 'preview-entry-not-found' })
    const htm = await openEntry(preview, sessionId, 'app/page.htm')
    const endpoint = grantEndpoint(htm)
    expect((await http(endpoint, '/')).body).toContain('htm')
  })

  it('rejects sessions without cwd and unknown sessions', async () => {
    const { preview } = await harness()
    const noCwd = SessionId('no-cwd')
    context!.sessions.create(noCwd)
    await expect(openEntry(preview, noCwd, 'app/index.html')).rejects.toMatchObject({ code: 'preview-session-no-cwd' })
    await expect(openEntry(preview, SessionId('missing'), 'app/index.html')).rejects.toMatchObject({
      code: 'preview-session-not-found',
    })
  })

  it('rejects open after disposal', async () => {
    const { preview, sessionId } = await harness()
    await context!.fiber.dispose()
    await expect(openEntry(preview, sessionId, 'app/index.html')).rejects.toMatchObject({ code: 'preview-disposed' })
  })
})

describe('Host authority and serving', () => {
  it('requires the exact minted Host authority on every request', async () => {
    const { preview, sessionId } = await harness()
    const grant = await openEntry(preview, sessionId, 'app/index.html')
    const endpoint = grantEndpoint(grant)

    expect((await http(endpoint, '/')).status).toBe(200)
    const wrongHost = await http(endpoint, '/', { host: 'wrong.localhost:1' })
    expect(wrongHost.status).toBe(403)
    expect(wrongHost.headers['content-security-policy']).toBeUndefined()
    expect(String(wrongHost.headers['content-type'] ?? '')).toContain('text/plain')
    expect((await http(endpoint, '/', { omitHost: true })).status).toBe(403)
  })

  it('serves GET and HEAD with security, cache, and MIME headers', async () => {
    const { preview, sessionId } = await harness()
    const endpoint = grantEndpoint(await openEntry(preview, sessionId, 'app/index.html'))

    for (const [path, type] of [
      ['/', 'text/html'],
      ['/app.js', 'javascript'],
      ['/app.css', 'css'],
      ['/icon.svg', 'svg'],
      ['/data.json', 'json'],
      ['/app.wasm', 'wasm'],
      ['/font.woff2', 'font'],
      ['/site.webmanifest', 'manifest'],
      ['/unknown.bin', 'octet-stream'],
    ] as const) {
      const got = await http(endpoint, path, { accept: '*/*' })
      expect(got.status).toBe(200)
      expect(String(got.headers['content-type'] ?? '')).toContain(type)
      const csp = String(got.headers['content-security-policy'] ?? '')
      expect(csp).toContain("base-uri 'self'")
      expect(csp).toContain("object-src 'none'")
      expect(csp).toContain(`frame-ancestors ${PARENT_ORIGIN}`)
      expect(got.headers['cache-control']).toBe('no-store')
      expect(got.headers.vary).toBe('Accept')
    }

    const getJs = await http(endpoint, '/app.js')
    const headJs = await http(endpoint, '/app.js', { method: 'HEAD' })
    expect(headJs.body).toBe('')
    expect(headJs.headers['content-length']).toBe(getJs.headers['content-length'])
    expect(headJs.headers['content-type']).toBe(getJs.headers['content-type'])
  })

  it('preserves query strings and applies SPA fallback via Accept', async () => {
    const { preview, sessionId, appDir } = await harness()
    writeFileSync(join(appDir, 'index.html'), '<html><body>entry?q=</body></html>')
    const endpoint = grantEndpoint(await openEntry(preview, sessionId, 'app/index.html'))

    expect((await http(endpoint, '/missing/route?foo=bar', { accept: 'text/html' })).body).toContain('entry?q=')
    expect((await http(endpoint, '/client/route', { accept: 'text/html' })).body).toContain('entry')
    expect((await http(endpoint, '/missing.png', { accept: 'image/png' })).status).toBe(404)
  })

  it('rejects unsupported methods with Allow, traversal, and symlink escape', async () => {
    const { preview, sessionId, appDir } = await harness()
    writeFileSync(join(root!, 'secret.txt'), 'secret')
    symlinkSync(join(root!, 'secret.txt'), join(appDir, 'link.txt'))
    const endpoint = grantEndpoint(await openEntry(preview, sessionId, 'app/index.html'))

    const post = await http(endpoint, '/app.js', { method: 'POST' })
    expect(post.status).toBe(405)
    expect(post.headers.allow).toBe('GET, HEAD')
    expect((await http(endpoint, '/..%2fsecret.txt')).status).toBe(403)
    expect((await http(endpoint, '/link.txt')).status).toBe(403)
    writeFileSync(join(root!, 'sibling.html'), '<html></html>')
    expect((await http(endpoint, '/../sibling.html')).status).toBe(403)

    writeFileSync(join(root!, 'secret-entry.html'), '<html>secret-entry</html>')
    rmSync(join(appDir, 'index.html'))
    symlinkSync(join(root!, 'secret-entry.html'), join(appDir, 'index.html'))
    const replaced = await http(endpoint, '/')
    expect(replaced.status).toBe(403)
    expect(replaced.body).not.toContain('secret-entry')
    const spaEscape = await http(endpoint, '/missing/route', { accept: 'text/html' })
    expect(spaEscape.status).toBe(403)
    expect(spaEscape.body).not.toContain('secret-entry')
  })

  it('returns 404 when SPA fallback cannot re-resolve the entry', async () => {
    const { preview, sessionId, appDir } = await harness()
    const endpoint = grantEndpoint(await openEntry(preview, sessionId, 'app/index.html'))
    rmSync(join(appDir, 'index.html'))
    expect((await http(endpoint, '/missing/route', { accept: 'text/html' })).status).toBe(404)
    expect((await http(endpoint, '/')).status).toBe(404)
  })

  it('rejects malformed encodings and enforces readBytes overflow', async () => {
    const { preview, sessionId, appDir } = await harness({ maxAssetBytes: 8 })
    writeFileSync(join(appDir, 'big.js'), '0123456789')
    const endpoint = grantEndpoint(await openEntry(preview, sessionId, 'app/index.html'))
    expect((await http(endpoint, '/%E0%A4%A')).status).toBe(403)
    expect((await http(endpoint, '/big.js')).status).toBe(413)
  })

  it('surfaces unexpected fs failures as 500', async () => {
    const { preview, sessionId } = await harness()
    const endpoint = grantEndpoint(await openEntry(preview, sessionId, 'app/index.html'))
    vi.spyOn(context!.fs, 'stat').mockRejectedValueOnce(new Error('fs boom'))
    expect((await http(endpoint, '/app.js')).status).toBe(500)
  })
})

describe('InteractivePreview lifecycle', () => {
  it('expires inactive grants using real time and closes idempotently', async () => {
    const { preview, sessionId } = await harness({ inactivityTimeoutMs: 80 })
    const grant = await openEntry(preview, sessionId, 'app/index.html')
    const endpoint = grantEndpoint(grant)
    expect((await http(endpoint, '/')).status).toBe(200)
    await sleep(150)
    await expect(http(endpoint, '/')).rejects.toThrow()
    await preview.close(grant.id)
    await preview.close(grant.id)
  })

  it('closes every grant server when the plugin fiber disposes', async () => {
    const { preview, sessionId } = await harness()
    const a = grantEndpoint(await openEntry(preview, sessionId, 'app/index.html'))
    const b = grantEndpoint(await openEntry(preview, sessionId, 'app/index.html'))
    expect((await http(a, '/')).status).toBe(200)
    expect((await http(b, '/')).status).toBe(200)
    await context!.fiber.dispose()
    await expect(http(a, '/')).rejects.toThrow()
    await expect(http(b, '/')).rejects.toThrow()
  })

  it('does not leave a grant live when open races disposal', async () => {
    const { preview, sessionId } = await harness()
    const pending = openEntry(preview, sessionId, 'app/index.html')
    await context!.fiber.dispose()
    await expect(pending).rejects.toMatchObject({ code: 'preview-disposed' })
  })

  it('closes grants even when no inactivity timer was scheduled', async () => {
    const { preview, sessionId } = await harness()
    const grant = await openEntry(preview, sessionId, 'app/index.html')
    previewInternals(preview).grants.get(grant.id)!.inactivityTimer = undefined
    await preview.close(grant.id)
    expect(previewInternals(preview).grants.has(grant.id)).toBe(false)
  })

  it('joins concurrent close calls on the same server shutdown', async () => {
    const { preview, sessionId } = await harness()
    const grant = await openEntry(preview, sessionId, 'app/index.html')
    const grantState = previewInternals(preview).grants.get(grant.id)!
    let releaseClose!: () => void
    const closeGate = new Promise<void>((resolve) => { releaseClose = resolve })
    vi.spyOn(grantState.server, 'close').mockImplementation(function (this: typeof grantState.server, cb) {
      void closeGate.then(() => {
        if (typeof cb === 'function') cb()
      })
      return this
    })

    const first = preview.close(grant.id)
    const second = preview.close(grant.id)
    let secondDone = false
    void second.then(() => { secondDone = true })

    await sleep(20)
    expect(secondDone).toBe(false)
    releaseClose()
    await Promise.all([first, second])
    expect(secondDone).toBe(true)
    expect(previewInternals(preview).grants.has(grant.id)).toBe(false)
  })

  it('enforces maxGrants while concurrent opens are blocked on fs resolve', async () => {
    const { preview, sessionId, appDir } = await harness({ maxGrants: 2 })
    writeFileSync(join(appDir, 'other.htm'), '<html>other</html>')
    writeFileSync(join(appDir, 'third.htm'), '<html>third</html>')

    let releaseResolve!: () => void
    const resolveGate = new Promise<void>((resolve) => { releaseResolve = resolve })
    const originalResolve = context!.fs.resolve.bind(context!.fs)
    vi.spyOn(context!.fs, 'resolve').mockImplementation(async (path, opts) => {
      if (path === 'app/index.html' || path === 'app/page.htm' || path === 'app/other.htm') {
        await resolveGate
      }
      return await originalResolve(path, opts)
    })

    const first = openEntry(preview, sessionId, 'app/index.html')
    const second = openEntry(preview, sessionId, 'app/page.htm')
    await sleep(30)
    await expect(openEntry(preview, sessionId, 'app/other.htm')).rejects.toMatchObject({
      code: 'preview-max-grants',
    })
    releaseResolve()
    await Promise.all([first, second])
  })

  it('closes grants when the owning session is disposed', async () => {
    const { preview } = await harness()
    const workspace = root
    if (workspace === undefined) throw new Error('expected workspace after harness')
    let sessionId!: ReturnType<typeof SessionId>
    const fiber = await context!.plugin(Object.assign((inner: Context) => {
      sessionId = inner.sessions.create(SessionId('scoped-preview'), { meta: { cwd: workspace } }).id
    }, { inject: ['sessions'] }))
    const grant = await preview.open({ sessionId, path: 'app/index.html', parentOrigin: PARENT_ORIGIN })
    const endpoint = grantEndpoint(grant)
    expect((await http(endpoint, '/')).status).toBe(200)
    await fiber.dispose()
    await expect(http(endpoint, '/')).rejects.toThrow()
  })

  it('still closes the server when an in-flight handler rejects during shutdown', async () => {
    const { preview, sessionId } = await harness()
    const grant = await openEntry(preview, sessionId, 'app/index.html')
    const endpoint = grantEndpoint(grant)
    const originalStat = context!.fs.stat.bind(context!.fs)
    let statCalls = 0
    vi.spyOn(context!.fs, 'stat').mockImplementation(async (target, signal) => {
      statCalls += 1
      if (statCalls >= 2) {
        await sleep(30)
        throw new Error('stat failed during shutdown')
      }
      return await originalStat(target, signal)
    })
    const pending = http(endpoint, '/app.js').catch((error: unknown) => error)
    await sleep(10)
    await preview.close(grant.id)
    const outcome = await pending
    expect(outcome).toBeInstanceOf(Error)
    await expect(http(endpoint, '/')).rejects.toThrow()
  })

  it('aborts in-flight reads when the grant closes', async () => {
    const { preview, sessionId, appDir } = await harness()
    writeFileSync(join(appDir, 'slow.js'), 'slow')
    const grant = await openEntry(preview, sessionId, 'app/index.html')
    const endpoint = grantEndpoint(grant)
    vi.spyOn(context!.fs, 'readBytes').mockImplementationOnce((_target, signal) => new Promise((_resolve, reject) => {
      if (signal === undefined) throw new Error('expected abort signal')
      signal.addEventListener('abort', () => { reject(new Error('aborted')) })
    }))
    const pending = http(endpoint, '/slow.js')
    await sleep(20)
    await preview.close(grant.id)
    await expect(pending).rejects.toThrow()
  })
})

describe('InteractivePreview config', () => {
  it('applies schema defaults when optional keys are omitted', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(LocalFileSystem, { cwd: process.cwd() })
    await ctx.plugin(InteractivePreview, {} as Config)
    expect(ctx.interactivePreview).toBeDefined()
    await ctx.fiber.dispose()
  })

  it('rejects injected hostname suffix syntax at construction', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(LocalFileSystem, { cwd: process.cwd() })
    await expect(ctx.plugin(InteractivePreview, {
      bindHost: '127.0.0.1',
      hostnameSuffix: 'bad:host',
      maxGrants: 1,
      maxAssetBytes: 1,
      inactivityTimeoutMs: 1,
    })).rejects.toThrow(/hostnameSuffix/)
  })

  it('rejects all-interfaces bind with localhost suffix at construction', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(LocalFileSystem, { cwd: process.cwd() })
    await expect(ctx.plugin(InteractivePreview, {
      bindHost: '0.0.0.0',
      hostnameSuffix: 'localhost',
      maxGrants: 1,
      maxAssetBytes: 1,
      inactivityTimeoutMs: 1,
    })).rejects.toThrow(/0\.0\.0\.0/)
  })

  it('rejects open when the grant cap is reached', async () => {
    const { preview, sessionId } = await harness({ maxGrants: 1 })
    await openEntry(preview, sessionId, 'app/index.html')
    await expect(openEntry(preview, sessionId, 'app/page.htm')).rejects.toMatchObject({
      code: 'preview-max-grants',
    })
  })
})

describe('InteractivePreview remotes', () => {
  it('starts and stops a grant through the Typert remote methods', async () => {
    const { preview, sessionId } = await harness()
    const agent = { id: sessionId } as Agent
    const signal = new AbortController().signal
    const grant = await preview.remoteExportStart(agent, 'app/index.html', PARENT_ORIGIN, signal)
    const endpoint = grantEndpoint(grant)
    expect((await http(endpoint, '/')).status).toBe(200)
    await preview.remoteExportStop(grant.id, signal)
    await expect(http(endpoint, '/')).rejects.toThrow()
    await preview.remoteExportStop(grant.id, signal)
  })

  it('maps InteractivePreviewError to RemoteError on start', async () => {
    const { preview, sessionId } = await harness()
    const agent = { id: sessionId } as Agent
    await expect(preview.remoteExportStart(
      agent,
      'app/missing.html',
      PARENT_ORIGIN,
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'interactive-preview/entry-not-found' })
    await expect(preview.remoteExportStart(
      { id: SessionId('missing') } as Agent,
      'app/index.html',
      PARENT_ORIGIN,
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'interactive-preview/session-not-found' })
    await expect(preview.remoteExportStart(
      agent,
      'app/index.html',
      'not-an-origin',
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'interactive-preview/invalid-parent-origin' })
    await expect(preview.remoteExportStart(
      agent,
      'app/app.js',
      PARENT_ORIGIN,
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'interactive-preview/entry-not-html' })
    await expect(preview.remoteExportStart(
      agent,
      'app',
      PARENT_ORIGIN,
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'interactive-preview/entry-not-file' })
    const outsideRoot = mkdtempSync(join(tmpdir(), 'dsh-preview-remote-outside-'))
    const outside = join(outsideRoot, 'outside.html')
    writeFileSync(outside, '<html></html>')
    try {
      await expect(preview.remoteExportStart(
        agent,
        outside,
        PARENT_ORIGIN,
        new AbortController().signal,
      )).rejects.toMatchObject({ code: 'interactive-preview/outside-workspace' })
    } finally {
      rmSync(outsideRoot, { recursive: true, force: true })
    }
    context!.sessions.create(SessionId('no-cwd'))
    await expect(preview.remoteExportStart(
      { id: SessionId('no-cwd') } as Agent,
      'app/index.html',
      PARENT_ORIGIN,
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'interactive-preview/session-no-cwd' })
  })

  it('maps grant-cap and disposal failures on the remote start path', async () => {
    const { preview, sessionId } = await harness({ maxGrants: 1 })
    const agent = { id: sessionId } as Agent
    const signal = new AbortController().signal
    await preview.remoteExportStart(agent, 'app/index.html', PARENT_ORIGIN, signal)
    await expect(preview.remoteExportStart(agent, 'app/page.htm', PARENT_ORIGIN, signal))
      .rejects.toMatchObject({ code: 'interactive-preview/max-grants' })
    await context!.fiber.dispose()
    await expect(preview.remoteExportStart(agent, 'app/index.html', PARENT_ORIGIN, signal))
      .rejects.toMatchObject({ code: 'interactive-preview/disposed' })
  })

  it('rethrows non-preview failures from remote start', async () => {
    const { preview, sessionId } = await harness()
    vi.spyOn(context!.fs, 'stat').mockRejectedValueOnce(new Error('stat boom'))
    await expect(preview.remoteExportStart(
      { id: sessionId } as Agent,
      'app/index.html',
      PARENT_ORIGIN,
      new AbortController().signal,
    )).rejects.toThrow('stat boom')
  })

  it('rejects an already-aborted remote signal', async () => {
    const { preview, sessionId } = await harness()
    const abort = new AbortController()
    abort.abort()
    await expect(preview.remoteExportStart(
      { id: sessionId } as Agent,
      'app/index.html',
      PARENT_ORIGIN,
      abort.signal,
    )).rejects.toThrow()
    await expect(preview.remoteExportStop(InteractivePreviewId('missing'), abort.signal)).rejects.toThrow()
  })

  it('does not publish a grant when the RPC signal aborts during listen', async () => {
    const { preview, sessionId } = await harness()
    const abort = new AbortController()
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
            abort.abort()
            ;(callback as () => void)()
          },
        ] as never,
      )
    })
    await expect(preview.remoteExportStart(
      { id: sessionId } as Agent,
      'app/index.html',
      PARENT_ORIGIN,
      abort.signal,
    )).rejects.toMatchObject({ name: 'AbortError' })
    expect(previewInternals(preview).grants.size).toBe(0)
  })

  it('closes a grant published after the RPC signal aborted', async () => {
    const { preview, sessionId } = await harness()
    const abort = new AbortController()
    const grants = previewInternals(preview).grants
    const originalSet = grants.set.bind(grants)
    vi.spyOn(grants, 'set').mockImplementation((id, grant) => {
      abort.abort()
      return originalSet(id, grant)
    })
    await expect(preview.open({
      sessionId,
      path: 'app/index.html',
      parentOrigin: PARENT_ORIGIN,
      signal: abort.signal,
    })).rejects.toMatchObject({ name: 'AbortError' })
    expect(grants.size).toBe(0)
  })
})
