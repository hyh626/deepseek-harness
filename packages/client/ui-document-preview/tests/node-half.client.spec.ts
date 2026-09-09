import { describe, expect, it } from 'vitest'
import { apply } from '../src/index.ts'

describe('node half', () => {
  it('exposes an empty host apply', () => {
    apply()
    expect(apply).toBeTypeOf('function')
  })
})
