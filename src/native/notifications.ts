import { LocalNotifications } from '@capacitor/local-notifications'
import type { Channel, LocalNotificationSchema } from '@capacitor/local-notifications'
import type { PermissionState } from '@capacitor/core'
import { isNative } from './platform'
import { useNotifyStore } from '../lib/notifyStore'
import type { ResyncResult } from '../lib/notifyStore'
import { useAppStore } from '../store'
import { onDataReplaced, onSyncDirty } from '../db/db'
import { gatherPlannerData } from '../lib/notifyData'
import { pushWidgetState } from './widget'
import { getLang } from '../lib/uiStore'
import { t } from '../i18n'
import {
  CAT, CHANNEL_FOR, LEAD_MS, decodeNid, diffSchedules, isManagedId, nid, planCleanup, planHorizon, planNotifications,
} from '../lib/notifyPlanner'
import type { NotificationSpec, PendingLike } from '../lib/notifyPlanner'

/**
 * Reminder engine (Android only; loaded through gated dynamic imports). Keeps a rolling window of
 * one-shot LocalNotifications alarms equal to `planNotifications(...)` (src/lib/notifyPlanner.ts).
 *
 * LocalNotifications discipline (ROUTEMAP invariants 16–18):
 * - only one-shot `schedule.at` + `allowWhileIdle`, with an EXPLICIT `isExactNotification`
 *   (the plugin's default `true` would bounce the user to "Alarms & reminders");
 * - never `schedule()` unless notifications are granted AND enabled (8.3+ would prompt by itself);
 * - never `cancel({ notifications: [] })`, never `removeAllDeliveredNotifications()` (it would kill
 *   the rest-timer countdown 4201), only planner-managed ids (cat 10..18) are touched.
 */

export type ResyncReason = 'launch' | 'resume' | 'data' | 'import' | 'session' | 'prefs' | 'midnight' | 'permission' | 'manual'

/**
 * Reminder channels. Names and descriptions follow the app language (built at module load; a
 * language change reloads the app and `ensureChannels` re-creates the channels with the same ids,
 * which renames them in Android). Only the TEXT may change here, never an id (invariant 17).
 */
export const LN_CHANNELS: Channel[] = [
  { id: CHANNEL_FOR.workout, name: t('native.engine.channel.workout'), description: t('native.engine.channel.workoutDesc'), importance: 3, visibility: 1, vibration: true },
  { id: CHANNEL_FOR.meal, name: t('native.engine.channel.meal'), description: t('native.engine.channel.mealDesc'), importance: 3, visibility: 1, vibration: true },
  { id: CHANNEL_FOR.water, name: t('native.engine.channel.water'), description: t('native.engine.channel.waterDesc'), importance: 2, visibility: 1, vibration: false },
  { id: CHANNEL_FOR.decay, name: t('native.engine.channel.decay'), description: t('native.engine.channel.decayDesc'), importance: 3, visibility: 1, vibration: true },
  { id: CHANNEL_FOR.recap, name: t('native.engine.channel.recap'), description: t('native.engine.channel.recapDesc'), importance: 2, visibility: 1, vibration: false },
  { id: CHANNEL_FOR.supplement, name: t('native.engine.channel.supplement'), description: t('native.engine.channel.supplementDesc'), importance: 3, visibility: 1, vibration: true },
  { id: CHANNEL_FOR.keepalive, name: t('native.engine.channel.keepalive'), description: t('native.engine.channel.keepaliveDesc'), importance: 2, visibility: 1, vibration: false },
]

/** Channel ids replaced by a `_v(N+1)`: deleted on start (invariant 17). */
export const OBSOLETE_CHANNELS: string[] = []

const SMALL_ICON = 'ic_stat_gymtracker'
const ICON_COLOR = '#F97316'
const TEST_ID = nid(CAT.TEST, 0, 0)
/**
 * An app group (no summary) for every reminder. Android 16's force-grouping bundles ungrouped
 * alerting notifications synchronously and, on its base release, posts the grouped one with
 * FLAG_SILENT: a reminder arriving next to the rest countdown would make no sound. App-grouped
 * notifications are only re-checked 3 s later, after they have alerted. The rest timer's "Rest
 * over" uses its own group for the same reason (RestTimerController).
 */
const GROUP = 'gt_reminders'

/** Debounce per reason (ms); everything else runs on the next tick. */
const DEBOUNCE_MS: Partial<Record<ResyncReason, number>> = { data: 1500, prefs: 400 }

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

/* ------------------------------ channels ------------------------------ */

/** Creates the reminder channels (idempotent) and deletes obsolete ones. */
export async function ensureChannels(): Promise<void> {
  if (!isNative) return
  for (const ch of LN_CHANNELS) {
    try {
      await LocalNotifications.createChannel(ch)
    } catch {
      /* best effort: a missing channel only means its reminders do not show */
    }
  }
  for (const id of OBSOLETE_CHANNELS) {
    try {
      await LocalNotifications.deleteChannel({ id })
    } catch {
      /* already gone */
    }
  }
}

/* ------------------------------ permission cache ------------------------------ */

export interface PermissionCache {
  /** POST_NOTIFICATIONS state (Android 13+; 'granted'/'denied' below). */
  display: PermissionState
  /** App-level notification toggle (One UI / NotificationManagerCompat). */
  enabled: boolean
  /** canScheduleExactAlarms() — expected true through USE_EXACT_ALARM. */
  exact: boolean
  at: number
}

let permissionCache: PermissionCache | null = null

/** Last known permission state (null until the first refresh). */
export function getPermissionCache(): PermissionCache | null {
  return permissionCache
}

export async function refreshPermissionCache(): Promise<PermissionCache> {
  if (!isNative) return (permissionCache = { display: 'denied', enabled: false, exact: false, at: Date.now() })
  const [display, enabled, exact] = await Promise.all([
    LocalNotifications.checkPermissions().then(r => r.display, (): PermissionState => 'denied'),
    LocalNotifications.areEnabled().then(r => r.value, () => false),
    LocalNotifications.checkExactNotificationSetting().then(r => r.exact_alarm === 'granted', () => false),
  ])
  permissionCache = { display, enabled, exact, at: Date.now() }
  return permissionCache
}

const canPost = (c: PermissionCache) => c.display === 'granted' && c.enabled

/* ------------------------------ plan stamp ------------------------------ */

/** Build + timezone fingerprint: a change (APK update, travel, DST switch) forces a full re-plan. */
function currentPlanStamp(): string {
  let tz = ''
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    /* no Intl timezone */
  }
  return `${__BUILD_SHA__}|${__BUILD_TIME__}|${tz}|${new Date().getTimezoneOffset()}`
}

/** Records the current stamp; true when it differs from the stored one. */
function planStampChanged(): boolean {
  const stamp = currentPlanStamp()
  const st = useNotifyStore.getState()
  if (st.planStamp === stamp) return false
  st.setPlanStamp(stamp)
  return true
}

/* ------------------------------ resync ------------------------------ */

function toLn(s: NotificationSpec, exact: boolean): LocalNotificationSchema {
  return {
    id: s.id,
    title: s.title,
    body: s.body,
    largeBody: s.body,
    channelId: s.channelId,
    smallIcon: SMALL_ICON,
    iconColor: ICON_COLOR,
    autoCancel: true,
    group: GROUP,
    schedule: { at: new Date(s.atMs), allowWhileIdle: true },
    isExactNotification: exact,
    extra: { v: 1, route: s.route, key: s.key, atMs: s.atMs, sig: s.sig },
  }
}

const atMsOf = (n: LocalNotificationSchema): number => {
  const v = (n.extra as { atMs?: unknown } | undefined)?.atMs
  return typeof v === 'number' ? v : Date.parse(String(n.schedule?.at ?? ''))
}

/**
 * One re-plan: permission check → gather → plan → diff (or full replace) → cancel/schedule →
 * shade cleanup. Never throws; the outcome lands in `useNotifyStore.lastResync`.
 * Callers go through `requestResync` (debounced, single-flight); exported for diagnostics/tests.
 */
export async function resyncNow(opts: { full?: boolean; reason?: string } = {}): Promise<ResyncResult> {
  const reason = opts.reason ?? 'manual'
  const result: ResyncResult = { at: Date.now(), reason, scheduled: 0, cancelled: 0, cleaned: 0, exact: false }
  if (!isNative) return { ...result, skipped: 'web' }
  try {
    const c = await refreshPermissionCache()
    result.exact = c.exact
    if (!canPost(c)) {
      result.skipped = 'permission'
    } else {
      const now = Date.now()
      const { prefs } = useNotifyStore.getState()
      const input = { now, prefs, lang: getLang(), data: await gatherPlannerData(now, prefs, useAppStore.getState().activeSessionId) }
      const desired = planNotifications(input)

      const pending: PendingLike[] = (await LocalNotifications.getAll({ state: 'SCHEDULED' })).notifications
        .filter(n => isManagedId(n.id))
        // An alarm due within LEAD_MS is never in `desired` (the planner cannot re-arm it in time):
        // leave it to fire instead of cancelling it — unless reminders were just switched off.
        .filter(n => !prefs.enabled || !(atMsOf(n) <= now + LEAD_MS))
        .map(n => ({
          id: n.id,
          sig: typeof n.extra?.sig === 'string' ? n.extra.sig : undefined,
          exact: typeof n.isExactNotification === 'boolean' ? n.isExactNotification : undefined,
        }))
      const { cancel, schedule } = opts.full
        ? { cancel: pending.map(p => p.id), schedule: desired }
        : diffSchedules(pending, desired, c.exact)

      if (cancel.length) await LocalNotifications.cancel({ notifications: cancel.map(id => ({ id })) })
      result.cancelled = cancel.length
      if (schedule.length) await LocalNotifications.schedule({ notifications: schedule.map(s => toLn(s, c.exact)) })
      result.scheduled = schedule.length
      result.horizon = planHorizon(desired)
      if (!prefs.enabled) result.skipped = 'disabled'

      // Shade cleanup. Stale storage records first (fired one-shots no longer visible), THEN the
      // visible list, so a reminder firing in between is never pruned unseen.
      const triggered = (await LocalNotifications.getAll({ state: 'TRIGGERED' })).notifications
      const visible = (await LocalNotifications.getDeliveredNotifications()).notifications.map(d => d.id)
      const visibleSet = new Set(visible)
      const remove = planCleanup(visible, input)
      result.cleaned = remove.length
      const stale = triggered
        .filter(n => isManagedId(n.id) && !visibleSet.has(n.id) && atMsOf(n) < now - 60_000)
        .map(n => n.id)
      const ids = [...new Set([...remove, ...stale])]
      if (ids.length) await LocalNotifications.removeDeliveredNotificationsById({ ids })
    }
  } catch (e) {
    result.error = errMsg(e)
  }
  useNotifyStore.getState().setLastResync(result)
  return result
}

let timer: ReturnType<typeof setTimeout> | undefined
let deadline = 0
let pendingFull = false
const pendingReasons = new Set<ResyncReason>()
let inFlight: Promise<void> | null = null
let runAgain = false

function kick(): void {
  if (inFlight) {
    runAgain = true
    return
  }
  inFlight = (async () => {
    try {
      do {
        runAgain = false
        const full = pendingFull
        const reason = [...pendingReasons].join('+') || 'manual'
        pendingFull = false
        pendingReasons.clear()
        await resyncNow({ full, reason })
        // The home-screen widget rides the same triggers, whatever the notification permission.
        await pushWidgetState()
      } while (runAgain)
    } finally {
      inFlight = null
    }
  })()
}

/**
 * Asks for a re-plan. Debounced per reason (data 1.5 s, prefs 0.4 s, others immediate; the
 * earliest deadline wins) and single-flight: a request during a run queues exactly one more run.
 * `full` (cancel everything managed, then schedule) is OR-ed across coalesced requests.
 */
export function requestResync(reason: ResyncReason, opts: { full?: boolean } = {}): void {
  if (!isNative) return
  pendingReasons.add(reason)
  if (opts.full) pendingFull = true
  const delay = DEBOUNCE_MS[reason] ?? 0
  const at = Date.now() + delay
  if (timer !== undefined && deadline <= at) return
  clearTimeout(timer)
  deadline = at
  timer = setTimeout(() => {
    timer = undefined
    kick()
  }, delay)
}

/** Resolves once no re-plan is queued or running (diagnostics / tests). */
export async function whenResyncIdle(): Promise<void> {
  for (;;) {
    if (inFlight) await inFlight
    else if (timer !== undefined) await new Promise(r => setTimeout(r, Math.max(0, deadline - Date.now()) + 1))
    else return
  }
}

/* ------------------------------ triggers & lifecycle ------------------------------ */

let unsubscribeTriggers: (() => void) | null = null

/** Re-plan on data writes, imports/sync pulls, session start/finish/discard and pref edits. Idempotent. */
export function installNotificationTriggers(): () => void {
  if (unsubscribeTriggers) return unsubscribeTriggers
  const offs = [
    onSyncDirty(() => requestResync('data')),
    onDataReplaced(() => requestResync('import')),
    useAppStore.subscribe((s, prev) => {
      if (s.activeSessionId !== prev.activeSessionId) requestResync('session')
    }),
    useNotifyStore.subscribe((s, prev) => {
      if (s.prefs !== prev.prefs) requestResync('prefs')
    }),
  ]
  unsubscribeTriggers = () => {
    offs.forEach(off => off())
    unsubscribeTriggers = null
  }
  return unsubscribeTriggers
}

let started: Promise<void> | null = null

/** ensureChannels + refreshPermissionCache + installNotificationTriggers + a FULL launch re-plan. Idempotent. */
export function startReminderEngine(): Promise<void> {
  if (!isNative) return Promise.resolve()
  started ??= (async () => {
    await ensureChannels()
    await refreshPermissionCache().catch(() => null)
    installNotificationTriggers()
    planStampChanged() // record it; launch is always full anyway (alarms may have been lost while dead)
    requestResync('launch', { full: true })
  })()
  return started
}

/** On App resume: refresh the permission cache, then re-plan (full when build/timezone changed). */
export async function onResumeReminders(): Promise<void> {
  if (!isNative) return
  await refreshPermissionCache().catch(() => null)
  requestResync('resume', { full: planStampChanged() })
}

/* ------------------------------ permission flows ------------------------------ */

/** System POST_NOTIFICATIONS prompt (only from a user action), then re-plan. */
export async function requestNotificationPermission(): Promise<'granted' | 'denied' | 'prompt' | 'prompt-with-rationale'> {
  if (!isNative) return 'denied'
  useNotifyStore.getState().markPermissionAsked()
  let display: PermissionState = 'denied'
  try {
    display = (await LocalNotifications.requestPermissions()).display
  } catch {
    /* treated as denied */
  }
  await refreshPermissionCache().catch(() => null)
  requestResync('permission')
  return display
}

/** First "Start workout": ask once per install when Android would still show the prompt. */
export async function maybeAskOnFirstWorkout(): Promise<void> {
  if (!isNative) return
  const st = useNotifyStore.getState()
  if (st.permissionAsked) return
  try {
    const { display } = await LocalNotifications.checkPermissions()
    st.markPermissionAsked()
    if (display === 'prompt' || display === 'prompt-with-rationale') await requestNotificationPermission()
  } catch {
    /* never block starting a workout */
  }
}

/** "Alarms & reminders" screen (fallback when exact alarms are off), then re-plan so the window becomes exact. */
export async function openExactAlarmSettings(): Promise<void> {
  if (!isNative) return
  try {
    await LocalNotifications.changeExactNotificationSetting()
  } catch {
    /* screen unavailable */
  }
  await refreshPermissionCache().catch(() => null)
  requestResync('permission')
}

/* ------------------------------ test & summary ------------------------------ */

/**
 * One reminder `delaySec` from now (default 15 s: time to lock the phone) on the workout channel.
 * Throws when notifications are not allowed, so the UI can say so.
 */
export async function sendTestReminder(delaySec = 15): Promise<void> {
  if (!isNative) return
  const c = await refreshPermissionCache()
  if (!canPost(c)) throw new Error(t('native.engine.notAllowed'))
  await LocalNotifications.cancel({ notifications: [{ id: TEST_ID }] }).catch(() => {})
  const atMs = Date.now() + Math.max(5, delaySec) * 1000
  await LocalNotifications.schedule({
    notifications: [{
      id: TEST_ID,
      title: t('native.engine.testTitle'),
      body: t('native.engine.testBody'),
      channelId: CHANNEL_FOR.workout,
      smallIcon: SMALL_ICON,
      iconColor: ICON_COLOR,
      autoCancel: true,
      group: GROUP,
      schedule: { at: new Date(atMs), allowWhileIdle: true },
      isExactNotification: c.exact,
      extra: { v: 1, route: '/settings', key: 'test', atMs },
    }],
  })
}

/** Planner reminders currently scheduled (keep-alive excluded): count, the next one, and the last one's time. */
export async function getScheduledSummary(): Promise<{ count: number; next?: { atMs: number; title: string }; horizon?: number }> {
  if (!isNative) return { count: 0 }
  try {
    const managed = (await LocalNotifications.getAll({ state: 'SCHEDULED' })).notifications
      .filter(n => isManagedId(n.id))
      .map(n => ({ id: n.id, atMs: atMsOf(n), title: n.title }))
      .filter(n => Number.isFinite(n.atMs))
    const reminders = managed.filter(n => decodeNid(n.id)?.cat !== CAT.KEEPALIVE)
    let next: { atMs: number; title: string } | undefined
    for (const n of reminders) if (!next || n.atMs < next.atMs) next = { atMs: n.atMs, title: n.title }
    return { count: reminders.length, next, horizon: planHorizon(reminders) }
  } catch {
    return { count: 0 }
  }
}
