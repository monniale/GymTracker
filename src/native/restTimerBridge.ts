import { LocalNotifications } from '@capacitor/local-notifications'
import { isAndroid } from './platform'
import { RestTimer } from './restTimerPlugin'
import type { RestTimerStartOptions } from './restTimerPlugin'
import { useAppStore } from '../store'
import type { RestTimer as StoreRest } from '../store'
import { useNotifyStore } from '../lib/notifyStore'
import type { RestAlertPrefs } from '../lib/notifyPrefs'

/**
 * Mirrors the app store's `rest` slice into the native `RestTimer` plugin (Android only) and back.
 *
 * - JS → native: a `useAppStore` subscription starts / stops the native timer (`bridgeAction`).
 *   Natural expiry (RestTimerBar's 4 s auto-clear) does nothing: the native "Rest over" alert
 *   must survive it.
 * - Native → JS: the shade's +15 s / Skip arrive as `actionExtend` / `actionSkip` and are applied
 *   with `applyingNative` set, so nothing echoes back to native.
 * - Reconcile (start-up + resume): native is the truth for changes made while JS was dead; a
 *   running native timer is re-armed (an end alarm lost to a force-stop) — `reconcileDecision`.
 *
 * The native timer only runs when notifications may be displayed (LocalNotifications permission,
 * cached here and refreshed on resume) and the rest prefs (`useNotifyStore().rest`) enable the
 * countdown or the alert for that rest (warm-up rests alert only with `warmupAlert`).
 * All native calls run one at a time (`serial`), in the order the store changed.
 */

export interface RestLike {
  endsAt: number
  totalSec: number
  label?: string
  warmup?: boolean
}

export type ReconcileDecision = 'none' | 'adopt-native' | 'clear-store' | 'stop-native-and-clear' | 'rearm-native'

/** A rest is worth (re)starting natively only when it ends further ahead than this. */
const LEAD_MS = 500
/** A native timer still "running" this long after its end lost its end alarm (reboot, force-stop). */
const LOST_ALARM_MS = 2000
/** A JS rest this far from its end, but stopped natively, was skipped from the shade. */
const SKIPPED_MS = 1000
/** A JS rest that ended this long ago is a stale "Rest over" left from before a relaunch. */
const STALE_MS = 10_000

const DEFAULT_BODY = 'Next set when this hits zero'

/**
 * What to do with the store (`cur`) given the native timer state (`native`) at `now`.
 * - native running and live → it is the truth: `adopt-native` if the store differs (+15 s / −15 s
 *   from the shade while JS was dead), else `rearm-native` (start() is idempotent; re-arms a lost alarm);
 * - native "running" long past its end → its alarm was lost: hand it the store's live rest
 *   (`rearm-native`), else `stop-native-and-clear`;
 * - native stopped, store rest still ahead → `clear-store` if native stopped THIS timer (Skip from
 *   the shade), else `rearm-native` (native never got it, e.g. the bridge was off when it started);
 * - store rest ended long ago → `clear-store`.
 */
export function reconcileDecision(
  native: { running: boolean; endAt: number; totalSec: number },
  cur: { endsAt: number; totalSec: number } | null,
  now: number,
): ReconcileDecision {
  if (native.running) {
    if (native.endAt >= now - LOST_ALARM_MS) {
      if (cur === null || cur.endsAt !== native.endAt) return 'adopt-native'
      return native.endAt > now + LEAD_MS ? 'rearm-native' : 'none'
    }
    return cur !== null && cur.endsAt > now + LEAD_MS ? 'rearm-native' : 'stop-native-and-clear'
  }
  if (cur === null) return 'none'
  if (cur.endsAt > now + SKIPPED_MS) return native.endAt === cur.endsAt ? 'clear-store' : 'rearm-native'
  if (cur.endsAt < now - STALE_MS) return 'clear-store'
  return 'none'
}

/**
 * JS → native for one store change (`prev` → `next`). `enabled` = the native timer may run `next`
 * (permission granted and the prefs enable its countdown or alert). It gates only 'start': a stop
 * is always sent, so a timer started under earlier prefs never alerts after a skip / finish.
 * A rest that already ended (`prev` expired, RestTimerBar's auto-clear) → 'none': native ended it
 * itself and its "Rest over" alert must stay.
 */
export function bridgeAction(prev: RestLike | null, next: RestLike | null, now: number, enabled: boolean): 'none' | 'start' | 'stop' {
  const live = (r: RestLike | null): r is RestLike => r !== null && r.endsAt > now + LEAD_MS
  if (live(next) && enabled) {
    const same =
      prev !== null &&
      prev.endsAt === next.endsAt &&
      prev.totalSec === next.totalSec &&
      prev.label === next.label &&
      !!prev.warmup === !!next.warmup
    return same ? 'none' : 'start'
  }
  return live(prev) ? 'stop' : 'none'
}

/**
 * Native start options for `rest` under `prefs`, or null when nothing would show (countdown off
 * and no alert for this rest). Warm-up rests alert only when `warmupAlert` is on.
 */
export function nativeStartOptions(rest: RestLike, prefs: RestAlertPrefs): RestTimerStartOptions | null {
  const alert = prefs.alert && (!rest.warmup || prefs.warmupAlert)
  if (!prefs.countdown && !alert) return null
  return {
    endAt: rest.endsAt,
    totalSec: rest.totalSec,
    title: 'Rest',
    body: rest.label || DEFAULT_BODY,
    countdown: prefs.countdown,
    alert,
    alertMode: prefs.alertMode,
  }
}

// ------------------------------------------------------------------------------------------ runtime

let started = false
/** Cached LocalNotifications display permission; refreshed on start-up, resume and lazily. */
let displayGranted = false
/** Set while a native event is applied to the store (no echo back to native). */
let applyingNative = false
/** Bumped by every JS → native push; a reconcile that raced one is dropped (the push wins). */
let pushSeq = 0
let queue: Promise<void> = Promise.resolve()

/** Runs native calls one at a time, in order; a failure is logged and never breaks the chain. */
function serial(op: () => Promise<unknown>): Promise<void> {
  queue = queue.then(op).then(
    () => undefined,
    e => console.warn('[restTimer]', e),
  )
  return queue
}

async function refreshPermission(): Promise<boolean> {
  try {
    displayGranted = (await LocalNotifications.checkPermissions()).display === 'granted'
  } catch {
    displayGranted = false
  }
  return displayGranted
}

const restPrefs = (): RestAlertPrefs => useNotifyStore.getState().rest

function fromNative(rest: StoreRest | null): void {
  applyingNative = true
  try {
    useAppStore.setState({ rest })
  } finally {
    applyingNative = false
  }
}

/** Keeps the label / warm-up flag of the store's rest when native moves its end. */
function adopt(endAt: number, totalSec: number): void {
  const cur = useAppStore.getState().rest
  fromNative({ ...cur, endsAt: endAt, totalSec })
}

/** (Re)start native for `rest` if it may run it, else make sure native is not running. */
async function applyToNative(rest: RestLike | null): Promise<void> {
  const opts = rest && rest.endsAt > Date.now() + LEAD_MS ? nativeStartOptions(rest, restPrefs()) : null
  if (opts && displayGranted) await RestTimer.start(opts)
  else await RestTimer.stop()
}

function onStoreRest(next: StoreRest | null, prev: StoreRest | null): void {
  if (applyingNative || next === prev) return
  pushSeq++
  void serial(async () => {
    // A permission granted since the last check (e.g. the first-workout prompt) counts right away.
    if (next && !displayGranted) await refreshPermission()
    const opts = next ? nativeStartOptions(next, restPrefs()) : null
    const action = bridgeAction(prev, next, Date.now(), displayGranted && opts !== null)
    if (action === 'start' && opts) await RestTimer.start(opts)
    else if (action === 'stop') await RestTimer.stop()
  })
}

/** Rest prefs changed mid-rest: re-apply them to the running rest (start with new options, or stop). */
function onRestPrefs(): void {
  const cur = useAppStore.getState().rest
  if (!cur || cur.endsAt <= Date.now() + LEAD_MS) return
  pushSeq++
  void serial(() => applyToNative(useAppStore.getState().rest))
}

async function reconcile(): Promise<void> {
  const p = restPrefs()
  if (!displayGranted || !(p.countdown || p.alert)) return
  const seq = pushSeq
  await serial(async () => {
    const n = await RestTimer.getState()
    if (seq !== pushSeq) return // a JS change was queued meanwhile: it brings native in line
    const cur = useAppStore.getState().rest
    const now = Date.now()
    switch (reconcileDecision(n, cur, now)) {
      case 'adopt-native':
        adopt(n.endAt, n.totalSec)
        if (n.endAt > now + LEAD_MS) await applyToNative(useAppStore.getState().rest) // re-arm too
        break
      case 'rearm-native':
        if (cur && nativeStartOptions(cur, restPrefs())) await applyToNative(cur)
        else if (n.running) await RestTimer.stop()
        break
      case 'clear-store':
        // Native's stopped state is evidence of a Skip only if native was meant to run this rest.
        if (cur && (cur.endsAt < now || nativeStartOptions(cur, restPrefs()))) fromNative(null)
        break
      case 'stop-native-and-clear':
        await RestTimer.stop()
        if (useAppStore.getState().rest === cur && cur) fromNative(null)
        break
      case 'none':
        break
    }
  })
}

/**
 * Installs the store subscriptions + plugin listeners and reconciles once (from initNative).
 * Idempotent; a no-op off Android.
 */
export async function startRestTimerBridge(): Promise<void> {
  if (!isAndroid || started) return
  started = true
  useAppStore.subscribe((s, prev) => onStoreRest(s.rest, prev.rest))
  useNotifyStore.subscribe((s, prev) => {
    if (s.rest !== prev.rest) onRestPrefs()
  })
  await Promise.all([
    RestTimer.addListener('actionExtend', e => adopt(e.endAt, e.totalSec)),
    RestTimer.addListener('actionSkip', () => {
      if (useAppStore.getState().rest) fromNative(null)
    }),
    // Nothing to do (RestTimerBar shows "Rest over" from its own clock; a dismissed countdown keeps
    // its end alarm), but listening consumes the events: without a listener Capacitor retains each one.
    RestTimer.addListener('timerEnd', () => {}),
    RestTimer.addListener('notificationDismissed', () => {}),
  ])
  await onResumeRestTimer()
}

/** App resumed: refresh the permission cache, then reconcile the store with the native timer. */
export async function onResumeRestTimer(): Promise<void> {
  if (!isAndroid || !started) return
  await refreshPermission()
  await reconcile()
}
