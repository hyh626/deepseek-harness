/**
 * Package-owned Mermaid adapter for MarkdownText preview rendering.
 */

import mermaid from 'mermaid'
import type { MermaidRenderer } from '@deepseek-ai/dsh-client-ui-primitives'

let initialized = false

/**
 * Render mermaid source to SVG with scripts disabled at the library.
 * @param source - Fence body.
 * @param signal - Aborts before the SVG is returned when the fence is replaced.
 * @returns SVG markup; MarkdownText publishes it as a blob image.
 */
async function renderMermaid(source: string, signal: AbortSignal): Promise<string> {
  if (!initialized) {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' })
    initialized = true
  }
  const id = `dsh-preview-mermaid-${Math.random().toString(36).slice(2)}`
  const { svg } = await mermaid.render(id, source)
  signal.throwIfAborted()
  return svg
}

/** Preview-owned mermaid renderer (`startOnLoad: false`, `securityLevel: 'strict'`). */
export const previewMermaidRenderer: MermaidRenderer = {
  render: renderMermaid,
}
