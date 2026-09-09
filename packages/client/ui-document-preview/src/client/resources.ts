/**
 * Previewable workspace path helpers and relative image collection.
 */

const PREVIEW_EXTENSIONS = new Set(['.md', '.markdown', '.html', '.htm'])
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])
const MARKDOWN_IMAGE = /!\[[^\]]*]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g
const MARKDOWN_REF_DEF = /^[ ]{0,3}\[([^\]]+)]:\s+<?([^\s>]+)>?/gm
const MARKDOWN_REF_IMAGE = /!\[([^\]]*)]\[([^\]]*)]/g
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
 * Preview format inferred from a document path's extension.
 * @param path - Workspace document path.
 * @returns `markdown` or `html` for a previewable extension; otherwise `undefined`.
 */
export function previewDocumentFormat(path: string): 'markdown' | 'html' | undefined {
  const extension = previewExtension(path)
  if (extension === '.md' || extension === '.markdown') return 'markdown'
  if (extension === '.html' || extension === '.htm') return 'html'
  return undefined
}

/**
 * Resolve a relative image source against the document's directory.
 *
 * Separators become `/`. `.` and empty segments are dropped; `..` pops one
 * directory and is dropped at the root. An absolute POSIX or Windows source is
 * returned as itself after that normalization. The Host still confines the
 * resulting path to the session workspace.
 * @param documentPath - Path of the document that authored the source.
 * @param source - Relative image destination from Markdown or HTML.
 * @returns The path to hand `workspaceFiles.readBytes`.
 */
export function resolvePreviewImagePath(documentPath: string, source: string): string {
  const relative = source.trim().replace(/\\/g, '/').replace(/[?#].*$/, '')
  if (relative.startsWith('/') || /^[A-Za-z]:/.test(relative)) return normalizePosixPath(relative)
  const base = documentPath.replace(/\\/g, '/')
  const slash = base.lastIndexOf('/')
  const dir = slash === -1 ? '' : base.slice(0, slash)
  return normalizePosixPath(dir === '' ? relative : `${dir}/${relative}`)
}

function normalizePosixPath(path: string): string {
  const drive = path.match(/^([A-Za-z]:)(\/.*)?$/)
  const rest = drive !== null
    ? (drive[2] ?? '').replace(/^\//, '')
    : path.startsWith('/') ? path.slice(1) : path
  const parts: string[] = []
  for (const segment of rest.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      parts.pop()
      continue
    }
    parts.push(segment)
  }
  const body = parts.join('/')
  if (drive !== null) return body === '' ? `${drive[1]}/` : `${drive[1]}/${body}`
  if (path.startsWith('/')) return `/${body}`
  return body
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
  const sources = uniqueMatching(markdown, MARKDOWN_IMAGE, 1)
  const seen = new Set(sources)
  const defs = new Map<string, string>()
  MARKDOWN_REF_DEF.lastIndex = 0
  for (const match of markdown.matchAll(MARKDOWN_REF_DEF)) {
    const rawLabel = match[1]
    const dest = match[2]
    if (rawLabel === undefined || dest === undefined) continue
    const label = normalizeMarkdownRef(rawLabel)
    if (label === '' || defs.has(label)) continue
    defs.set(label, dest)
  }
  MARKDOWN_REF_IMAGE.lastIndex = 0
  for (const match of markdown.matchAll(MARKDOWN_REF_IMAGE)) {
    const explicit = match[2]
    const implicit = match[1]
    if (explicit === undefined || implicit === undefined) continue
    const label = normalizeMarkdownRef(explicit === '' ? implicit : explicit)
    const dest = defs.get(label)
    if (dest === undefined || !isPreviewableImageSource(dest) || seen.has(dest)) continue
    seen.add(dest)
    sources.push(dest)
  }
  return sources
}

function normalizeMarkdownRef(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLowerCase()
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
