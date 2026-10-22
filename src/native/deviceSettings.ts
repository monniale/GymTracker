import { registerPlugin } from '@capacitor/core'

/**
 * App-local `DeviceSettings` plugin (android/.../devicesettings/DeviceSettingsPlugin.java):
 * notification / alarm / battery status, and deep links into system settings. Android only —
 * there is no web implementation (this module is only ever loaded behind `isNative`).
 */

export type DeviceSettingsTarget =
  | 'app_notifications'
  | 'channel'
  | 'exact_alarm'
  | 'battery_request'
  | 'battery_list'
  | 'samsung_never_sleeping'
  | 'promotion'
  | 'app_details'

/** Raw `getStatus()` result. Fields that need a newer API than the device has are absent. */
export interface DeviceStatusRaw {
  notificationsEnabled: boolean
  canScheduleExactAlarms: boolean
  ignoringBatteryOptimizations: boolean
  /** API 28+ */
  backgroundRestricted?: boolean
  /** API 28+: 5 exempted, 10 active, 20 working set, 30 frequent, 40 rare, 45 restricted, 50 never */
  standbyBucket?: number
  /** Android 16 Live Updates allowed for this app (false below API 36). */
  promotedAllowed: boolean
  /** importance 0 = blocked by the user */
  channels: { id: string; importance: number }[]
  manufacturer: string
  sdkInt: number
}

export interface DeviceSettingsPlugin {
  getStatus(): Promise<DeviceStatusRaw>
  /** Resolves `{ fallback: true }` when the target screen was missing and app details opened instead; rejects 'UNAVAILABLE'. */
  open(options: { target: DeviceSettingsTarget; channelId?: string }): Promise<{ fallback: boolean }>
  /** Android 13+: the app's Java resources follow `lang` ('' = the phone's language). */
  setAppLanguage(options: { lang: string }): Promise<{ applied: boolean }>
}

export const DeviceSettings = registerPlugin<DeviceSettingsPlugin>('DeviceSettings')

export async function getDeviceStatus(): Promise<DeviceStatusRaw> {
  return DeviceSettings.getStatus()
}

/**
 * Opens a system settings screen (falls back to the app's details page natively). Never throws:
 * a device without the screen just does nothing; Settings re-reads the status on 'gt:resume'.
 */
export async function openDeviceSettings(target: DeviceSettingsTarget, channelId?: string): Promise<void> {
  try {
    await DeviceSettings.open(channelId ? { target, channelId } : { target })
  } catch (e) {
    console.warn('DeviceSettings.open failed', target, e)
  }
}

/** Keeps the native side (rest-timer alert, channel names, widget) in the in-app language. Never throws. */
export async function syncAppLanguage(lang: string): Promise<void> {
  try {
    await DeviceSettings.setAppLanguage({ lang })
  } catch (e) {
    console.warn('DeviceSettings.setAppLanguage failed', e)
  }
}
