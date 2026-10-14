import { useCallback, useEffect, useRef, useState } from 'react'
import { getDeviceStatus } from './deviceSettings'
import type { DeviceStatusRaw } from './deviceSettings'
import { refreshPermissionCache } from './notifications'

export interface NativeStatus {
  display: 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale'
  enabled: boolean
  exact: boolean
  ignoringBattery: boolean
  backgroundRestricted: boolean
  standbyBucket: number | null
  promotedAllowed: boolean
  /** Build.MANUFACTURER, lower-cased ('samsung' on Galaxy phones). */
  manufacturer: string
  sdkInt: number
  /** channel id → importance (0 = blocked by the user) */
  channels: Record<string, number>
}

/**
 * Permission state (LocalNotifications) merged with the DeviceSettings status. Each half degrades
 * on its own: a missing/broken DeviceSettings plugin still yields the permission fields.
 */
export async function loadNativeStatus(): Promise<NativeStatus> {
  const [perm, dev] = await Promise.all([
    refreshPermissionCache(),
    getDeviceStatus().catch((): DeviceStatusRaw | null => null),
  ])
  const channels: Record<string, number> = {}
  for (const c of dev?.channels ?? []) channels[c.id] = c.importance
  return {
    display: perm.display,
    enabled: perm.enabled,
    exact: dev ? perm.exact && dev.canScheduleExactAlarms : perm.exact,
    ignoringBattery: dev?.ignoringBatteryOptimizations ?? false,
    backgroundRestricted: dev?.backgroundRestricted ?? false,
    standbyBucket: dev?.standbyBucket ?? null,
    promotedAllowed: dev?.promotedAllowed ?? false,
    manufacturer: (dev?.manufacturer ?? '').toLowerCase(),
    sdkInt: dev?.sdkInt ?? 0,
    channels,
  }
}

/** Live native status for Settings: loads on mount, on window 'gt:resume' and when the page becomes visible. */
export function useNativeStatus(): { status: NativeStatus | null; refresh: () => Promise<void> } {
  const [status, setStatus] = useState<NativeStatus | null>(null)
  const mounted = useRef(true)
  const inFlight = useRef<Promise<void> | null>(null)

  const refresh = useCallback((): Promise<void> => {
    inFlight.current ??= loadNativeStatus()
      .then(s => {
        if (mounted.current) setStatus(s)
      })
      .catch(() => {})
      .finally(() => {
        inFlight.current = null
      })
    return inFlight.current
  }, [])

  useEffect(() => {
    mounted.current = true
    void refresh()
    const onResume = () => void refresh()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    window.addEventListener('gt:resume', onResume)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      mounted.current = false
      window.removeEventListener('gt:resume', onResume)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh])

  return { status, refresh }
}
