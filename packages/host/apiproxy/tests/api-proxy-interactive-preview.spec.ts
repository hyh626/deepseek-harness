import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
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
import InteractivePreview, {
  DEFAULT_BIND_HOST,
  DEFAULT_HOSTNAME_SUFFIX,
  DEFAULT_INACTIVITY_TIMEOUT_MS,
  DEFAULT_MAX_ASSET_BYTES,
  DEFAULT_MAX_GRANTS,
  InteractivePreviewId,
} from '@deepseek-ai/dsh-host-interactive-preview'
import type { RpcRequest, RpcResponse } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import {
  hostStartInteractivePreviewRequestSchema,
  hostStopInteractivePreviewRequestSchema,
} from '@deepseek-ai/dsh-host-apiproxy/api/host.schema'
import { createApiProxy } from '@deepseek-ai/dsh-host-apiproxy'
import { MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'

const PARENT_ORIGIN = 'http://127.0.0.1:3000'

let nextRpc = 1

function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`interactive-preview-${String(nextRpc++)}`), payload }
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

async function harness(options: { withInteractivePreview?: boolean } = {}) {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-apiproxy-interactive-preview-')))
  const appDir = join(root, 'app')
  mkdirSync(appDir)
  writeFileSync(join(appDir, 'index.html'), '<html><body>entry</body></html>')
  writeFileSync(join(root, 'notes.md'), '# notes')

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
  if (options.withInteractivePreview !== false) {
    await ctx.plugin(InteractivePreview, {
      bindHost: DEFAULT_BIND_HOST,
      hostnameSuffix: DEFAULT_HOSTNAME_SUFFIX,
      maxGrants: DEFAULT_MAX_GRANTS,
      maxAssetBytes: DEFAULT_MAX_ASSET_BYTES,
      inactivityTimeoutMs: DEFAULT_INACTIVITY_TIMEOUT_MS,
    })
  }

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
  return { api, ctx, root }
}

async function sessionAt(api: ReturnType<typeof createApiProxy>, root: string): Promise<SessionId> {
  const workspace = expectOk(await api.workspace.create(request({ path: root }))).workspace
  const sessionId = SessionId(`interactive-preview-${String(nextRpc++)}`)
  expectOk(await api.sessions.create(request({ workspaceId: workspace.workspaceId, sessionId })))
  return sessionId
}

describe('host.startInteractivePreview wire schemas', () => {
  it('requires sessionId, path, and parentOrigin', () => {
    expect(hostStartInteractivePreviewRequestSchema.parse({
      sessionId: 's1',
      path: 'app/index.html',
      parentOrigin: PARENT_ORIGIN,
    })).toEqual({
      sessionId: 's1',
      path: 'app/index.html',
      parentOrigin: PARENT_ORIGIN,
    })
    expect(() => hostStartInteractivePreviewRequestSchema.parse({
      sessionId: 's1',
      path: '',
      parentOrigin: PARENT_ORIGIN,
    })).toThrow()
    expect(() => hostStartInteractivePreviewRequestSchema.parse({
      sessionId: 's1',
      path: 'app/index.html',
      parentOrigin: '',
    })).toThrow()
  })
})

describe('host.stopInteractivePreview wire schemas', () => {
  it('requires a branded grant id', () => {
    expect(hostStopInteractivePreviewRequestSchema.parse({
      id: 'grant-1',
    })).toEqual({ id: 'grant-1' })
    expect(() => hostStopInteractivePreviewRequestSchema.parse({})).toThrow()
    expect(() => hostStopInteractivePreviewRequestSchema.parse({ id: '' })).toThrow()
  })
})

describe('host.startInteractivePreview', () => {
  it('mints a grant with id and origin for a session HTML entry', async () => {
    const { api, root } = await harness()
    const sessionId = await sessionAt(api, root)
    const grant = expectOk(await api.host.startInteractivePreview(
      request({ sessionId, path: 'app/index.html', parentOrigin: PARENT_ORIGIN }),
      new AbortController().signal,
    ))
    expect(grant.id).toBeTruthy()
    expect(grant.origin).toMatch(/^http:\/\/[a-f0-9]{32}\.localhost:\d+$/)
  })

  it('maps business failures from the interactive preview service', async () => {
    const { api, root } = await harness()
    const sessionId = await sessionAt(api, root)
    expect((await api.host.startInteractivePreview(
      request({ sessionId, path: 'notes.md', parentOrigin: PARENT_ORIGIN }),
      new AbortController().signal,
    )).result).toMatchObject({ ok: false, error: { code: 'preview-entry-not-html' } })
    expect((await api.host.startInteractivePreview(
      request({ sessionId: SessionId('missing'), path: 'app/index.html', parentOrigin: PARENT_ORIGIN }),
      new AbortController().signal,
    )).result).toMatchObject({ ok: false, error: { code: 'preview-session-not-found' } })
    expect((await api.host.startInteractivePreview(
      request({ sessionId, path: '../outside-workspace.html', parentOrigin: PARENT_ORIGIN }),
      new AbortController().signal,
    )).result).toMatchObject({ ok: false, error: { code: 'preview-outside-workspace' } })
    expect((await api.host.startInteractivePreview(
      request({ sessionId, path: 'app/index.html', parentOrigin: 'not-an-origin' }),
      new AbortController().signal,
    )).result).toMatchObject({ ok: false, error: { code: 'preview-invalid-parent-origin' } })
  })

  it('reports preview-unavailable when the provider is not mounted', async () => {
    const { api, root } = await harness({ withInteractivePreview: false })
    const sessionId = await sessionAt(api, root)
    expect((await api.host.startInteractivePreview(
      request({ sessionId, path: 'app/index.html', parentOrigin: PARENT_ORIGIN }),
      new AbortController().signal,
    )).result).toMatchObject({ ok: false, error: { code: 'preview-unavailable' } })
  })

  it('reports cancellation when the caller aborts before open completes', async () => {
    const { api, root, ctx } = await harness()
    const sessionId = await sessionAt(api, root)
    const abort = new AbortController()
    const originalOpen = ctx.interactivePreview.open.bind(ctx.interactivePreview)
    ctx.interactivePreview.open = async (options) => {
      abort.abort()
      return await originalOpen(options)
    }
    expect((await api.host.startInteractivePreview(
      request({ sessionId, path: 'app/index.html', parentOrigin: PARENT_ORIGIN }),
      abort.signal,
    )).result).toMatchObject({ ok: false, error: { code: 'cancelled' } })
  })
})

describe('host.stopInteractivePreview', () => {
  it('stops a live grant and is idempotent for unknown ids', async () => {
    const { api, root } = await harness()
    const sessionId = await sessionAt(api, root)
    const grant = expectOk(await api.host.startInteractivePreview(
      request({ sessionId, path: 'app/index.html', parentOrigin: PARENT_ORIGIN }),
      new AbortController().signal,
    ))
    expect(expectOk(await api.host.stopInteractivePreview(
      request({ id: grant.id }),
      new AbortController().signal,
    ))).toEqual({ stopped: true })
    expect(expectOk(await api.host.stopInteractivePreview(
      request({ id: grant.id }),
      new AbortController().signal,
    ))).toEqual({ stopped: true })
  })

  it('reports preview-unavailable when the provider is not mounted', async () => {
    const { api } = await harness({ withInteractivePreview: false })
    expect((await api.host.stopInteractivePreview(
      request({ id: InteractivePreviewId('missing') }),
      new AbortController().signal,
    )).result).toMatchObject({ ok: false, error: { code: 'preview-unavailable' } })
  })

  it('reports cancellation when the caller aborts', async () => {
    const { api, root } = await harness()
    const sessionId = await sessionAt(api, root)
    const grant = expectOk(await api.host.startInteractivePreview(
      request({ sessionId, path: 'app/index.html', parentOrigin: PARENT_ORIGIN }),
      new AbortController().signal,
    ))
    const abort = new AbortController()
    abort.abort()
    expect((await api.host.stopInteractivePreview(
      request({ id: grant.id }),
      abort.signal,
    )).result).toMatchObject({ ok: false, error: { code: 'cancelled' } })
  })
})
