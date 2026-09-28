/**
 * Branded ids, grant records, and typed failures for interactive preview.
 * @module @deepseek-ai/dsh-host-interactive-preview/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-typert-protocol'

/** Opaque interactive preview grant id. */
export type InteractivePreviewId = Branded<'InteractivePreviewId'>

/**
 * Brand a string as an {@link InteractivePreviewId}.
 * @param id - raw grant id string.
 * @returns the same string, branded.
 */
export function InteractivePreviewId(id: string): InteractivePreviewId {
  return id as InteractivePreviewId
}

/** Inputs for {@link InteractivePreview.open}. */
export interface OpenInteractivePreviewOptions {
  /** Session whose cwd anchors workspace resolution. */
  sessionId: SessionId
  /** Entry HTML path relative to the session cwd unless absolute. */
  path: string
  /** Trusted parent origin embedded in CSP `frame-ancestors`. */
  parentOrigin: string
  /** Caller cancellation; an aborted open must not leave a published grant. */
  signal?: AbortSignal
}

/** One minted preview grant returned from {@link InteractivePreview.open}. */
export interface InteractivePreviewGrant {
  /** Stable grant id for explicit close. */
  id: InteractivePreviewId
  /** Complete HTTP origin (`http://<capability>.<suffix>:<port>`). */
  origin: string
}

/** Stable open/read failure codes for interactive preview. */
export type InteractivePreviewErrorCode =
  | 'preview-session-not-found'
  | 'preview-session-no-cwd'
  | 'preview-entry-not-found'
  | 'preview-entry-not-file'
  | 'preview-entry-not-html'
  | 'preview-outside-workspace'
  | 'preview-invalid-parent-origin'
  | 'preview-max-grants'
  | 'preview-disposed'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** No live session matches the addressed id. */
    'interactive-preview/session-not-found': { readonly sessionId: string }
    /** The session has no cwd, so workspace resolution cannot start. */
    'interactive-preview/session-no-cwd': { readonly sessionId: string }
    /** The HTML entry path does not exist inside the workspace. */
    'interactive-preview/entry-not-found': { readonly path: string }
    /** The HTML entry path is not a regular file. */
    'interactive-preview/entry-not-file': { readonly path: string }
    /** The entry is not an HTML file. */
    'interactive-preview/entry-not-html': { readonly path: string }
    /** The entry resolves outside the session workspace. */
    'interactive-preview/outside-workspace': { readonly path: string }
    /** `parentOrigin` is not an exact `http:`/`https:` origin. */
    'interactive-preview/invalid-parent-origin': { readonly parentOrigin: string }
    /** The configured concurrent grant cap is already reached. */
    'interactive-preview/max-grants': Record<string, never>
    /** The plugin fiber has disposed. */
    'interactive-preview/disposed': Record<string, never>
  }
}

/** Typed interactive-preview failure for in-process callers. */
export class InteractivePreviewError extends Error {
  /** Stable failure code. */
  readonly code: InteractivePreviewErrorCode

  /**
   * @param message - operator-facing description.
   * @param code - stable failure code.
   */
  constructor(message: string, code: InteractivePreviewErrorCode) {
    super(message)
    this.name = 'InteractivePreviewError'
    this.code = code
  }
}
