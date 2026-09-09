/**
 * Interactive preview grant RPC error mapping for the API gateway.
 */

import { InteractivePreviewError } from '@deepseek-ai/dsh-host-interactive-preview'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RpcError } from './api/rpc.ts'

/** Request fields echoed into interactive-preview RPC error details. */
export interface InteractivePreviewRpcContext {
  sessionId?: SessionId
  path?: string
  parentOrigin?: string
}

/**
 * Convert an interactive-preview failure into the gateway's RPC error fields.
 * @param error - failure thrown while opening or closing a grant.
 * @param context - addressed session/path/origin for structured details.
 * @returns stable public RPC error fields.
 */
export function interactivePreviewRpcError(
  error: unknown,
  context: InteractivePreviewRpcContext = {},
): RpcError {
  if (error instanceof InteractivePreviewError) {
    switch (error.code) {
      case 'preview-session-not-found':
      case 'preview-session-no-cwd':
        return {
          code: error.code,
          message: error.message,
          details: { sessionId: context.sessionId ?? '' as SessionId },
        }
      case 'preview-entry-not-found':
      case 'preview-entry-not-file':
      case 'preview-entry-not-html':
      case 'preview-outside-workspace':
        return {
          code: error.code,
          message: error.message,
          details: { path: context.path ?? '' },
        }
      case 'preview-invalid-parent-origin':
        return {
          code: error.code,
          message: error.message,
          details: { parentOrigin: context.parentOrigin ?? '' },
        }
      case 'preview-max-grants':
      case 'preview-disposed':
        return { code: error.code, message: error.message, details: {} }
      default:
        return { code: 'internal', message: error.message, details: {} }
    }
  }
  return {
    code: 'internal',
    message: error instanceof Error ? error.message : String(error),
    details: {},
  }
}
