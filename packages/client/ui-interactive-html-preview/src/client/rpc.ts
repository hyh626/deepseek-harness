/**
 * The interactive-preview Remote slice this type calls, bound to the Client
 * Remote. Content is this type's own business: the Host mints one isolated
 * origin per consented file, and `workspaceFiles.stat` supplies the displayed
 * source version.
 */
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { WorkspaceFileStat } from '@deepseek-ai/dsh-api-workspace-files/types'
import type { InteractivePreviewGrant, InteractivePreviewId } from '@deepseek-ai/dsh-host-interactive-preview/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path'

/** The slice of the Client Remote this package calls. */
export interface InteractiveHtmlRemote {
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
     * @param id - grant returned from {@link InteractiveHtmlRemote.interactivePreview.start}.
     * @param signal - cancels the call.
     * @returns success, or the failure the Host declares.
     */
    stop(id: InteractivePreviewId, signal?: AbortSignal): Promise<RemoteResult<unknown>>
  }
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
  }
}

/** The file one tab previews: the session the grant runs under and the path handed to the Host. */
export interface SessionFile {
  /** The session whose workspace confines the entry. */
  readonly sessionId: SessionId
  /** The path the Host receives: workspace-relative for a `session` address. */
  readonly path: string
}

/**
 * The session and path one `dsh-resource://file/…` address names.
 *
 * The document preview's tab type claims only Session addresses, so an
 * address `parseFileAddress` rejects — or one carrying a bare `absolute`
 * scope — is a programming error and throws.
 * @param address - a tab's `dsh-resource://file/…` address.
 * @returns the session and the path to hand the Host.
 */
export function hostFileOf(address: string): SessionFile {
  const parsed = parseFileAddress(address)
  if (parsed?.scope !== 'session') throw new Error(`ui-interactive-html-preview: not a session file address "${address}"`)
  // The address is a string boundary: its id segment is the Session id it names.
  return { sessionId: parsed.sessionId as SessionId, path: parsed.path }
}

/** The result of one unwrapped Remote call: a value, or a displayable failure. */
export type RemoteOutcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string }

/**
 * Turn a Remote call's `RemoteResult` into an outcome the face can store.
 * @param result - the settled Remote call.
 * @returns the value, or the failure's message.
 */
export function settle<T>(result: RemoteResult<T>): RemoteOutcome<T> {
  return result.ok ? { ok: true, value: result.value } : { ok: false, message: result.error.message }
}
