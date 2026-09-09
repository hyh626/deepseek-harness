/**
 * Request-scoped abort signal wiring for preview HTTP handlers.
 * @module @deepseek-ai/dsh-host-interactive-preview/signals
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * Combine request, grant, and service disposal abort sources.
 * @param req - incoming HTTP request.
 * @param res - outgoing HTTP response.
 * @param grantAbort - grant shutdown controller.
 * @param disposalAbort - plugin disposal controller.
 * @returns an abort signal active for the request lifetime and teardown.
 */
export function previewRequestSignal(
  req: IncomingMessage,
  res: ServerResponse,
  grantAbort: AbortSignal,
  disposalAbort: AbortSignal,
): AbortSignal {
  const requestAbort = new AbortController()
  const abortRequest = (): void => {
    if (requestAbort.signal.aborted) return
    requestAbort.abort()
  }
  req.on('aborted', abortRequest)
  res.on('close', abortRequest)
  return AbortSignal.any([requestAbort.signal, grantAbort, disposalAbort])
}

/**
 * Return true when a preview request was cancelled through its abort signal.
 * @param signal - combined request, grant, and disposal abort signal.
 * @param error - rejection from an aborted fs call, if any.
 * @returns true when the request should be dropped without a response body.
 */
export function wasPreviewRequestAborted(signal: AbortSignal, error: unknown): boolean {
  if (signal.aborted) return true
  return error instanceof Error && error.name === 'AbortError'
}

/**
 * Log and respond when a preview handler rejects unexpectedly.
 * @param log - logger accepting the failure.
 * @param res - response under construction.
 * @param parentOrigin - grant parent origin for security headers.
 * @param error - thrown rejection.
 * @param securityHeaders - header factory for the grant.
 */
export function respondPreviewHandlerFailure(
  log: (error: Error) => void,
  res: ServerResponse,
  parentOrigin: string,
  error: unknown,
  securityHeaders: (parentOrigin: string) => Record<string, string>,
): void {
  log(error instanceof Error ? error : new Error(String(error)))
  if (res.headersSent) {
    res.destroy()
    return
  }
  res.writeHead(500, securityHeaders(parentOrigin))
  res.end()
}

/**
 * Return true when a grant is ready to serve requests.
 * @param grant - active grant, if any.
 * @returns true when the grant exists and is not closed.
 */
export function isActivePreviewGrant<G extends { closed: boolean }>(
  grant: G | undefined,
): grant is G {
  return grant !== undefined && !grant.closed
}
