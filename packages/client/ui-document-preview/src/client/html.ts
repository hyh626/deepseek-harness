/**
 * Static HTML sanitization, mermaid replacement, and sandboxed srcdoc wrapping.
 */

import DOMPurify from 'dompurify'
import type { MermaidRenderer } from '@deepseek-ai/dsh-client-ui-primitives'

const FORBID_TAGS = [
  'script', 'iframe', 'object', 'embed', 'form', 'base', 'link', 'meta',
  'applet', 'frame', 'frameset', 'audio', 'video', 'source', 'track',
]

const PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'none'",
  "connect-src 'none'",
  "style-src 'unsafe-inline'",
  'img-src blob: data: https: http:',
  "form-action 'none'",
  "base-uri 'none'",
].join('; ')

/**
 * Strip scripts, handlers, forms, embedded documents, refresh metadata, and linked stylesheets.
 * @param html - Untrusted HTML document or fragment.
 * @returns Sanitized HTML safe to place in a no-scripts srcdoc iframe.
 */
export function sanitizePreviewHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    FORBID_TAGS,
    FORBID_ATTR: ['srcset', 'srcdoc', 'xlink:href'],
    ALLOW_DATA_ATTR: false,
    ADD_TAGS: ['style'],
    ADD_ATTR: ['style'],
  })
}

/**
 * Wrap sanitized HTML in a CSP and no-referrer srcdoc document.
 * @param sanitized - Output of {@link sanitizePreviewHtml}, possibly with rewritten images.
 * @returns Complete HTML document string for iframe `srcdoc`.
 */
export function wrapPreviewSrcdoc(sanitized: string): string {
  return [
    '<!DOCTYPE html><html><head>',
    `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`,
    '<meta name="referrer" content="no-referrer">',
    '</head><body>',
    sanitized,
    '</body></html>',
  ].join('')
}

/**
 * Replace sanitized `pre.mermaid` and `div.mermaid` elements with blob images.
 * Failed renders keep the original source element.
 * @param html - Sanitized HTML fragment.
 * @param renderer - Preview mermaid adapter.
 * @param signal - Aborts remaining renders when the load is superseded.
 * @returns HTML with successful diagrams rewritten and the created object URLs.
 */
export async function replaceHtmlMermaid(
  html: string,
  renderer: MermaidRenderer,
  signal: AbortSignal,
): Promise<{ html: string; urls: string[] }> {
  const parsed = new DOMParser().parseFromString(`<div id="dsh-preview-root">${html}</div>`, 'text/html')
  const root = parsed.getElementById('dsh-preview-root')
  if (root === null) return { html, urls: [] }
  const nodes = [...root.querySelectorAll('pre.mermaid, div.mermaid')]
  const urls: string[] = []
  for (const node of nodes) {
    signal.throwIfAborted()
    const source = node.textContent || ''
    try {
      const svg = await renderer.render(source, signal)
      signal.throwIfAborted()
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
      urls.push(url)
      const image = parsed.createElement('img')
      image.setAttribute('src', url)
      image.setAttribute('alt', '')
      node.replaceWith(image)
    } catch (error: unknown) {
      if (signal.aborted) {
        for (const url of urls) URL.revokeObjectURL(url)
        throw error
      }
      // A failed diagram keeps its source element; the rest of the document still loads.
    }
  }
  return { html: root.innerHTML, urls }
}
