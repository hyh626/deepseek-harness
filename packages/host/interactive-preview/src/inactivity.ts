/**
 * Inactivity timer helper for preview grants.
 * @module @deepseek-ai/dsh-host-interactive-preview/inactivity
 */

/**
 * Schedule or refresh one inactivity timer for a live grant.
 * @param grant - grant whose timer is updated.
 * @param timeoutMs - inactivity limit in milliseconds.
 * @param onExpire - callback invoked when the timer fires.
 */
export function scheduleInactivityTimeout(
  grant: { closed: boolean; inactivityTimer: ReturnType<typeof setTimeout> | undefined },
  timeoutMs: number,
  onExpire: () => void,
): void {
  if (grant.closed) return
  if (grant.inactivityTimer !== undefined) clearTimeout(grant.inactivityTimer)
  grant.inactivityTimer = setTimeout(onExpire, timeoutMs)
}
