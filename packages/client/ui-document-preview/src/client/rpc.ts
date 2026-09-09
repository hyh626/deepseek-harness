/**
 * Workspace reads and interactive-preview remotes this type performs, bound to
 * the Client Remote.
 *
 * Content is this type's own business: `workspaceFiles.stat` plus `readBytes`
 * load a whole Markdown or HTML file (and its relative rasters), and
 * `interactivePreview` mints an isolated origin after consent. A tab carries a
 * `dsh-resource://file/` address in one of two scopes, so this module also owns
 * that translation.
 */
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { WorkspaceByteRange, WorkspaceFileBytes, WorkspaceFileStat } from '@deepseek-ai/dsh-api-workspace-files/types'
import type { InteractivePreviewGrant, InteractivePreviewId } from '@deepseek-ai/dsh-host-interactive-preview/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import type { DocumentPreviewHost } from './controller.ts'
import { previewDocumentFormat, previewExtension, resolvePreviewImagePath } from './resources.ts'

/** Largest document this type will decode. */
export const PREVIEW_DOCUMENT_MAX_BYTES = 2 * 1024 * 1024

/** Largest relative raster this type will load beside a document. */
export const PREVIEW_IMAGE_MAX_BYTES = 5 * 1024 * 1024

const IMAGE_MEDIA_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

/** The slice of the Client Remote this package calls. */
export interface DocumentPreviewRemote {
  readonly workspaceFiles: {
    /**
     * Report one regular file's identity and size.
     * @param sessionId - the session whose workspace resolves `path`.
     * @param path - workspace path, absolute or relative to the workspace root.
     * @param signal - cancels the call.
     * @returns the stat, or the failure the Host declares.
     */
    stat(
      sessionId: SessionId,
      path: string,
      signal?: AbortSignal,
    ): Promise<RemoteResult<WorkspaceFileStat>>
    /**
     * Read one byte window of a regular file.
     * @param sessionId - the session whose workspace resolves `path`.
     * @param path - workspace path, absolute or relative to the workspace root.
     * @param range - 0-based offset; the Host's byte cap applies when `length` is absent.
     * @param signal - cancels the call.
     * @returns the window, or the failure the Host declares.
     */
    readBytes(
      sessionId: SessionId,
      path: string,
      range: WorkspaceByteRange,
      signal?: AbortSignal,
    ): Promise<RemoteResult<WorkspaceFileBytes>>
  }
  readonly interactivePreview: {
    /**
     * Mint an isolated origin for one HTML entry.
     * @param sessionId - the session whose workspace confines the entry.
     * @param path - HTML entry path relative to the session cwd unless absolute.
     * @param parentOrigin - trusted parent origin embedded in CSP `frame-ancestors`.
     * @param signal - cancels the call.
     * @returns the grant, or the failure the Host declares.
     */
    start(
      sessionId: SessionId,
      path: string,
      parentOrigin: string,
      signal?: AbortSignal,
    ): Promise<RemoteResult<InteractivePreviewGrant>>
    /**
     * Close one preview grant. Missing ids are a no-op on the Host.
     * @param id - grant returned from {@link DocumentPreviewRemote.interactivePreview.start}.
     * @param signal - cancels the call.
     * @returns success, or the failure the Host declares.
     */
    stop(id: InteractivePreviewId, signal?: AbortSignal): Promise<RemoteResult<unknown>>
  }
  readonly session: {
    /**
     * Open one path on the Host desktop.
     * @param request - path after Session workspace resolution.
     * @param signal - cancels the call.
     * @returns confirmation, or the failure the Host declares.
     */
    openWorkspacePath(
      request: { readonly path: string },
      signal?: AbortSignal,
    ): Promise<RemoteResult<{ readonly opened: true }>>
  }
}

/** The file one tab reads: the session the read runs under and the path handed to the Host. */
export interface SessionFile {
  /** The session whose workspace confines the read. */
  readonly sessionId: SessionId
  /** The path the Host receives: workspace-relative for a `session` address, absolute for an `absolute` one. */
  readonly path: string
}

/**
 * The session and path one `dsh-resource://file/…` address names.
 *
 * A `session` address names its own session and a workspace-relative path, so
 * a tab addressed into another session reads from that session. An `absolute`
 * address carries no session and is read through the seat's own, which the
 * Host confines to that session's workspace. The registry routes parseable
 * Markdown and HTML `file` addresses to this type, so an address
 * `parseFileAddress` rejects is a programming error and throws.
 * @param address - a tab's `dsh-resource://file/…` address.
 * @param sessionId - the seat's session, which an `absolute` address is read through.
 * @returns the session and the path to hand the endpoint.
 */
export function hostFileOf(address: string, sessionId: SessionId): SessionFile {
  const parsed = parseFileAddress(address)
  if (parsed === undefined) throw new Error(`ui-document-preview: not a file address "${address}"`)
  return parsed.scope === 'session'
    ? { sessionId: parsed.sessionId as SessionId, path: parsed.path }
    : { sessionId, path: parsed.path }
}

/**
 * Bind confined document and image reads, interactive grants, and native open
 * to one Remote face. A Remote call does not reject: this binding throws
 * `result.error` so the controller can read `.message` (and `.code` when present).
 * @param remote - the Client Remote carrying `workspaceFiles`, `interactivePreview`, and `session`.
 * @returns the Host methods the controller calls, except `parentOrigin`.
 */
export function bindPreviewRemote(remote: DocumentPreviewRemote): Omit<DocumentPreviewHost, 'parentOrigin'> {
  return {
    readPreviewDocument: (sessionId, path, signal) => readPreviewDocument(remote, sessionId, path, signal),
    readPreviewImage: (sessionId, documentPath, source, signal) =>
      readPreviewImage(remote, sessionId, documentPath, source, signal),
    startInteractivePreview: async (sessionId, path, parentOrigin, signal) =>
      unwrap(await remote.interactivePreview.start(sessionId, path, parentOrigin, signal)),
    stopInteractivePreview: async (id, signal) => {
      unwrap(await remote.interactivePreview.stop(id, signal))
    },
    openPath: async (path) => {
      unwrap(await remote.session.openWorkspacePath({ path }))
    },
  }
}

async function readPreviewDocument(
  remote: DocumentPreviewRemote,
  sessionId: SessionId,
  path: string,
  signal?: AbortSignal,
): Promise<{ path: string; format: 'markdown' | 'html'; content: string }> {
  const format = previewDocumentFormat(path)
  if (format === undefined) {
    throw codedError('workspace-file/not-text', `"${path}" is not a Markdown or HTML document`)
  }
  const stat = unwrap(await remote.workspaceFiles.stat(sessionId, path, signal))
  const window = await readCappedWindow(
    remote, sessionId, path, stat, PREVIEW_DOCUMENT_MAX_BYTES, signal,
  )
  try {
    return {
      path: stat.absolutePath,
      format,
      content: new TextDecoder('utf-8', { fatal: true }).decode(decodeBase64(window.data)),
    }
  } catch (error: unknown) {
    throw codedError(
      'workspace-file/not-text',
      `"${path}" is not UTF-8 text`,
      error instanceof Error ? error : undefined,
    )
  }
}

async function readPreviewImage(
  remote: DocumentPreviewRemote,
  sessionId: SessionId,
  documentPath: string,
  source: string,
  signal?: AbortSignal,
): Promise<{ mediaType: string; data: string }> {
  const path = resolvePreviewImagePath(documentPath, source)
  const mediaType = IMAGE_MEDIA_TYPES[previewExtension(path)]
  if (mediaType === undefined) {
    throw codedError('workspace-file/not-text', `"${path}" is not a previewable raster`)
  }
  const stat = unwrap(await remote.workspaceFiles.stat(sessionId, path, signal))
  const window = await readCappedWindow(
    remote, sessionId, path, stat, PREVIEW_IMAGE_MAX_BYTES, signal,
  )
  return { mediaType, data: window.data }
}

async function readCappedWindow(
  remote: DocumentPreviewRemote,
  sessionId: SessionId,
  path: string,
  stat: WorkspaceFileStat,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<WorkspaceFileBytes> {
  if (stat.bytes !== undefined && stat.bytes > maxBytes) {
    throw codedError('workspace-file/too-large', `"${path}" exceeds the ${maxBytes} byte preview limit`)
  }
  if (stat.bytes === 0) {
    return { ...stat, offset: 0, data: '', eof: true }
  }
  const window = unwrap(await remote.workspaceFiles.readBytes(sessionId, path, { offset: 0, length: maxBytes }, signal))
  if (!window.eof) {
    throw codedError('workspace-file/too-large', `"${path}" exceeds the ${maxBytes} byte preview limit`)
  }
  return window
}

function unwrap<T>(result: RemoteResult<T>): T {
  if (!result.ok) throw result.error
  return result.value
}

function codedError(code: string, message: string, cause?: Error): Error {
  const error = cause === undefined ? new Error(message) : new Error(message, { cause })
  Object.assign(error, { code })
  return error
}

function decodeBase64(data: string): Uint8Array {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
