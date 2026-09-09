/**
 * Security and cache response headers for preview grants.
 * @module @deepseek-ai/dsh-host-interactive-preview/headers
 */

/**
 * Build the fixed security and cache header set for one preview grant.
 * @param parentOrigin - validated parent origin for `frame-ancestors`.
 * @returns header map applied to every preview response.
 */
export function previewSecurityHeaders(parentOrigin: string): Record<string, string> {
  return {
    'Content-Security-Policy': [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      `frame-ancestors ${parentOrigin}`,
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "connect-src 'self'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "media-src 'self' blob: data:",
      "worker-src 'self' blob:",
      "frame-src 'self'",
      "form-action 'self'",
    ].join('; '),
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-DNS-Prefetch-Control': 'off',
    'Cache-Control': 'no-store',
    Vary: 'Accept',
  }
}

/**
 * Minimal headers for Host-authority mismatches (no grant metadata).
 * @returns minimal plain-text response headers without grant metadata.
 */
export function wrongHostHeaders(): Record<string, string> {
  return {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  }
}

/**
 * Headers for a 405 response.
 * @param parentOrigin - validated parent origin for security headers.
 * @returns header map for a 405 Method Not Allowed response.
 */
export function methodNotAllowedHeaders(parentOrigin: string): Record<string, string> {
  return {
    ...previewSecurityHeaders(parentOrigin),
    Allow: 'GET, HEAD',
  }
}
