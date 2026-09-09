/**
 * host domain contract. No protocol version: client and host ship
 * together; introduce protocolVersion only when an independently released client appears.
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RpcRequest, RpcResponse } from './rpc.ts'

/** Opaque interactive preview grant id. */
export type InteractivePreviewId = Branded<'InteractivePreviewId'>

/** One directory row of a listing: a child entry or a breadcrumb ancestor. */
export interface DirectoryEntry {
  /** Base name shown in a browser row (a root crumb carries its full path). */
  name: string
  /** Absolute host path — the client never joins path segments itself. */
  path: string
  /** Hidden by the host platform's convention (dot-prefixed on POSIX); the client owns whether to show it. */
  hidden: boolean
}

/** host.listDirectory response value: one directory level plus its ancestry. */
export interface DirectoryListing {
  /** Absolute path of the listed directory. */
  path: string
  /** The host account's home directory (breadcrumb "Home" rooting). */
  home: string
  /**
   * Ancestor chain from the filesystem root to the listed directory
   * inclusive; every crumb is a jump target (crumb `hidden` is always false).
   */
  crumbs: DirectoryEntry[]
  /** Direct child directories, name-sorted; symlinks to directories included. */
  entries: DirectoryEntry[]
  /** True when the backend cut `entries` at its complete-result bound (the name-sorted tail is absent). */
  truncated: boolean
}

/** Host-level unary methods. */
export interface HostApi {
  /**
   * One-shot host snapshot. Empty payload uses the literal `{}` (extend in place when fields arrive).
   * version = the host app's (apps/cli) package.json version; cwd = the host process working
   * directory (root for session persistence and tool execution); provider/model = the defaults
   * applied when a new agent doesn't specify them explicitly, absent when the host configures
   * no explicit default (the adapter falls back internally);
   * attachedSessions = count of currently attached sessions (those with a live agent);
   * canOpenPath = whether this deployment can hand a path to a user-visible native desktop.
   */
  describe(request: RpcRequest<{}>): Promise<RpcResponse<{
    version: string
    cwd: string
    provider?: string
    model?: string
    attachedSessions: number
    canOpenPath: boolean
  }>>

  /**
   * Open the operating system's single-directory picker; cancellation returns
   * null. Only served under the `native` capability.
   */
  pickDirectory(
    request: RpcRequest<{}>,
    signal: AbortSignal,
  ): Promise<RpcResponse<{ path: string | null }>>

  /**
   * List one directory level for the in-app browser; an absent path lists the
   * host account's home directory. Only served under the `browse` capability;
   * unreadable or missing targets fail with `directory-unreadable`. The
   * carrier's request signal follows the caller, stopping the backend's scan
   * on disconnect or timeout.
   */
  listDirectory(
    request: RpcRequest<{ path?: string }>,
    signal: AbortSignal,
  ): Promise<RpcResponse<DirectoryListing>>

  /**
   * Create one child directory under an existing parent (the browser's
   * "New folder"). Only served under the `browse` capability; an existing
   * child fails with `directory-exists`, every other filesystem failure with
   * `directory-create-failed`.
   */
  createDirectory(
    request: RpcRequest<{ path: string; name: string }>,
  ): Promise<RpcResponse<{ path: string }>>

  /**
   * Open a filesystem path with the operating system's default application
   * (Finder / Explorer / xdg-open hand-off). The browser carrier's
   * prefix-wide trust fence covers this privileged method like every other
   * `/api` request.
   */
  openPath(
    request: RpcRequest<{ path: string }>,
    signal: AbortSignal,
  ): Promise<RpcResponse<{ opened: true }>>

  /**
   * Read one Markdown or HTML document confined to the addressed session cwd.
   * The host resolves canonical targets through `ctx.fs`, rejects traversal and
   * symlink escape, and enforces configured complete-result bounds.
   */
  readPreviewDocument(
    request: RpcRequest<{ sessionId: import('@deepseek-ai/dsh-session/types').SessionId; path: string }>,
    signal: AbortSignal,
  ): Promise<RpcResponse<{ path: string; format: 'markdown' | 'html'; content: string }>>

  /**
   * Read one contained raster image relative to a preview document directory.
   * Only PNG, JPEG, WebP, and GIF are supported; `data` is base64 on the wire.
   */
  readPreviewImage(
    request: RpcRequest<{
      sessionId: SessionId
      documentPath: string
      source: string
    }>,
    signal: AbortSignal,
  ): Promise<RpcResponse<{ mediaType: import('@deepseek-ai/dsh-attachment').ImageMediaType; data: string }>>

  /**
   * Mint one ephemeral interactive preview origin for a session HTML entry.
   * The composed `ctx.interactivePreview` provider owns grant lifecycle;
   * absent provider fails with `preview-unavailable`.
   */
  startInteractivePreview(
    request: RpcRequest<{ sessionId: SessionId; path: string; parentOrigin: string }>,
    signal: AbortSignal,
  ): Promise<RpcResponse<{ id: InteractivePreviewId; origin: string }>>

  /**
   * Close one interactive preview grant idempotently. Unknown ids still report
   * `{ stopped: true }` once the provider accepts the close.
   */
  stopInteractivePreview(
    request: RpcRequest<{ id: InteractivePreviewId }>,
    signal: AbortSignal,
  ): Promise<RpcResponse<{ stopped: true }>>
}
