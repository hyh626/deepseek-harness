/** Unit coverage for preview response headers. */

import { describe, expect, it } from 'vitest'
import { methodNotAllowedHeaders, previewSecurityHeaders, wrongHostHeaders } from '../src/headers.ts'

describe('previewSecurityHeaders', () => {
  it('embeds the parent origin, object-src, and cache directives', () => {
    const headers = previewSecurityHeaders('http://127.0.0.1:3000')
    const csp = headers['Content-Security-Policy'] ?? ''
    expect(csp).toContain("base-uri 'self'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain('frame-ancestors http://127.0.0.1:3000')
    expect(csp).toContain("script-src 'self' 'unsafe-inline'")
    expect(csp.match(/script-src [^;]+/)?.[0]).not.toContain('data:')
    expect(headers['Cache-Control']).toBe('no-store')
    expect(headers.Vary).toBe('Accept')
  })
})

describe('wrongHostHeaders', () => {
  it('returns minimal non-grant headers', () => {
    const headers = wrongHostHeaders()
    expect(headers['Content-Type']).toBe('text/plain; charset=utf-8')
    expect(headers['Cache-Control']).toBe('no-store')
    expect(headers['Content-Security-Policy']).toBeUndefined()
    expect(headers['frame-ancestors']).toBeUndefined()
  })
})

describe('methodNotAllowedHeaders', () => {
  it('includes Allow on top of the security set', () => {
    expect(methodNotAllowedHeaders('http://127.0.0.1:3000').Allow).toBe('GET, HEAD')
  })
})
