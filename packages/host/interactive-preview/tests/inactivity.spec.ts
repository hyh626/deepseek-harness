/** Unit coverage for inactivity scheduling. */

import { describe, expect, it, vi } from 'vitest'
import { scheduleInactivityTimeout } from '../src/inactivity.ts'

describe('scheduleInactivityTimeout', () => {
  it('no-ops for closed grants and refreshes live timers', () => {
    vi.useFakeTimers()
    const onExpire = vi.fn()
    const grant = { closed: true, inactivityTimer: undefined as ReturnType<typeof setTimeout> | undefined }
    scheduleInactivityTimeout(grant, 100, onExpire)
    expect(grant.inactivityTimer).toBeUndefined()

    grant.closed = false
    scheduleInactivityTimeout(grant, 100, onExpire)
    expect(grant.inactivityTimer).toBeDefined()
    scheduleInactivityTimeout(grant, 100, onExpire)
    vi.advanceTimersByTime(100)
    expect(onExpire).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })
})
