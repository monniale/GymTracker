import { App } from '@capacitor/app'

/**
 * Installed APK version for the Settings footer: `version` = versionName, `build` = versionCode.
 * Falls back to the bundle's package.json version (no build) if the plugin call fails.
 */
export async function getAppInfo(): Promise<{ version: string; build: string }> {
  try {
    const { version, build } = await App.getInfo()
    return { version, build }
  } catch {
    return { version: __APP_VERSION__, build: '' }
  }
}
