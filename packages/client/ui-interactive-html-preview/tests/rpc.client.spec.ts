/** Address translation and Remote result settling. */
import { describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { hostFileOf, settle } from '../src/client/rpc.ts'

describe('hostFileOf', () => {
  it('names the addressed session and its workspace-relative path', () => {
    expect(hostFileOf('dsh-resource://file/session/s-1/work/page.html'))
      .toEqual({ sessionId: 's-1' as SessionId, path: 'work/page.html' })
  })

  it('rejects absolute and non-file addresses', () => {
    expect(() => hostFileOf('dsh-resource://file/absolute/work/page.html')).toThrow(/not a session file address/)
    expect(() => hostFileOf('dsh-resource://something/else')).toThrow(/not a session file address/)
  })
})

describe('settle', () => {
  it('carries values and failure messages', () => {
    expect(settle({ ok: true, value: 3 })).toEqual({ ok: true, value: 3 })
    expect(settle({ ok: false, error: { code: 'x', message: 'boom', details: {} } as never }))
      .toEqual({ ok: false, message: 'boom' })
  })
})
