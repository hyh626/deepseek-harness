/** Invariant companion registration. */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Invariants from '@deepseek-ai/dsh-invariants'
import { apply, name } from '../src/invariant.ts'

describe('interactive-preview invariant', () => {
  it('registers the package ownership slot', async () => {
    const ctx = new Context()
    await ctx.plugin(Invariants)
    const dispose = await apply(ctx)
    expect(name).toBe('host-interactive-preview-invariant')
    dispose()
  })
})
