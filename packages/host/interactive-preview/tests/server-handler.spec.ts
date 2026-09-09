/** Post-listen disposal and pre-grant handler coverage. */

import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Server } from 'node:http'
import * as nodeHttp from 'node:http'
import InteractivePreview, { InteractivePreviewId } from '../src/index.ts'
import { previewInternals } from './test-internals.ts'

const PARENT_ORIGIN = 'http://127.0.0.1:3000'

let context: Context | undefined
let root: string | undefined
let capturedHandler: ((req: nodeHttp.IncomingMessage, res: nodeHttp.ServerResponse) => void) | undefined
let capturedServer: nodeHttp.Server | undefined

vi.mock('node:http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:http')>()
  return {
    ...actual,
    createServer: (...args: Parameters<typeof actual.createServer>) => {
      const handler = args[0]
      if (typeof handler === 'function') capturedHandler = handler
      const server = actual.createServer(...args)
      capturedServer = server
      return server
    },
  }
})

afterEach(async () => {
  vi.restoreAllMocks()
  capturedHandler = undefined
  capturedServer = undefined
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) rmSync(root, { recursive: true, force: true })
  root = undefined
})

async function boot(): Promise<InteractivePreview> {
  root = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-preview-server-')))
  mkdirSync(join(root, 'app'))
  writeFileSync(join(root, 'app/index.html'), '<html></html>')
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
  context.sessions.create(SessionId('srv'), { meta: { cwd: root } })
  return context.interactivePreview
}

function deferListen(): { release: () => void; pending: Promise<void> } {
  let release!: () => void
  const pending = new Promise<void>((resolve) => { release = resolve })
  vi.spyOn(nodeHttp.Server.prototype, 'listen').mockImplementation(function (this: Server, ...args: unknown[]) {
    void pending.then(() => {
      const callback = args[args.length - 1]
      if (typeof callback === 'function') (callback as () => void)()
    })
    return this
  })
  return { release, pending }
}

describe('server handler edge cases', () => {
  it('drops connections when no grant is registered yet', async () => {
    const preview = await boot()
    const { release } = deferListen()
    const openPromise = preview.open({
      sessionId: SessionId('srv'),
      path: 'app/index.html',
      parentOrigin: PARENT_ORIGIN,
    })
    await vi.waitUntil(() => capturedHandler !== undefined && capturedServer !== undefined)
    const destroy = vi.fn()
    const res = new EventEmitter() as nodeHttp.ServerResponse & { destroy: typeof destroy }
    res.destroy = destroy
    capturedHandler!(new EventEmitter() as nodeHttp.IncomingMessage, res)
    expect(destroy).toHaveBeenCalled()
    vi.spyOn(capturedServer!, 'address').mockReturnValue({ port: 49152, address: '127.0.0.1', family: 'IPv4' })
    release()
    await openPromise
  })

  it('closes booting servers when disposed after listen', async () => {
    const preview = await boot()
    const { release } = deferListen()
    const openPromise = preview.open({
      sessionId: SessionId('srv'),
      path: 'app/index.html',
      parentOrigin: PARENT_ORIGIN,
    })
    await vi.waitUntil(() => capturedHandler !== undefined && capturedServer !== undefined)
    vi.spyOn(capturedServer!, 'address').mockReturnValue({ port: 49153, address: '127.0.0.1', family: 'IPv4' })
    await context!.fiber.dispose()
    release()
    await expect(openPromise).rejects.toMatchObject({ code: 'preview-disposed' })
  })

  it('logs runtime server errors after listen', async () => {
    const preview = await boot()
    const errorSpy = vi.spyOn(context!.logger, 'error')
    await preview.open({ sessionId: SessionId('srv'), path: 'app/index.html', parentOrigin: PARENT_ORIGIN })
    expect(capturedServer).toBeDefined()
    capturedServer!.emit('error', new Error('runtime'))
    expect(errorSpy).toHaveBeenCalledWith(expect.objectContaining({ message: 'runtime' }))
  })

  it('ignores unknown grant ids and reports duplicate closes after shutdown completes', async () => {
    const preview = await boot()
    await preview.close(InteractivePreviewId('absent'))
    const grant = await preview.open({ sessionId: SessionId('srv'), path: 'app/index.html', parentOrigin: PARENT_ORIGIN })
    await preview.close(grant.id)
    await preview.close(grant.id)
    expect(previewInternals(preview).grants.has(grant.id)).toBe(false)
  })

  it('maps missing entries to preview-entry-not-found', async () => {
    const preview = await boot()
    await expect(preview.open({
      sessionId: SessionId('srv'),
      path: 'app/missing.html',
      parentOrigin: PARENT_ORIGIN,
    })).rejects.toMatchObject({ code: 'preview-entry-not-found' })
  })

  it('drops in-flight handleRequest when the grant closes before dispatch', async () => {
    const preview = await boot()
    const grant = await preview.open({ sessionId: SessionId('srv'), path: 'app/index.html', parentOrigin: PARENT_ORIGIN })
    const internal = previewInternals(preview)
    const grantState = internal.grants.get(grant.id)!
    grantState.closed = true
    const destroy = vi.fn()
    const res = new EventEmitter() as nodeHttp.ServerResponse & { destroy: typeof destroy }
    res.destroy = destroy
    await internal.handleRequest(grantState, new EventEmitter() as nodeHttp.IncomingMessage, res)
    expect(destroy).toHaveBeenCalled()
  })
})
