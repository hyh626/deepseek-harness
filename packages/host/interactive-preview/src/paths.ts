/**
 * App-root path resolution for preview HTTP requests.
 * @module @deepseek-ai/dsh-host-interactive-preview/paths
 */

import { FsError, type FileSystem, type FsTarget } from '@deepseek-ai/dsh-fs'

/** Outcome of resolving one URL path against an app root. */
export type ResolvedPreviewPath =
  | { kind: 'file'; target: FsTarget }
  | { kind: 'traversal' }
  | { kind: 'missing' }

/**
 * Return the raw pathname from an HTTP request target without URL normalization.
 * @param url - raw request target from node:http.
 * @returns pathname segment before query or fragment.
 */
export function rawPathname(url: string): string {
  const query = url.indexOf('?')
  const hash = url.indexOf('#')
  let end = url.length
  if (query !== -1) end = Math.min(end, query)
  if (hash !== -1) end = Math.min(end, hash)
  return url.slice(0, end)
}

/**
 * Detect path traversal in a raw URL pathname before resolving through fs.
 * @param pathname - raw URL pathname, still encoded.
 * @returns true when the path names a parent segment.
 */
export function hasTraversalSegments(pathname: string): boolean {
  if (/%2e%2e/i.test(pathname)) return true
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return false
  }
  return decoded.split('/').some(segment => segment === '..')
}

/**
 * Decode and resolve one request pathname under an app root through `ctx.fs`.
 * @param fs - authoritative filesystem provider.
 * @param appRoot - canonical app-root target.
 * @param appRootPath - process path of the app root used as resolve cwd.
 * @param entryBaseName - basename of the entry HTML file.
 * @param pathname - raw URL pathname (still encoded).
 * @param signal - request cancellation.
 * @returns the resolved preview target classification.
 */
export async function resolvePreviewPath(
  fs: FileSystem,
  appRoot: FsTarget,
  appRootPath: string,
  entryBaseName: string,
  pathname: string,
  signal: AbortSignal,
): Promise<ResolvedPreviewPath> {
  if (hasTraversalSegments(pathname)) return { kind: 'traversal' }

  let relative: string
  try {
    relative = decodeURIComponent(pathname).replace(/^\/+/, '')
  } catch {
    return { kind: 'traversal' }
  }
  if (relative === '') relative = entryBaseName

  let target: FsTarget
  try {
    target = await fs.resolve(relative, { cwd: appRootPath, signal })
  } catch (error: unknown) {
    if (signal.aborted) throw error
    if (error instanceof FsError && error.code === 'FS_NOT_FOUND') return { kind: 'missing' }
    throw error
  }
  if (!fs.contains(appRoot, target)) return { kind: 'traversal' }

  const info = await fs.stat(target, signal)
  if (info === undefined || info.type !== 'file') return { kind: 'missing' }
  return { kind: 'file', target }
}

/**
 * Return true when the request path names the grant entry (`/` or the entry basename).
 * @param pathname - raw URL pathname (still encoded).
 * @param entryBaseName - basename of the entry HTML file.
 * @returns true when the path is the entry itself rather than another asset.
 */
export function isPreviewEntryPath(pathname: string, entryBaseName: string): boolean {
  if (hasTraversalSegments(pathname)) return false
  try {
    const relative = decodeURIComponent(pathname).replace(/^\/+/, '')
    return relative === '' || relative === entryBaseName
  } catch {
    return false
  }
}

/**
 * Return true when the request prefers an HTML navigation response.
 * @param accept - raw Accept header value.
 * @returns whether SPA fallback may serve the entry file.
 */
export function acceptsHtml(accept: string | undefined): boolean {
  if (accept === undefined) return false
  return accept.split(',').some(part => part.trim().toLowerCase().startsWith('text/html'))
}

/**
 * Build a response Content-Type, adding UTF-8 charset for text-like types.
 * @param canonicalPath - resolved file path used for MIME lookup.
 * @param lookup - MIME lookup function (injected for tests).
 * @returns the Content-Type header value.
 */
export function contentTypeForPath(
  canonicalPath: string,
  lookup: (path: string) => string | false,
): string {
  const type = lookup(canonicalPath) || 'application/octet-stream'
  if (type.startsWith('text/') || type.includes('javascript') || type.includes('json') || type.includes('xml')) {
    return `${type}; charset=utf-8`
  }
  return type
}
