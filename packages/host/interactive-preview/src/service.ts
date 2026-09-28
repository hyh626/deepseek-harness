/**
 * @deepseek-ai/dsh-host-interactive-preview — ephemeral interactive
 * workspace-preview origins: one dedicated HTTP server per grant on a
 * capability hostname, app-root containment through `ctx.fs`, and
 * configurable asset and inactivity limits.
 * @module @deepseek-ai/dsh-host-interactive-preview
 */

import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { basename, dirname, extname } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { FsError, type FsTarget } from '@deepseek-ai/dsh-fs'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import z from '@deepseek-ai/schemastery'
import type {} from 'zod'
import mime from 'mime-types'
import {
  hostAuthority,
  hostHeaderMatches,
  previewOrigin,
  validateHostnameSuffix,
  validateParentOrigin,
  validatePreviewDeployment,
} from './authority.ts'
import { methodNotAllowedHeaders, previewSecurityHeaders, wrongHostHeaders } from './headers.ts'
import { scheduleInactivityTimeout } from './inactivity.ts'
import { rethrowUnlessDisposed } from './open-errors.ts'
import {
  acceptsHtml,
  contentTypeForPath,
  isPreviewEntryPath,
  rawPathname,
  resolvePreviewPath,
} from './paths.ts'
import {
  isActivePreviewGrant,
  previewRequestSignal,
  respondPreviewHandlerFailure,
  wasPreviewRequestAborted,
} from './signals.ts'
import {
  InteractivePreviewError,
  InteractivePreviewId,
} from './types.ts'
import type {
  InteractivePreviewGrant,
  OpenInteractivePreviewOptions,
} from './types.ts'

export * from './types.ts'

/** Services required before preview grants can be minted. */
export const inject = ['sessions', 'fs'] as const

/** Plugin config: bind address, hostname suffix, and per-grant limits. */
export interface Config {
  /** Listen address for every grant server. */
  bindHost: '127.0.0.1' | '0.0.0.0'
  /** DNS suffix appended to each grant capability label (`<capability>.<suffix>`). */
  hostnameSuffix: string
  /** Maximum concurrent live grants for this plugin instance. */
  maxGrants: number
  /** Maximum bytes for one served asset body. */
  maxAssetBytes: number
  /** Milliseconds of authorized-request inactivity before a grant closes. */
  inactivityTimeoutMs: number
}

/** Default bind host: loopback. */
export const DEFAULT_BIND_HOST = '127.0.0.1' as const
/** Default hostname suffix for local grants. */
export const DEFAULT_HOSTNAME_SUFFIX = 'localhost'
/** Default concurrent grant cap. */
export const DEFAULT_MAX_GRANTS = 32
/** Default per-asset limit: 10 MiB. */
export const DEFAULT_MAX_ASSET_BYTES = 10 * 1024 * 1024
/** Default inactivity limit: 30 minutes. */
export const DEFAULT_INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000

const REMOTE_CODES = {
  'preview-session-not-found': 'interactive-preview/session-not-found',
  'preview-session-no-cwd': 'interactive-preview/session-no-cwd',
  'preview-entry-not-found': 'interactive-preview/entry-not-found',
  'preview-entry-not-file': 'interactive-preview/entry-not-file',
  'preview-entry-not-html': 'interactive-preview/entry-not-html',
  'preview-outside-workspace': 'interactive-preview/outside-workspace',
  'preview-invalid-parent-origin': 'interactive-preview/invalid-parent-origin',
  'preview-max-grants': 'interactive-preview/max-grants',
  'preview-disposed': 'interactive-preview/disposed',
} as const

function throwRemote(error: unknown, context: {
  sessionId: SessionId | string
  path: string
  parentOrigin: string
}): never {
  if (error instanceof InteractivePreviewError) {
    const code = REMOTE_CODES[error.code]
    switch (error.code) {
      case 'preview-session-not-found':
      case 'preview-session-no-cwd':
        throw new RemoteError(code, error.message, { sessionId: context.sessionId })
      case 'preview-entry-not-found':
      case 'preview-entry-not-file':
      case 'preview-entry-not-html':
      case 'preview-outside-workspace':
        throw new RemoteError(code, error.message, { path: context.path })
      case 'preview-invalid-parent-origin':
        throw new RemoteError(code, error.message, { parentOrigin: context.parentOrigin })
      case 'preview-max-grants':
      case 'preview-disposed':
        throw new RemoteError(code, error.message, {})
      /* v8 ignore next -- closed error-code exhaustiveness; new codes fail compilation */
      default:
        throw error
    }
  }
  throw error
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    interactivePreview: InteractivePreview
  }
}

interface PendingOpen {
  controller: AbortController
  signal: AbortSignal
  finish: () => void
}

interface GrantState {
  id: InteractivePreviewId
  sessionId: SessionId
  server: Server
  hostAuthority: string
  origin: string
  parentOrigin: string
  appRoot: FsTarget
  appRootPath: string
  entryBaseName: string
  inactivityTimer: ReturnType<typeof setTimeout> | undefined
  closed: boolean
  abort: AbortController
  inFlight: Set<Promise<void>>
  shutdownPromise: Promise<void> | undefined
}

function randomHexLabel(byteLength = 16): string {
  return randomBytes(byteLength).toString('hex')
}

/* v8 ignore start -- closed-union exhaustiveness helper; default branch is compile-time unreachable */
function assertNever(value: never): never {
  throw new Error(`unreachable preview path variant: ${String(value)}`)
}
/* v8 ignore stop */

/**
 * Mint ephemeral capability-hostname preview origins backed by session workspace files.
 */
export default class InteractivePreview extends TypertRemoteService {
  static inject = inject
  static Config: z<Config> = z.object({
    bindHost: z.union([z.const('127.0.0.1'), z.const('0.0.0.0')]).default(DEFAULT_BIND_HOST),
    hostnameSuffix: z.string().min(1).default(DEFAULT_HOSTNAME_SUFFIX),
    maxGrants: z.natural().min(1).default(DEFAULT_MAX_GRANTS),
    maxAssetBytes: z.natural().min(1).default(DEFAULT_MAX_ASSET_BYTES),
    inactivityTimeoutMs: z.natural().min(1).default(DEFAULT_INACTIVITY_TIMEOUT_MS),
  })

  private readonly grants = new Map<InteractivePreviewId, GrantState>()
  private readonly pendingOpensBySession = new Map<SessionId, Set<AbortController>>()
  private pendingOpens = 0
  private disposed = false
  private readonly disposalAbort = new AbortController()

  private readonly config: Config

  /**
   * @param ctx - Cordis context carrying sessions and fs.
   * @param config - validated bind, suffix, and limit settings.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'interactivePreview')
    const hostnameSuffix = validateHostnameSuffix(config.hostnameSuffix)
    validatePreviewDeployment({ bindHost: config.bindHost, hostnameSuffix })
    this.config = { ...config, hostnameSuffix }
  }

  /** Close every live grant when the owning fiber or session disposes. */
  [Service.init](): void {
    this.ctx.effect(() => {
      const onSessionDisposed = (session: Session): void => {
        void this.closeGrantsForSession(session.id)
      }
      this.ctx.on('session/disposed', onSessionDisposed)
      return async () => {
        this.disposed = true
        this.disposalAbort.abort()
        await Promise.allSettled([...this.grants.values()].map((grant) => { return this.shutdownGrant(grant) }))
      }
    }, 'interactive-preview: grants')
  }

  /**
   * Open one preview grant for a session HTML entry.
   * @param options - session id, entry path, and trusted parent origin.
   * @returns the grant id and complete HTTP origin.
   */
  async open(options: OpenInteractivePreviewOptions): Promise<InteractivePreviewGrant> {
    if (this.disposed) {
      throw new InteractivePreviewError('interactive preview service is disposed', 'preview-disposed')
    }
    if (this.grants.size + this.pendingOpens >= this.config.maxGrants) {
      throw new InteractivePreviewError(
        `interactive preview grant limit (${String(this.config.maxGrants)}) reached`,
        'preview-max-grants',
      )
    }
    this.pendingOpens += 1
    const releaseReservation = (): void => {
      this.pendingOpens -= 1
    }

    try {
      return await this.openGrant(options, releaseReservation)
    } catch (error: unknown) {
      releaseReservation()
      throw error
    }
  }

  private async openGrant(
    options: OpenInteractivePreviewOptions,
    releaseReservation: () => void,
  ): Promise<InteractivePreviewGrant> {
    const parentOrigin = validateParentOrigin(options.parentOrigin)
    const pending = this.beginPendingOpen(options.sessionId, options.signal)
    try {
      return await this.mintGrant(options, parentOrigin, pending, releaseReservation)
    } finally {
      pending.finish()
    }
  }

  private async mintGrant(
    options: OpenInteractivePreviewOptions,
    parentOrigin: string,
    pending: PendingOpen,
    releaseReservation: () => void,
  ): Promise<InteractivePreviewGrant> {
    const openSignal = pending.signal
    const session = this.ctx.sessions.get(options.sessionId)
    if (session === undefined) {
      throw new InteractivePreviewError(
        `interactive preview session "${options.sessionId}" was not found`,
        'preview-session-not-found',
      )
    }
    const cwd = session.header.cwd
    if (cwd === undefined) {
      throw new InteractivePreviewError(
        `interactive preview session "${options.sessionId}" has no cwd`,
        'preview-session-no-cwd',
      )
    }

    const workspaceRoot = await this.ctx.fs.resolve(cwd, { signal: openSignal }).catch((error: unknown) => {
      this.failOpen(options.sessionId, pending, options.signal, error)
    })
    let entry: FsTarget
    try {
      entry = await this.ctx.fs.resolve(options.path, { cwd, signal: openSignal })
    } catch (error: unknown) {
      if (error instanceof FsError && error.code === 'FS_NOT_FOUND') {
        throw new InteractivePreviewError(
          `interactive preview entry "${options.path}" was not found`,
          'preview-entry-not-found',
        )
      }
      this.failOpen(options.sessionId, pending, options.signal, error)
    }
    if (!this.ctx.fs.contains(workspaceRoot, entry)) {
      throw new InteractivePreviewError(
        `interactive preview entry "${options.path}" resolves outside the session workspace`,
        'preview-outside-workspace',
      )
    }

    const entryPath = this.ctx.fs.processPath(entry)
    let entryInfo
    try {
      entryInfo = await this.ctx.fs.stat(entry, openSignal)
    } catch (error: unknown) {
      this.failOpen(options.sessionId, pending, options.signal, error)
    }
    if (entryInfo === undefined) {
      throw new InteractivePreviewError(
        `interactive preview entry "${options.path}" was not found`,
        'preview-entry-not-found',
      )
    }
    if (entryInfo.type !== 'file') {
      throw new InteractivePreviewError(
        `interactive preview entry "${options.path}" is not a regular file`,
        'preview-entry-not-file',
      )
    }
    const extension = extname(entryPath).toLowerCase()
    if (extension !== '.html' && extension !== '.htm') {
      throw new InteractivePreviewError(
        `interactive preview entry "${options.path}" is not an HTML file`,
        'preview-entry-not-html',
      )
    }

    const appRootPath = dirname(entryPath)
    let appRoot
    try {
      appRoot = await this.ctx.fs.resolve(appRootPath, { signal: openSignal })
    } catch (error: unknown) {
      this.failOpen(options.sessionId, pending, options.signal, error)
    }

    const id = InteractivePreviewId(randomHexLabel())
    const capability = randomHexLabel()
    const grantAbort = new AbortController()
    const holder: { grant: GrantState | undefined } = { grant: undefined }

    const server = createServer((req, res) => {
      const grant = holder.grant
      if (!isActivePreviewGrant(grant)) {
        res.destroy()
        return
      }
      const work = this.handleRequest(grant, req, res)
      grant.inFlight.add(work)
      void work.finally(() => { grant.inFlight.delete(work) }).catch((error: unknown) => {
        respondPreviewHandlerFailure(
          (error) => { this.ctx.logger.warn(error) },
          res,
          grant.parentOrigin,
          error,
          previewSecurityHeaders,
        )
      })
    })

    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, this.config.bindHost, () => {
          server.off('error', reject)
          server.on('error', (err) => { this.ctx.logger.error(err) })
          resolve()
        })
      })
    } catch (error: unknown) {
      await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
      this.failOpen(options.sessionId, pending, options.signal, error)
    }

    const unpublished = this.unpublishedOpenFailure(options.sessionId, pending, options.signal)
    if (unpublished !== undefined) {
      await this.closeUnpublishedServer(server)
      throw unpublished
    }
    if (options.signal?.aborted) {
      await this.closeUnpublishedServer(server)
      options.signal.throwIfAborted()
    }

    const port = (server.address() as AddressInfo).port
    const authority = hostAuthority(capability, this.config.hostnameSuffix, port)
    const grant: GrantState = {
      id,
      sessionId: options.sessionId,
      server,
      hostAuthority: authority,
      origin: previewOrigin(authority),
      parentOrigin,
      appRoot,
      appRootPath,
      entryBaseName: basename(entryPath),
      inactivityTimer: undefined,
      closed: false,
      abort: grantAbort,
      inFlight: new Set(),
      shutdownPromise: undefined,
    }
    holder.grant = grant
    this.grants.set(id, grant)
    if (options.signal?.aborted) {
      await this.close(id)
      options.signal.throwIfAborted()
    }
    releaseReservation()
    this.touchInactivity(grant)

    return { id, origin: grant.origin }
  }

  /**
   * Close one preview grant idempotently.
   * @param id - grant to close.
   */
  async close(id: InteractivePreviewId): Promise<void> {
    const grant = this.grants.get(id)
    if (grant === undefined) return
    await this.shutdownGrant(grant)
  }

  /**
   * Mint a unique-origin grant for one session HTML entry.
   * @param agent - session whose workspace confines the entry.
   * @param path - HTML entry path relative to the session cwd unless absolute.
   * @param parentOrigin - trusted parent origin embedded in CSP `frame-ancestors`.
   * @param signal - caller cancellation.
   * @returns the grant id and complete HTTP origin.
   */
  @Remote('start')
  async remoteExportStart(
    agent: Agent,
    path: string,
    parentOrigin: string,
    signal: AbortSignal,
  ): Promise<InteractivePreviewGrant> {
    signal.throwIfAborted()
    try {
      return await this.open({ sessionId: agent.id, path, parentOrigin, signal })
    } catch (error: unknown) {
      throwRemote(error, { sessionId: agent.id, path, parentOrigin })
    }
  }

  /**
   * Close one preview grant. Missing ids are a no-op.
   * @param id - grant returned from {@link InteractivePreview.remoteExportStart}.
   * @param signal - caller cancellation.
   */
  @Remote('stop')
  async remoteExportStop(id: InteractivePreviewId, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    await this.close(id)
  }

  private beginPendingOpen(sessionId: SessionId, rpcSignal?: AbortSignal): PendingOpen {
    const controller = new AbortController()
    const existing = this.pendingOpensBySession.get(sessionId)
    const pending = existing ?? new Set<AbortController>()
    if (existing === undefined) this.pendingOpensBySession.set(sessionId, pending)
    pending.add(controller)
    const sources = [this.disposalAbort.signal, controller.signal]
    if (rpcSignal !== undefined) sources.push(rpcSignal)
    return {
      controller,
      signal: AbortSignal.any(sources),
      finish: () => {
        pending.delete(controller)
        if (pending.size === 0) this.pendingOpensBySession.delete(sessionId)
      },
    }
  }

  private unpublishedOpenFailure(
    sessionId: SessionId,
    pending: PendingOpen,
    rpcSignal?: AbortSignal,
  ): InteractivePreviewError | undefined {
    if (this.disposed || this.disposalAbort.signal.aborted) {
      return new InteractivePreviewError('interactive preview service is disposed', 'preview-disposed')
    }
    if (rpcSignal?.aborted) return undefined
    if (pending.controller.signal.aborted || this.ctx.sessions.get(sessionId) === undefined) {
      return new InteractivePreviewError(
        `interactive preview session "${sessionId}" was not found`,
        'preview-session-not-found',
      )
    }
  }

  private failOpen(
    sessionId: SessionId,
    pending: PendingOpen,
    rpcSignal: AbortSignal | undefined,
    error: unknown,
  ): never {
    const mapped = this.unpublishedOpenFailure(sessionId, pending, rpcSignal)
    if (mapped !== undefined) throw mapped
    if (rpcSignal?.aborted) rpcSignal.throwIfAborted()
    rethrowUnlessDisposed(this.disposed, pending.signal, error)
  }

  private async closeUnpublishedServer(server: Server): Promise<void> {
    await new Promise<void>((resolve) => {
      server.closeAllConnections()
      server.close(() => { resolve() })
    })
  }

  private async closeGrantsForSession(sessionId: SessionId): Promise<void> {
    const pending = this.pendingOpensBySession.get(sessionId)
    if (pending !== undefined) {
      for (const controller of pending) controller.abort()
    }
    const closing = [...this.grants.values()]
      .filter(grant => grant.sessionId === sessionId)
      .map((grant) => { return this.close(grant.id) })
    await Promise.allSettled(closing)
  }

  private touchInactivity(grant: GrantState): void {
    scheduleInactivityTimeout(grant, this.config.inactivityTimeoutMs, () => {
      void this.close(grant.id)
    })
  }

  private shutdownGrant(grant: GrantState): Promise<void> {
    grant.shutdownPromise ??= this.runShutdownGrant(grant)
    return grant.shutdownPromise
  }

  private async runShutdownGrant(grant: GrantState): Promise<void> {
    grant.closed = true
    if (grant.inactivityTimer !== undefined) clearTimeout(grant.inactivityTimer)
    grant.abort.abort()
    grant.server.closeAllConnections()
    await Promise.allSettled([...grant.inFlight])
    await new Promise<void>((resolve) => {
      grant.server.close(() => { resolve() })
    })
    this.grants.delete(grant.id)
  }

  private deny(res: ServerResponse, status: number, parentOrigin: string): void {
    res.writeHead(status, previewSecurityHeaders(parentOrigin))
    res.end()
  }

  private async handleRequest(grant: GrantState, req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!isActivePreviewGrant(grant)) {
      res.destroy()
      return
    }

    if (!hostHeaderMatches(req.headers.host, grant.hostAuthority)) {
      res.writeHead(403, wrongHostHeaders())
      res.end()
      return
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, methodNotAllowedHeaders(grant.parentOrigin))
      res.end()
      return
    }

    this.touchInactivity(grant)
    const signal = previewRequestSignal(req, res, grant.abort.signal, this.disposalAbort.signal)

    /* v8 ignore next -- node:http always sets url on server requests */
    const pathname = rawPathname(req.url ?? '/')
    let resolved
    try {
      resolved = await resolvePreviewPath(
        this.ctx.fs,
        grant.appRoot,
        grant.appRootPath,
        grant.entryBaseName,
        pathname,
        signal,
      )
    } catch (error: unknown) {
      if (wasPreviewRequestAborted(signal, error)) {
        res.destroy()
        return
      }
      throw error
    }

    let target: FsTarget
    switch (resolved.kind) {
      case 'file':
        target = resolved.target
        break
      case 'traversal':
        this.deny(res, 403, grant.parentOrigin)
        return
      case 'missing': {
        if (!acceptsHtml(req.headers.accept) || isPreviewEntryPath(pathname, grant.entryBaseName)) {
          this.deny(res, 404, grant.parentOrigin)
          return
        }
        let fallback
        try {
          fallback = await resolvePreviewPath(
            this.ctx.fs,
            grant.appRoot,
            grant.appRootPath,
            grant.entryBaseName,
            `/${grant.entryBaseName}`,
            signal,
          )
        } catch (error: unknown) {
          if (wasPreviewRequestAborted(signal, error)) {
            res.destroy()
            return
          }
          throw error
        }
        if (fallback.kind !== 'file') {
          this.deny(res, fallback.kind === 'traversal' ? 403 : 404, grant.parentOrigin)
          return
        }
        target = fallback.target
        break
      }
      /* v8 ignore next -- closed union default */
      default:
        return assertNever(resolved)
    }

    const canonicalPath = this.ctx.fs.processPath(target)
    let info
    try {
      info = await this.ctx.fs.stat(target, signal)
    } catch (error: unknown) {
      if (wasPreviewRequestAborted(signal, error)) {
        res.destroy()
        return
      }
      throw error
    }
    if (info === undefined) {
      this.deny(res, 404, grant.parentOrigin)
      return
    }
    if (info.size !== undefined && info.size > this.config.maxAssetBytes) {
      this.deny(res, 413, grant.parentOrigin)
      return
    }

    const responseHeaders: Record<string, string> = {
      ...previewSecurityHeaders(grant.parentOrigin),
      'content-type': contentTypeForPath(canonicalPath, mime.lookup.bind(mime)),
    }

    if (req.method === 'HEAD') {
      if (info.size !== undefined) responseHeaders['content-length'] = String(info.size)
      res.writeHead(200, responseHeaders)
      res.end()
      return
    }

    let bytes: Uint8Array
    try {
      bytes = await this.ctx.fs.readBytes(target, signal, this.config.maxAssetBytes)
    } catch (error: unknown) {
      if (wasPreviewRequestAborted(signal, error)) {
        res.destroy()
        return
      }
      if (error instanceof FsError && error.code === 'FS_TOO_LARGE') {
        this.deny(res, 413, grant.parentOrigin)
        return
      }
      this.deny(res, 404, grant.parentOrigin)
      return
    }

    responseHeaders['content-length'] = String(bytes.byteLength)
    res.writeHead(200, responseHeaders)
    res.end(Buffer.from(bytes))
  }
}
