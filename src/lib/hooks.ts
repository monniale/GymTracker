import { useEffect, useState } from 'react'

/**
 * Ticking clock. All timers render from timestamp diffs against this value, so
 * they stay correct after iOS freezes JS timers in the background — an extra
 * update fires the moment the app becomes visible again.
 */
export function useNow(intervalMs = 250): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    const onVisible = () => {
      if (document.visibilityState === 'visible') setNow(Date.now())
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [intervalMs])
  return now
}

/**
 * Keeps the screen on while `active` (supported on iOS 16.4+). iOS releases
 * the lock on backgrounding, so it is re-requested when the app returns.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | null = null
    let cancelled = false

    const request = async () => {
      try {
        lock = await navigator.wakeLock.request('screen')
        if (cancelled) await lock.release()
      } catch {
        // Denied (low battery etc.) — non-fatal.
      }
    }
    void request()

    const onVisible = () => {
      if (document.visibilityState === 'visible') void request()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      void lock?.release().catch(() => {})
    }
  }, [active])
}
