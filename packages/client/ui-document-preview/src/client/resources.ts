/**
 * Previewable workspace path helpers and relative image collection.
 */

const PREVIEW_EXTENSIONS = new Set(['.md', '.markdown', '.html', '.htm'])
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])
const MARKDOWN_IMAGE = /!\[[^\]]*]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g
const HTML_IMAGE_SRC = /\bsrc\s*=\s*(["'])([^"']+)\1/gi

/**
 * Final path segment for panel titles.
 * @param path - Absolute or relative document path.
 * @returns The last non-empty path segment.
 */
export function previewBasename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  return trimmed.replace(/^.*[\\/]/, '')
}

/**
 * Lowercased final extension including the leading dot.
 * @param path - Path whose extension is inspected.
 * @returns The extension, or an empty string when none exists.
 */
export function previewExtension(path: string): string {
  const name = previewBasename(path)
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return ''
  return name.slice(dot).toLowerCase()
}

/**
 * Whether a path is a Markdown or HTML document this plugin previews.
 * @param path - Candidate workspace path.
 * @returns True for `.md`, `.markdown`, `.html`, and `.htm`.
 */
export function isPreviewableDocumentPath(path: string): boolean {
  return PREVIEW_EXTENSIONS.has(previewExtension(path))
}

/**
 * Whether an image source may be loaded as a preview raster.
 * @param source - Image destination from Markdown or HTML.
 * @returns True for relative PNG/JPEG/WebP/GIF paths.
 */
export function isPreviewableImageSource(source: string): boolean {
  const trimmed = source.trim()
  if (trimmed === '' || isRemoteOrOpaqueSource(trimmed)) return false
  return IMAGE_EXTENSIONS.has(previewExtension(trimmed.replace(/\?.*$/, '')))
}

/**
 * Collect relative raster destinations from Markdown image syntax.
 * @param markdown - Document body.
 * @returns Unique relative image sources in document order.
 */
export function collectMarkdownImageSources(markdown: string): string[] {
  return uniqueMatching(markdown, MARKDOWN_IMAGE, 1)
}

/**
 * Collect relative raster destinations from HTML `src` attributes.
 * @param html - Sanitized or raw HTML.
 * @returns Unique relative image sources in document order.
 */
export function collectHtmlImageSources(html: string): string[] {
  return uniqueMatching(html, HTML_IMAGE_SRC, 2)
}

/**
 * Replace matching `src` attribute values after sanitization.
 * @param html - Sanitized HTML.
 * @param urls - Source to rewritten URL map.
 * @returns HTML with rewritten `src` values.
 */
export function rewriteHtmlImageSources(html: string, urls: ReadonlyMap<string, string>): string {
  return html.replace(HTML_IMAGE_SRC, (match, quote: string, source: string) => {
    const rewritten = urls.get(source)
    return rewritten === undefined ? match : `src=${quote}${rewritten}${quote}`
  })
}

function isRemoteOrOpaqueSource(source: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(source)
}

function uniqueMatching(text: string, pattern: RegExp, group: number): string[] {
  const seen = new Set<string>()
  const sources: string[] = []
  pattern.lastIndex = 0
  for (const match of text.matchAll(pattern)) {
    const source = match[group]
    if (source === undefined || !isPreviewableImageSource(source) || seen.has(source)) continue
    seen.add(source)
    sources.push(source)
  }
  return sources
}
