import { App } from '@capacitor/app'
import { syncAppLanguage } from './deviceSettings'
import { getLang } from '../lib/uiStore'
import { LocalNotifications } from '@capacitor/local-notifications'
import { SplashScreen } from '@capacitor/splash-screen'
import { RestTimer } from './restTimerPlugin'
import { setPendingRoute } from './navigation'
import { startRestTimerBridge, onResumeRestTimer } from './restTimerBridge'
import { startReminderEngine, onResumeReminders, requestResync } from './notifications'
import { runDailyChecksOnce } from '../lib/season'
import { withSyncLock } from '../lib/sync'

/**
 * Native start-up (Android only; loaded via a dynamic import gated on `isNative`).
 * Both entry points are idempotent (module flags): React StrictMode double-invokes effects in dev.
 * Every step is best-effort: a failing plugin is logged and never blocks the app.
 */

let earlyStarted = false
let started = false
/** Resolves once the rest-timer bridge and the reminder engine have started (resume waits for it). */
let engines: Promise<void> = Promise.resolve()
let midnightTimer: ReturnType<typeof setTimeout> | undefined

async function step(name: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn()
  } catch (e) {
    console.warn(`[native] ${name} failed`, e)
  }
}

/**
 * From main.tsx before the first render: route listeners. A tap that cold-starts the app is a
 * retained plugin event, delivered as soon as the listener exists; NativeShell picks it up from
 * the pending-route queue once the router is mounted.
 */
export async function initNativeEarly(): Promise<void> {
  if (earlyStarted) return
  earlyStarted = true
  await Promise.all([
    step('notification tap listener', () =>
      LocalNotifications.addListener('localNotificationActionPerformed', a => {
        if (a.actionId === 'dismiss') return
        setPendingRoute((a.notification?.extra as { route?: unknown } | undefined)?.route)
      }),
    ),
    step('rest timer route listener', () => RestTimer.addListener('openRoute', e => setPendingRoute(e.route))),
  ])
}

/**
 * From App.tsx once the database is ready: splash, persistent storage, rest-timer bridge,
 * reminder engine, then the resume handler and the single midnight timer.
 */
export async function initNative(): Promise<void> {
  if (started) return
  started = true
  // The splash auto-hides (capacitor.config.ts); hiding again is harmless and covers a slow first paint.
  void step('splash hide', () => SplashScreen.hide({ fadeOutDuration: 200 }))
  // Native strings (rest alert, channels, widget) follow the in-app language. Before the engines,
  // so the rest-timer channels are (re)named in that language.
  await step('app language', () => syncAppLanguage(getLang()))
  // Best effort: ask the WebView not to evict IndexedDB under storage pressure.
  void step('storage persist', async () => navigator.storage?.persist?.())
  engines = (async () => {
    await step('rest timer bridge', startRestTimerBridge)
    await step('reminder engine', startReminderEngine)
  })()
  await step('resume listener', () => App.addListener('resume', () => void onResume()))
  armMidnightTimer()
  await engines
}

/** Daily checks (rank decay, season rollover) serialized with sync, so they never overlap a pull. */
function dailyChecks(): Promise<void> {
  return step('daily checks', () => withSyncLock(runDailyChecksOnce))
}

async function onResume(): Promise<void> {
  // Shared code (useLocalToday, Settings status) listens to this without importing plugins.
  window.dispatchEvent(new Event('gt:resume'))
  // Timers may have been frozen in the background: recompute the delay from the wall clock.
  armMidnightTimer()
  await engines
  // No syncNow here: the existing visibilitychange trigger in sync.ts already syncs on foreground.
  await Promise.all([
    step('rest timer resume', onResumeRestTimer),
    step('reminders resume', onResumeReminders),
    dailyChecks(),
  ])
}

/** One handle only: cleared before every re-arm (initNative, each resume, each tick). */
function armMidnightTimer(): void {
  if (midnightTimer !== undefined) clearTimeout(midnightTimer)
  const now = new Date()
  // 00:01 local tomorrow (Date normalizes the day overflow; DST-safe since Europe switches at 02:00/03:00).
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 1, 0, 0)
  midnightTimer = setTimeout(() => void onMidnight(), Math.max(1000, next.getTime() - now.getTime()))
}

async function onMidnight(): Promise<void> {
  midnightTimer = undefined
  armMidnightTimer()
  window.dispatchEvent(new Event('gt:resume'))
  await dailyChecks()
  requestResync('midnight')
}
