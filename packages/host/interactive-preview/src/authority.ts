/**
 * Capability hostname construction and Host-header validation.
 * @module @deepseek-ai/dsh-host-interactive-preview/authority
 */

import { InteractivePreviewError } from './types.ts'

/** RFC1123 LDH hostname label (lowercase). */
const LDH_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

/** Minted capability labels: 32 lowercase hex characters. */
const CAPABILITY_LABEL = /^[a-f0-9]{32}$/

/**
 * Reject hostname suffix values outside a strict per-label LDH allowlist.
 * @param suffix - configured hostname suffix.
 * @returns the validated suffix.
 * @throws when any label or the full suffix carries authority or non-LDH syntax.
 */
export function validateHostnameSuffix(suffix: string): string {
  if (
    suffix.length === 0
    || suffix.includes('/')
    || suffix.includes(':')
    || suffix.includes('@')
    || suffix.includes('\\')
    || suffix.includes('%')
    || suffix.includes('?')
    || suffix.includes('#')
    || suffix.includes('[')
    || suffix.includes(']')
    || /\s/.test(suffix)
    || suffix.startsWith('.')
    || suffix.endsWith('.')
  ) {
    throw new Error(`interactive preview hostnameSuffix "${suffix}" is not a bare DNS suffix`)
  }
  const labels = suffix.split('.')
  if (labels.some(label => label.length === 0)) {
    throw new Error(`interactive preview hostnameSuffix "${suffix}" contains an empty label`)
  }
  for (const label of labels) {
    if (!LDH_LABEL.test(label)) {
      throw new Error(`interactive preview hostnameSuffix "${suffix}" contains a non-LDH label`)
    }
  }
  return suffix
}

/**
 * Reject unusable bind and suffix pairings at load time.
 * @param config - bind host and validated suffix.
 * @throws when remote bind is paired with a loopback-only suffix.
 */
export function validatePreviewDeployment(config: { bindHost: '127.0.0.1' | '0.0.0.0'; hostnameSuffix: string }): void {
  if (config.bindHost === '0.0.0.0' && config.hostnameSuffix === 'localhost') {
    throw new Error('interactive preview cannot bind 0.0.0.0 with hostnameSuffix localhost')
  }
}

/**
 * Validate a trusted parent origin for CSP `frame-ancestors`.
 * @param origin - caller-supplied parent origin.
 * @returns the normalized bare `http:`/`https:` origin.
 * @throws {InteractivePreviewError} when the value is not a bare origin.
 */
export function validateParentOrigin(origin: string): string {
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    throw new InteractivePreviewError(
      `interactive preview parentOrigin "${origin}" is not a valid URL`,
      'preview-invalid-parent-origin',
    )
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new InteractivePreviewError(
      `interactive preview parentOrigin "${origin}" must use http or https`,
      'preview-invalid-parent-origin',
    )
  }
  if (url.username !== '' || url.password !== '') {
    throw new InteractivePreviewError(
      `interactive preview parentOrigin "${origin}" must not include userinfo`,
      'preview-invalid-parent-origin',
    )
  }
  if (url.pathname !== '' && url.pathname !== '/') {
    throw new InteractivePreviewError(
      `interactive preview parentOrigin "${origin}" must not include a path`,
      'preview-invalid-parent-origin',
    )
  }
  if (url.search !== '' || url.hash !== '') {
    throw new InteractivePreviewError(
      `interactive preview parentOrigin "${origin}" must not include a query or fragment`,
      'preview-invalid-parent-origin',
    )
  }
  return url.origin
}

/**
 * Validate a minted capability label before it is embedded in a hostname.
 * @param capability - cryptographically random label.
 * @returns the validated label.
 * @throws when the label is not a 32-character lowercase hex string.
 */
export function validateCapabilityLabel(capability: string): string {
  if (!CAPABILITY_LABEL.test(capability)) {
    throw new Error(`interactive preview capability label "${capability}" is not hostname-safe`)
  }
  return capability
}

/**
 * Build the exact Host authority clients must send.
 * @param capability - minted capability label.
 * @param suffix - validated hostname suffix.
 * @param port - listening port.
 * @returns authority in `<label>.<suffix>:<port>` form.
 */
export function hostAuthority(capability: string, suffix: string, port: number): string {
  return `${validateCapabilityLabel(capability)}.${validateHostnameSuffix(suffix)}:${String(port)}`
}

/**
 * Build the complete HTTP origin for one grant.
 * @param authority - exact Host authority for the grant.
 * @returns `http://` origin (preview grants are plain HTTP).
 */
export function previewOrigin(authority: string): string {
  return `http://${authority}`
}

/**
 * Compare a request Host header to the minted authority.
 * @param header - raw Host header value.
 * @param expected - minted authority for the grant.
 * @returns true when the header matches exactly (case-insensitive).
 */
export function hostHeaderMatches(header: string | undefined, expected: string): boolean {
  if (header === undefined) return false
  return header.toLowerCase() === expected.toLowerCase()
}
