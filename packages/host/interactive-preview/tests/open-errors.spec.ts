/** Unit coverage for open-path disposal errors. */

import { describe, expect, it } from 'vitest'
import { rethrowUnlessDisposed } from '../src/open-errors.ts'
import { InteractivePreviewError } from '../src/types.ts'

describe('rethrowUnlessDisposed', () => {
  it('maps disposal to preview-disposed and preserves other errors', () => {
    const signal = new AbortController()
    expect(() => rethrowUnlessDisposed(true, signal.signal, new Error('other')))
      .toThrow(InteractivePreviewError)
    expect(() => rethrowUnlessDisposed(false, signal.signal, new Error('other'))).toThrow('other')
    signal.abort()
    expect(() => rethrowUnlessDisposed(false, signal.signal, new Error('other')))
      .toThrow(InteractivePreviewError)
  })
})
