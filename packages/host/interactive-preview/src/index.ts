/**
 * @deepseek-ai/dsh-host-interactive-preview — ephemeral interactive
 * workspace-preview origins.
 * @module @deepseek-ai/dsh-host-interactive-preview
 */

export { default } from './service.ts'
export {
  DEFAULT_BIND_HOST,
  DEFAULT_HOSTNAME_SUFFIX,
  DEFAULT_INACTIVITY_TIMEOUT_MS,
  DEFAULT_MAX_ASSET_BYTES,
  DEFAULT_MAX_GRANTS,
  inject,
} from './service.ts'
export type { Config } from './service.ts'
export * from './types.ts'
export {
  hostAuthority,
  hostHeaderMatches,
  previewOrigin,
  validateCapabilityLabel,
  validateHostnameSuffix,
  validateParentOrigin,
  validatePreviewDeployment,
} from './authority.ts'
export { methodNotAllowedHeaders, previewSecurityHeaders, wrongHostHeaders } from './headers.ts'
export {
  acceptsHtml,
  contentTypeForPath,
  hasTraversalSegments,
  rawPathname,
  resolvePreviewPath,
} from './paths.ts'
