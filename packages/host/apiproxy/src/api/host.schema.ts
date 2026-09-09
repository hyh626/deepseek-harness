/**
 * host domain zod schemas (names derived from map keys).
 */

import { z } from 'zod'
import type { DirectoryEntry, InteractivePreviewId } from './host.ts'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import { sessionIdSchema } from './sessions.schema.ts'

/** host.describe request payload (empty object literal). */
export const hostDescribeRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'host.describe'>>>

/** host.describe response value. */
export const hostDescribeValueSchema = z.object({
  version: z.string(),
  cwd: z.string(),
  provider: z.string().optional(),
  model: z.string().optional(),
  attachedSessions: z.number().int().nonnegative(),
  canOpenPath: z.boolean(),
}) satisfies z.ZodType<Wire<ResponseValue<'host.describe'>>>

/** host.pickDirectory request payload (empty object literal). */
export const hostPickDirectoryRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'host.pickDirectory'>>>

/** host.pickDirectory response value; null means the user cancelled. */
export const hostPickDirectoryValueSchema = z.object({
  path: z.string().nullable(),
}) satisfies z.ZodType<Wire<ResponseValue<'host.pickDirectory'>>>

/** Directory row shared by listing entries and breadcrumb crumbs. */
export const directoryEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  hidden: z.boolean(),
}) satisfies z.ZodType<Wire<DirectoryEntry>>

/** host.listDirectory request payload; an absent path lists the home directory. */
export const hostListDirectoryRequestSchema = z.object({
  path: z.string().optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'host.listDirectory'>>>

/** host.listDirectory response value. */
export const hostListDirectoryValueSchema = z.object({
  path: z.string(),
  home: z.string(),
  crumbs: z.array(directoryEntrySchema),
  entries: z.array(directoryEntrySchema),
  truncated: z.boolean(),
}) satisfies z.ZodType<Wire<ResponseValue<'host.listDirectory'>>>

/** host.createDirectory request payload: name must be one plain path segment. */
export const hostCreateDirectoryRequestSchema = z.object({
  path: z.string(),
  name: z.string(),
}).refine(
  payload => payload.name.trim() !== '' && payload.name !== '.' && payload.name !== '..'
    && !/[/\\]/.test(payload.name),
  { message: 'host.createDirectory requires a single non-blank path segment name' },
) satisfies z.ZodType<Wire<RequestPayload<'host.createDirectory'>>>

/** host.createDirectory response value: the created directory's absolute path. */
export const hostCreateDirectoryValueSchema = z.object({
  path: z.string(),
}) satisfies z.ZodType<Wire<ResponseValue<'host.createDirectory'>>>
/** host.openPath request payload. */
export const hostOpenPathRequestSchema = z.object({
  path: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'host.openPath'>>>

/** host.openPath response value. */
export const hostOpenPathValueSchema = z.object({
  opened: z.literal(true),
}) satisfies z.ZodType<Wire<ResponseValue<'host.openPath'>>>

/** host.readPreviewDocument request payload. */
export const hostReadPreviewDocumentRequestSchema = z.object({
  sessionId: sessionIdSchema,
  path: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'host.readPreviewDocument'>>>

/** host.readPreviewDocument response value. */
export const hostReadPreviewDocumentValueSchema = z.object({
  path: z.string(),
  format: z.enum(['markdown', 'html']),
  content: z.string(),
}) satisfies z.ZodType<Wire<ResponseValue<'host.readPreviewDocument'>>>

/** host.readPreviewImage request payload. */
export const hostReadPreviewImageRequestSchema = z.object({
  sessionId: sessionIdSchema,
  documentPath: z.string().min(1),
  source: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'host.readPreviewImage'>>>

const previewImageMediaTypeSchema = z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

/** host.readPreviewImage response value. */
export const hostReadPreviewImageValueSchema = z.object({
  mediaType: previewImageMediaTypeSchema,
  data: z.string(),
}) satisfies z.ZodType<Wire<ResponseValue<'host.readPreviewImage'>>>

/** Branded interactive preview grant id on the wire. */
export const interactivePreviewIdSchema = z.string().min(1) as unknown as z.ZodType<InteractivePreviewId>

/** host.startInteractivePreview request payload. */
export const hostStartInteractivePreviewRequestSchema = z.object({
  sessionId: sessionIdSchema,
  path: z.string().min(1),
  parentOrigin: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'host.startInteractivePreview'>>>

/** host.startInteractivePreview response value. */
export const hostStartInteractivePreviewValueSchema = z.object({
  id: interactivePreviewIdSchema,
  origin: z.string().min(1),
}) satisfies z.ZodType<Wire<ResponseValue<'host.startInteractivePreview'>>>

/** host.stopInteractivePreview request payload. */
export const hostStopInteractivePreviewRequestSchema = z.object({
  id: interactivePreviewIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'host.stopInteractivePreview'>>>

/** host.stopInteractivePreview response value. */
export const hostStopInteractivePreviewValueSchema = z.object({
  stopped: z.literal(true),
}) satisfies z.ZodType<Wire<ResponseValue<'host.stopInteractivePreview'>>>
