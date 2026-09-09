/** Typed test access to package-private grant state. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type InteractivePreview from '../src/service.ts'
import type { InteractivePreviewId } from '../src/types.ts'

export interface PreviewGrantState {
  closed: boolean
  inactivityTimer: ReturnType<typeof setTimeout> | undefined
  abort: AbortController
  server: import('node:http').Server
  shutdownPromise: Promise<void> | undefined
}

export interface PreviewTestInternals {
  grants: Map<InteractivePreviewId, PreviewGrantState>
  handleRequest: (grant: PreviewGrantState, req: IncomingMessage, res: ServerResponse) => Promise<void>
}

/** Return package-private preview state for focused tests. */
export function previewInternals(preview: InteractivePreview): PreviewTestInternals {
  return preview as unknown as PreviewTestInternals
}
