/** Unit coverage for capability hostname helpers. */

import { describe, expect, it } from 'vitest'
import {
  hostAuthority,
  hostHeaderMatches,
  previewOrigin,
  validateCapabilityLabel,
  validateHostnameSuffix,
  validateParentOrigin,
  validatePreviewDeployment,
} from '../src/authority.ts'
import { InteractivePreviewError } from '../src/types.ts'

describe('validateHostnameSuffix', () => {
  it('accepts LDH multi-label suffixes', () => {
    expect(validateHostnameSuffix('localhost')).toBe('localhost')
    expect(validateHostnameSuffix('preview.example.com')).toBe('preview.example.com')
  })

  it('rejects authority syntax, empty labels, and non-LDH labels', () => {
    for (const bad of [
      '',
      ':bad',
      'bad:',
      'bad/host',
      'bad@host',
      ' bad',
      '.bad',
      'bad.',
      'bad..host',
      'bad?host',
      'bad#host',
      'bad\\host',
      'bad%host',
      'bad[host',
      'bad]host',
      '-bad',
      'bad-',
      'bad.-host',
    ]) {
      expect(() => validateHostnameSuffix(bad)).toThrow(/hostnameSuffix/)
    }
  })
})

describe('validatePreviewDeployment', () => {
  it('rejects all-interfaces bind with localhost suffix', () => {
    expect(() => { validatePreviewDeployment({ bindHost: '0.0.0.0', hostnameSuffix: 'localhost' }) })
      .toThrow(/0\.0\.0\.0/)
  })

  it('accepts loopback bind with localhost and remote bind with a public suffix', () => {
    expect(() => { validatePreviewDeployment({ bindHost: '127.0.0.1', hostnameSuffix: 'localhost' }) }).not.toThrow()
    expect(() => { validatePreviewDeployment({ bindHost: '0.0.0.0', hostnameSuffix: 'preview.example.com' }) }).not.toThrow()
  })
})

describe('validateParentOrigin', () => {
  it('accepts bare http and https origins', () => {
    expect(validateParentOrigin('http://127.0.0.1:3000')).toBe('http://127.0.0.1:3000')
    expect(validateParentOrigin('https://app.example.com')).toBe('https://app.example.com')
  })

  it('rejects origins with paths, queries, fragments, or userinfo', () => {
    for (const bad of [
      'not-a-url',
      'ftp://example.com',
      'http://example.com/path',
      'http://example.com?x=1',
      'http://example.com#frag',
      'http://user@example.com',
    ]) {
      expect(() => validateParentOrigin(bad)).toThrow(InteractivePreviewError)
    }
  })
})

describe('validateCapabilityLabel', () => {
  it('accepts the 32-character lowercase hex labels the service mints', () => {
    expect(validateCapabilityLabel('0123456789abcdef0123456789abcdef')).toBe('0123456789abcdef0123456789abcdef')
  })

  it('rejects non-hex, wrong length, and punctuation', () => {
    for (const bad of ['abc-123', 'ABC123', 'abc_123', 'short', '0123456789abcdef0123456789abcde', '0123456789abcdef0123456789abcdef0']) {
      expect(() => validateCapabilityLabel(bad)).toThrow(/capability label/)
    }
  })
})

describe('hostAuthority and previewOrigin', () => {
  it('builds a stable authority and origin', () => {
    const capability = '0123456789abcdef0123456789abcdef'
    expect(hostAuthority(capability, 'localhost', 8080)).toBe(`${capability}.localhost:8080`)
    expect(previewOrigin(`${capability}.localhost:8080`)).toBe(`http://${capability}.localhost:8080`)
  })
})

describe('hostHeaderMatches', () => {
  it('matches the minted authority case-insensitively', () => {
    expect(hostHeaderMatches('Cap.Localhost:8080', 'cap.localhost:8080')).toBe(true)
    expect(hostHeaderMatches(undefined, 'cap.localhost:8080')).toBe(false)
    expect(hostHeaderMatches('wrong.localhost:8080', 'cap.localhost:8080')).toBe(false)
  })
})
