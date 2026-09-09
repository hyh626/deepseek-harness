/**
 * Confined workspace document and image reads for the Web preview panel.
 * Every path resolves from the addressed session cwd through `ctx.fs` and must
 * remain canonically contained after symlink resolution.
 */

import { Buffer } from 'node:buffer'
import { dirname, extname } from 'node:path'
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { FsError, type FileSystem, type FsTarget } from '@deepseek-ai/dsh-fs'
import type { RpcError } from './api/rpc.ts'

/** Supported preview document formats keyed by file extension. */
export type PreviewDocumentFormat = 'markdown' | 'html'

/** Stable wire error codes for preview reads. */
export type PreviewReadErrorCode =
  | 'preview-outside-workspace'
  | 'preview-not-found'
  | 'preview-not-file'
  | 'preview-unsupported-format'
  | 'preview-unsupported-media'
  | 'preview-too-large'
  | 'preview-invalid-text'
  | 'preview-unavailable'

/** Typed preview-read failure mapped 1:1 onto RPC business errors. */
export class PreviewReadError extends Error {
  /** Stable RPC business-error code. */
  readonly code: PreviewReadErrorCode
  /** Structured values included in the RPC error. */
  readonly details: Record<string, unknown>

  constructor(
    message: string,
    code: PreviewReadErrorCode,
    details: Record<string, unknown> = {},
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'PreviewReadError'
    this.code = code
    this.details = details
  }
}

/** Configured complete-result bounds for preview reads. */
export interface PreviewReadLimits {
  previewDocumentMaxBytes: number
  previewImageMaxBytes: number
}

/** Default complete Markdown/HTML result limit: 2 MiB. */
export const DEFAULT_PREVIEW_DOCUMENT_MAX_BYTES = 2 * 1024 * 1024
/** Default complete raster image result limit: 5 MiB. */
export const DEFAULT_PREVIEW_IMAGE_MAX_BYTES = 5 * 1024 * 1024

const DOCUMENT_EXTENSIONS: Readonly<Record<string, PreviewDocumentFormat>> = {
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.html': 'html',
  '.htm': 'html',
}

const IMAGE_EXTENSIONS: Readonly<Record<string, ImageMediaType>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

/**
 * Map a resolved path to its preview document format, if supported.
 * @param path - Canonical document path.
 * @returns The supported format, or undefined for another extension.
 */
export function previewDocumentFormat(path: string): PreviewDocumentFormat | undefined {
  return DOCUMENT_EXTENSIONS[extname(path).toLowerCase()]
}

/**
 * Map a resolved path to its declared raster media type, if supported.
 * @param path - Canonical image path.
 * @returns The supported media type, or undefined for another extension.
 */
export function previewImageMediaType(path: string): ImageMediaType | undefined {
  return IMAGE_EXTENSIONS[extname(path).toLowerCase()]
}

/**
 * Convert a preview-read failure into the gateway's RPC error fields.
 * @param error - Failure thrown while resolving, checking, or reading.
 * @returns Stable public RPC error fields.
 */
export function previewReadRpcError(error: unknown): RpcError {
  if (error instanceof PreviewReadError) {
    return { code: error.code, message: error.message, details: error.details } as RpcError
  }
  if (error instanceof FsError) {
    return mapFsError(error)
  }
  return {
    code: 'internal',
    message: error instanceof Error ? error.message : String(error),
    details: {},
  }
}

function mapFsError(error: FsError): RpcError {
  switch (error.code) {
    case 'FS_NOT_FOUND':
      return { code: 'preview-not-found', message: error.message, details: { path: '' } }
    case 'FS_NOT_REGULAR_FILE':
      return { code: 'preview-not-file', message: error.message, details: { path: '' } }
    case 'FS_TOO_LARGE':
      return { code: 'preview-too-large', message: error.message, details: { path: '', limit: 0 } }
    case 'FS_NOT_TEXT':
      return { code: 'preview-invalid-text', message: error.message, details: { path: '' } }
    case 'FS_ABORTED':
      return { code: 'internal', message: error.message, details: {} }
    default:
      return { code: 'internal', message: error.message, details: {} }
  }
}

/**
 * Read one Markdown or HTML document confined to a session workspace.
 * @param fs - authoritative filesystem provider.
 * @param workspaceRoot - canonical session cwd.
 * @param path - document path relative to or within the workspace.
 * @param limits - configured complete-result bounds.
 * @param signal - caller cancellation.
 * @returns canonical path, format, and UTF-8 content.
 */
export async function readPreviewDocument(
  fs: FileSystem,
  workspaceRoot: string,
  path: string,
  limits: PreviewReadLimits,
  signal: AbortSignal,
): Promise<{ path: string; format: PreviewDocumentFormat; content: string }> {
  const root = await resolveWorkspaceRoot(fs, workspaceRoot, signal)
  const target = await resolveContainedTarget(fs, root, workspaceRoot, path, signal)
  const canonicalPath = fs.processPath(target)
  await assertRegularFile(fs, target, canonicalPath, signal)
  const format = previewDocumentFormat(canonicalPath)
  if (format === undefined) {
    throw new PreviewReadError(
      `preview does not support "${canonicalPath}"`,
      'preview-unsupported-format',
      { path: canonicalPath },
    )
  }
  const content = await readBoundedText(
    fs,
    target,
    canonicalPath,
    limits.previewDocumentMaxBytes,
    signal,
  )
  return { path: canonicalPath, format, content }
}

/**
 * Read one raster image relative to a preview document directory.
 * @param fs - authoritative filesystem provider.
 * @param workspaceRoot - canonical session cwd.
 * @param documentPath - preview document path used as the relative base.
 * @param source - image source relative to the document directory unless absolute.
 * @param limits - configured complete-result bounds.
 * @param signal - caller cancellation.
 * @returns declared media type and base64 payload.
 */
export async function readPreviewImage(
  fs: FileSystem,
  workspaceRoot: string,
  documentPath: string,
  source: string,
  limits: PreviewReadLimits,
  signal: AbortSignal,
): Promise<{ mediaType: ImageMediaType; data: string }> {
  const root = await resolveWorkspaceRoot(fs, workspaceRoot, signal)
  const documentTarget = await resolveContainedTarget(fs, root, workspaceRoot, documentPath, signal)
  const documentDir = dirname(fs.processPath(documentTarget))
  const target = await resolveContainedTarget(fs, root, documentDir, source, signal)
  const canonicalPath = fs.processPath(target)
  const mediaType = previewImageMediaType(canonicalPath)
  if (mediaType === undefined) {
    throw new PreviewReadError(
      `preview image does not support "${canonicalPath}"`,
      'preview-unsupported-media',
      { path: canonicalPath },
    )
  }
  await assertRegularFile(fs, target, canonicalPath, signal)
  const bytes = await fs.readBytes(target, signal, limits.previewImageMaxBytes)
  return { mediaType, data: Buffer.from(bytes).toString('base64') }
}

async function resolveWorkspaceRoot(
  fs: FileSystem,
  workspaceRoot: string,
  signal: AbortSignal,
): Promise<FsTarget> {
  return await fs.resolve(workspaceRoot, { signal })
}

async function resolveContainedTarget(
  fs: FileSystem,
  root: FsTarget,
  cwd: string,
  path: string,
  signal: AbortSignal,
): Promise<FsTarget> {
  let target: FsTarget
  try {
    target = await fs.resolve(path, { cwd, signal })
  } catch (error: unknown) {
    if (error instanceof FsError) throw error
    throw new PreviewReadError(
      `preview path "${path}" cannot be resolved`,
      'preview-not-found',
      { path },
      { cause: error instanceof Error ? error : undefined },
    )
  }
  if (!fs.contains(root, target)) {
    throw new PreviewReadError(
      `preview path "${path}" resolves outside the session workspace`,
      'preview-outside-workspace',
      { path },
    )
  }
  return target
}

async function assertRegularFile(
  fs: FileSystem,
  target: FsTarget,
  canonicalPath: string,
  signal: AbortSignal,
): Promise<void> {
  const info = await fs.stat(target, signal)
  if (info === undefined) {
    throw new PreviewReadError(`preview path "${canonicalPath}" was not found`, 'preview-not-found', { path: canonicalPath })
  }
  if (info.type !== 'file') {
    throw new PreviewReadError(`preview path "${canonicalPath}" is not a regular file`, 'preview-not-file', { path: canonicalPath })
  }
  return undefined
}

async function readBoundedText(
  fs: FileSystem,
  target: FsTarget,
  canonicalPath: string,
  maxBytes: number,
  signal: AbortSignal,
): Promise<string> {
  const info = await fs.stat(target, signal)
  if (info?.size !== undefined && info.size > maxBytes) {
    throw new PreviewReadError(
      `preview document "${canonicalPath}" exceeds the ${maxBytes}-byte limit`,
      'preview-too-large',
      { path: canonicalPath, limit: maxBytes, size: info.size },
    )
  }
  const chunks: string[] = []
  let bytes = 0
  const stream = await fs.streamText(target, signal)
  for await (const chunk of stream) {
    signal.throwIfAborted()
    bytes += Buffer.byteLength(chunk, 'utf8')
    if (bytes > maxBytes) {
      throw new PreviewReadError(
        `preview document "${canonicalPath}" exceeds the ${maxBytes}-byte limit`,
        'preview-too-large',
        { path: canonicalPath, limit: maxBytes, size: bytes },
      )
    }
    chunks.push(chunk)
  }
  return chunks.join('')
}
