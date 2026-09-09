/**
 * Branded ids, grant records, and typed failures for interactive preview.
 * @module @deepseek-ai/dsh-host-interactive-preview/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'

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

/** Typed interactive-preview failure for callers and HTTP mapping. */
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
