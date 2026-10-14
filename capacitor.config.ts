import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Capacitor (Android) config. Type-checked by `tsc -p tsconfig.node.json` in `npm run build:android`.
 *
 * PERMANENT identity (ROUTEMAP invariant 15): `appId` and the WebView origin (https://localhost —
 * no `server` block, never set server.hostname/androidScheme) decide where IndexedDB lives.
 * Changing either orphans every user's data. A release build refuses a `server` key (app/build.gradle).
 */
const config: CapacitorConfig = {
  appId: 'io.github.monniale.gymtracker',
  appName: 'GymTracker',
  webDir: 'dist-android',
  // Dark WebView background: no white flash before the first paint.
  backgroundColor: '#0B0F14',
  android: {
    // Debug builds are always inspectable. Opt-in for a one-off inspectable release:
    // CAP_WEBVIEW_DEBUG=1 npm run android:release -- -PallowInspectableRelease
    ...(process.env.CAP_WEBVIEW_DEBUG === '1' ? { webContentsDebuggingEnabled: true } : {}),
  },
  plugins: {
    // Edge-to-edge: insets reach CSS as --safe-area-inset-* (src/index.css); light status-bar icons.
    SystemBars: { insetsHandling: 'css', style: 'DARK', initialViewportFitValueHint: 'cover' },
    SplashScreen: { launchAutoHide: true, launchShowDuration: 600, launchFadeOutDuration: 200, backgroundColor: '#0B0F14' },
    // Reminder small icon = res/drawable/ic_stat_gymtracker.xml; accent = tailwind `primary`.
    LocalNotifications: { smallIcon: 'ic_stat_gymtracker', iconColor: '#F97316' },
  },
}

export default config
