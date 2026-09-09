import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentFactory } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import type { RpcRequest, RpcResponse } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { createApiProxy } from '@deepseek-ai/dsh-host-apiproxy'
import { MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64',
)

let nextRpc = 1

function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`preview-${String(nextRpc++)}`), payload }
}

function expectOk<T>(response: RpcResponse<T>): T {
  expect(response.result.ok).toBe(true)
  if (!response.result.ok) throw new Error('unreachable')
  return response.result.value
}

function stubAgent(session: Session): Agent {
  return {
    id: session.id,
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle',
    ctx: new Context(),
    send: () => {},
    followup: () => {},
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' as const }) }),
    inject: () => {},
    cancel() {},
    runMaintenance: job => job(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

async function harness(
  options: {
    root?: string
    previewDocumentMaxBytes?: number
    previewImageMaxBytes?: number
  } = {},
) {
  const root = options.root ?? realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-apiproxy-preview-')))
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend())
  const storageDomain = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', storageDomain)
  ctx.provide('storageDomain', storageDomain)
  ctx.provide('sessionPersistence', { list: () => Promise.resolve([]) } as never)
  await ctx.plugin(WorkspaceRegistry)
  await ctx.plugin(LocalFileSystem, { cwd: root })

  const factory: AgentFactory = {
    async createAgent(_ownerCtx, options) {
      const session = ctx.sessions.create(
        options.sessionId,
        options.meta === undefined ? {} : { meta: options.meta },
      )
      const agent = stubAgent(session)
      const unregister = ctx.agents.register(agent)
      return {
        agent,
        dispose: () => {
          unregister()
          return Promise.resolve()
        },
      }
    },
    async resume() {
      throw new Error('test harness has no persisted sessions')
    },
  }
  ctx.agents.setFactory(factory)
  ctx.provide('directoryPicker', {
    capability: () => ({ kind: 'browse', list: async () => ({ path: root, home: root, crumbs: [], entries: [], truncated: false }), createDirectory: async (path: string, name: string) => `${path}/${name}` }),
  } as never)

  const api = createApiProxy(ctx, {
    defaultModelSelection: () => ({ provider: 'test', model: 'test-model' }),
    cwd: root,
    ...options.previewDocumentMaxBytes === undefined ? {} : { previewDocumentMaxBytes: options.previewDocumentMaxBytes },
    ...options.previewImageMaxBytes === undefined ? {} : { previewImageMaxBytes: options.previewImageMaxBytes },
  })
  return { api, ctx, root }
}

async function sessionAt(api: ReturnType<typeof createApiProxy>, root: string): Promise<SessionId> {
  const workspace = expectOk(await api.workspace.create(request({ path: root }))).workspace
  const sessionId = SessionId(`preview-${String(nextRpc++)}`)
  expectOk(await api.sessions.create(request({ workspaceId: workspace.workspaceId, sessionId })))
  return sessionId
}

describe('host.readPreviewDocument', () => {
  it('reads Markdown and HTML documents from the session workspace', async () => {
    const { api, root } = await harness()
    const sessionId = await sessionAt(api, root)
    writeFileSync(join(root, 'notes.md'), '# Title')
    writeFileSync(join(root, 'page.html'), '<p>Hello</p>')

    expect(expectOk(await api.host.readPreviewDocument(
      request({ sessionId, path: 'notes.md' }),
      new AbortController().signal,
    ))).toEqual({ path: join(root, 'notes.md'), format: 'markdown', content: '# Title' })

    expect(expectOk(await api.host.readPreviewDocument(
      request({ sessionId, path: 'page.html' }),
      new AbortController().signal,
    ))).toEqual({ path: join(root, 'page.html'), format: 'html', content: '<p>Hello</p>' })
  })

  it('rejects paths outside the workspace, directories, unsupported extensions, and missing sessions', async () => {
    const { api, root } = await harness()
    const sessionId = await sessionAt(api, root)
    writeFileSync(join(root, 'inside.md'), 'ok')
    mkdirSync(join(root, 'docs'))

    expect((await api.host.readPreviewDocument(request({ sessionId, path: '../outside.md' }), new AbortController().signal)).result)
      .toMatchObject({ ok: false, error: { code: 'preview-outside-workspace' } })

    expect((await api.host.readPreviewDocument(request({ sessionId, path: 'docs' }), new AbortController().signal)).result)
      .toMatchObject({ ok: false, error: { code: 'preview-not-file' } })

    writeFileSync(join(root, 'notes.txt'), 'plain')
    expect((await api.host.readPreviewDocument(request({ sessionId, path: 'notes.txt' }), new AbortController().signal)).result)
      .toMatchObject({ ok: false, error: { code: 'preview-unsupported-format' } })

    expect((await api.host.readPreviewDocument(request({ sessionId: SessionId('missing'), path: 'inside.md' }), new AbortController().signal)).result)
      .toMatchObject({ ok: false, error: { code: 'session-not-found' } })
  })

  it('rejects symlink escapes and enforces the configured document byte limit', async () => {
    const { api, root } = await harness({ previewDocumentMaxBytes: 8 })
    const sessionId = await sessionAt(api, root)
    const outsideRoot = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-apiproxy-preview-outside-')))
    writeFileSync(join(outsideRoot, 'secret.md'), 'outside')
    symlinkSync(join(outsideRoot, 'secret.md'), join(root, 'escape.md'))

    expect((await api.host.readPreviewDocument(request({ sessionId, path: 'escape.md' }), new AbortController().signal)).result)
      .toMatchObject({ ok: false, error: { code: 'preview-outside-workspace' } })

    writeFileSync(join(root, 'big.md'), '0123456789')
    expect((await api.host.readPreviewDocument(request({ sessionId, path: 'big.md' }), new AbortController().signal)).result)
      .toMatchObject({ ok: false, error: { code: 'preview-too-large' } })
  })

  it('propagates abort as a cancelled RPC error', async () => {
    const { api, root } = await harness()
    const sessionId = await sessionAt(api, root)
    writeFileSync(join(root, 'notes.md'), '# Title')
    const abort = new AbortController()
    const pending = api.host.readPreviewDocument(request({ sessionId, path: 'notes.md' }), abort.signal)
    abort.abort()
    expect((await pending).result).toMatchObject({ ok: false, error: { code: 'cancelled' } })
  })
})

describe('host.readPreviewImage', () => {
  it('reads a contained raster image relative to the document directory', async () => {
    const { api, root } = await harness()
    const sessionId = await sessionAt(api, root)
    mkdirSync(join(root, 'pages'))
    writeFileSync(join(root, 'pages', 'note.md'), '# Doc')
    writeFileSync(join(root, 'pages', 'shot.png'), PNG_1X1)

    expect(expectOk(await api.host.readPreviewImage(
      request({ sessionId, documentPath: 'pages/note.md', source: 'shot.png' }),
      new AbortController().signal,
    ))).toEqual({ mediaType: 'image/png', data: PNG_1X1.toString('base64') })
  })

  it('rejects unsupported media, outside-root sources, and oversize images', async () => {
    const { api, root } = await harness({ previewImageMaxBytes: 4 })
    const sessionId = await sessionAt(api, root)
    writeFileSync(join(root, 'note.md'), '# Doc')
    writeFileSync(join(root, 'shot.png'), PNG_1X1)
    writeFileSync(join(root, 'notes.txt'), 'plain')

    expect((await api.host.readPreviewImage(
      request({ sessionId, documentPath: 'note.md', source: 'notes.txt' }),
      new AbortController().signal,
    )).result).toMatchObject({ ok: false, error: { code: 'preview-unsupported-media' } })

    expect((await api.host.readPreviewImage(
      request({ sessionId, documentPath: 'note.md', source: '../shot.png' }),
      new AbortController().signal,
    )).result).toMatchObject({ ok: false, error: { code: 'preview-outside-workspace' } })

    expect((await api.host.readPreviewImage(
      request({ sessionId, documentPath: 'note.md', source: 'shot.png' }),
      new AbortController().signal,
    )).result).toMatchObject({ ok: false, error: { code: 'preview-too-large' } })
  })
})

describe('host.readPreview without filesystem', () => {
  it('refuses preview reads when the host composition mounts no filesystem', async () => {
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-apiproxy-preview-nofs-')))
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(UserQuestionService)
    await ctx.plugin(Storage)
    ctx.storage.backend.register('memory', new MemoryStorageBackend())
    const storageDomain = new DomainFacility(ctx, { backend: 'memory', routes: {} })
    ctx.storage.mount('domain', storageDomain)
    ctx.provide('storageDomain', storageDomain)
    ctx.provide('sessionPersistence', { list: () => Promise.resolve([]) } as never)
    await ctx.plugin(WorkspaceRegistry)
    ctx.agents.setFactory({
      async createAgent(_ownerCtx, options) {
        const session = ctx.sessions.create(options.sessionId, {})
        const agent = stubAgent(session)
        const unregister = ctx.agents.register(agent)
        return { agent, dispose: () => { unregister(); return Promise.resolve() } }
      },
      async resume() { throw new Error('no resume') },
    })
    ctx.provide('directoryPicker', {
      capability: () => ({
        kind: 'browse',
        list: async () => ({ path: root, home: root, crumbs: [], entries: [], truncated: false }),
        createDirectory: async (path: string, name: string) => `${path}/${name}`,
      }),
    } as never)
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'test', model: 'test-model' }),
      cwd: root,
    })
    const sessionId = SessionId('preview-nofs')
    ctx.sessions.create(sessionId, { meta: { cwd: root } })

    expect((await api.host.readPreviewDocument(request({ sessionId, path: 'x.md' }), new AbortController().signal)).result)
      .toMatchObject({ ok: false, error: { code: 'preview-unavailable' } })
    expect((await api.host.readPreviewImage(
      request({ sessionId, documentPath: 'x.md', source: 'y.png' }),
      new AbortController().signal,
    )).result).toMatchObject({ ok: false, error: { code: 'preview-unavailable' } })
  })
})
