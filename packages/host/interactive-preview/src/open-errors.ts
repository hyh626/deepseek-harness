/**
 * Open-path error normalization for interactive preview.
 * @module @deepseek-ai/dsh-host-interactive-preview/open-errors
 */

import { InteractivePreviewError } from './types.ts'

/**
 * Re-throw disposal as `preview-disposed`; otherwise preserve the original error.
 * @param disposed - whether the owning service has disposed.
 * @param signal - open-path abort signal.
 * @param error - failure from fs or listen setup.
 * @returns never — always throws.
 */
export function rethrowUnlessDisposed(
  disposed: boolean,
  signal: AbortSignal,
  error: unknown,
): never {
  if (disposed || signal.aborted) {
    throw new InteractivePreviewError('interactive preview service is disposed', 'preview-disposed')
  }
  throw error
}
