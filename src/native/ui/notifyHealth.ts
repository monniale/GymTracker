import type { NativeStatus } from '../status'
import type { HHMM, NotifyPrefs, RestAlertPrefs } from '../../lib/notifyPrefs'
import { localDateStr } from '../../lib/dates'
import { t } from '../../i18n'

/**
 * Pure helpers behind the native Settings UI (NotificationsSection, RestTimerNativeSettings):
 * which reliability items are failing, which channels the user muted in Android, and the copy
 * that depends on them. No React, no Capacitor (type-only imports), unit-tested.
 */

/** Android notification channel ids (amendments A5/A6). Fixed forever: channels are immutable. */
export const CHANNEL = {
  workout: 'workout_reminders_v1',
  meals: 'meal_reminders_v1',
  water: 'water_reminders_v1',
  rank: 'rank_alerts_v1',
  recap: 'weekly_recap_v1',
  supplements: 'supplement_reminders_v1',
  status: 'app_status_v1',
  restCountdown: 'rest_countdown_v1',
  restAlertLoud: 'rest_alert_v1',
  restAlertQuiet: 'rest_alert_quiet_v1',
} as const

export type CategoryKey = 'workout' | 'meals' | 'water' | 'rank' | 'recap' | 'weighIn' | 'supplements'
export const CATEGORY_KEYS: CategoryKey[] = ['workout', 'meals', 'water', 'rank', 'recap', 'weighIn', 'supplements']

/** The channel each Settings category posts on (weigh-in and the open-session nudge share workout's). */
export const CATEGORY_CHANNEL: Record<CategoryKey, string> = {
  workout: CHANNEL.workout,
  meals: CHANNEL.meals,
  water: CHANNEL.water,
  rank: CHANNEL.rank,
  recap: CHANNEL.recap,
  weighIn: CHANNEL.workout,
  supplements: CHANNEL.supplements,
}

/** True when the category would schedule something (ignores the master switch). */
export function categoryOn(p: NotifyPrefs, k: CategoryKey): boolean {
  switch (k) {
    case 'workout':
      return p.workout.enabled || p.workout.openSessionNudge
    case 'meals':
      return Object.values(p.meals).some(m => m.enabled)
    case 'water':
      return p.water.enabled
    case 'rank':
      return p.rank.decayWarning || p.rank.streakWarning
    case 'recap':
      return p.recap.enabled
    case 'weighIn':
      return p.weighIn.enabled
    case 'supplements':
      return p.supplements.enabled
  }
}

/** Master switch on and at least one category on. */
export function remindersActive(p: NotifyPrefs): boolean {
  return p.enabled && CATEGORY_KEYS.some(k => categoryOn(p, k))
}

export function enabledCategoryCount(p: NotifyPrefs): number {
  return CATEGORY_KEYS.filter(k => categoryOn(p, k)).length
}

/** A channel the user switched off in Android (importance 0). Unknown / not yet created → false. */
export function isMuted(channels: Record<string, number> | undefined, channelId: string): boolean {
  return channels?.[channelId] === 0
}

/**
 * The categories that are on but whose channel the user switched off in Android, so Android drops
 * them silently. Only once notifications are allowed at all (the health row covers that) and the
 * master switch is on.
 */
export function mutedCategories(
  s: Pick<NativeStatus, 'display' | 'enabled' | 'channels'> | null,
  p: NotifyPrefs,
): CategoryKey[] {
  if (!s || !p.enabled || notificationsState(s) !== 'ok') return []
  return CATEGORY_KEYS.filter(k => categoryOn(p, k) && isMuted(s.channels, CATEGORY_CHANNEL[k]))
}

export type NotificationsState = 'ok' | 'prompt' | 'denied' | 'off'

/** Runtime permission first; then One UI's per-app switch (`enabled`). */
export function notificationsState(s: Pick<NativeStatus, 'display' | 'enabled'>): NotificationsState {
  if (s.display === 'prompt' || s.display === 'prompt-with-rationale') return 'prompt'
  if (s.display === 'denied') return 'denied'
  return s.enabled ? 'ok' : 'off'
}

export type HealthItem =
  | { id: 'notifications'; required: true; state: Exclude<NotificationsState, 'ok'> }
  | { id: 'exact'; required: true }
  | { id: 'battery'; required: true; state: 'optimised' | 'restricted' }
  | { id: 'samsung'; required: true }
  | { id: 'promotion'; required: false }

/**
 * Only the FAILING reliability items, required ones first. Battery and Samsung's "Never sleeping
 * apps" only matter for scheduled reminders (the rest alert fires minutes after the app was in
 * use), so they are listed only while reminders are active. The status-bar live countdown
 * (Android 16+ promotion) is optional polish and never counts as "needs attention".
 */
export function healthItems(
  s: NativeStatus,
  ctx: { remindersActive: boolean; samsungDone: boolean; countdown: boolean },
): HealthItem[] {
  const out: HealthItem[] = []
  const n = notificationsState(s)
  if (n !== 'ok') out.push({ id: 'notifications', required: true, state: n })
  if (!s.exact) out.push({ id: 'exact', required: true })
  if (ctx.remindersActive) {
    if (s.backgroundRestricted) out.push({ id: 'battery', required: true, state: 'restricted' })
    else if (!s.ignoringBattery) out.push({ id: 'battery', required: true, state: 'optimised' })
    if (isSamsung(s) && !ctx.samsungDone) out.push({ id: 'samsung', required: true })
  }
  if (ctx.countdown && s.sdkInt >= 36 && !s.promotedAllowed) out.push({ id: 'promotion', required: false })
  return out
}

export function isSamsung(s: Pick<NativeStatus, 'manufacturer'>): boolean {
  return s.manufacturer.trim().toLowerCase() === 'samsung'
}

/** The channel the rest-over alert posts on for the chosen mode. */
export function restAlertChannel(mode: RestAlertPrefs['alertMode']): string {
  return mode === 'alarm' ? CHANNEL.restAlertLoud : CHANNEL.restAlertQuiet
}

export type RestIssue =
  | { id: 'permission'; state: Exclude<NotificationsState, 'ok'> }
  | { id: 'exact' }
  | { id: 'countdown-muted'; channelId: string }
  | { id: 'alert-muted'; channelId: string }

/**
 * What stops the native rest timer from working with the screen off. Nothing when both native
 * features are off. Channel rows only once notifications are allowed (otherwise that is the fix).
 */
export function restIssues(s: NativeStatus, rest: RestAlertPrefs): RestIssue[] {
  if (!rest.countdown && !rest.alert) return []
  const n = notificationsState(s)
  if (n !== 'ok') return [{ id: 'permission', state: n }]
  const out: RestIssue[] = []
  if (rest.alert && !s.exact) out.push({ id: 'exact' })
  if (rest.countdown && isMuted(s.channels, CHANNEL.restCountdown))
    out.push({ id: 'countdown-muted', channelId: CHANNEL.restCountdown })
  const alertChannel = restAlertChannel(rest.alertMode)
  if (rest.alert && isMuted(s.channels, alertChannel)) out.push({ id: 'alert-muted', channelId: alertChannel })
  return out
}

/**
 * Last local date covered by the reminder plan. `horizon` (epoch ms) is the last planned reminder
 * instant (`planHorizon` / `getScheduledSummary`), so a reminder at exactly 00:00 counts for its day.
 */
export function throughDate(horizon: number): string {
  return localDateStr(new Date(horizon))
}

/** UsageStatsManager standby buckets. */
export function bucketLabel(bucket: number | null): string | null {
  if (bucket === null) return null
  const names: Record<number, 'exempted' | 'active' | 'workingSet' | 'frequent' | 'rare' | 'restricted' | 'never'> = {
    5: 'exempted',
    10: 'active',
    20: 'workingSet',
    30: 'frequent',
    40: 'rare',
    45: 'restricted',
    50: 'never',
  }
  const name = names[bucket]
  return name
    ? t(`native.notifications.details.bucket.${name}`)
    : t('native.notifications.details.bucket.other', { n: bucket })
}

export const RECAP_DEFAULT_TIME: Record<NotifyPrefs['recap']['when'], HHMM> = {
  'monday-morning': '09:00',
  'sunday-evening': '19:00',
}

/** Switching Monday-morning ⇄ Sunday-evening moves an untouched default time along with it. */
export function recapWithWhen(r: NotifyPrefs['recap'], when: NotifyPrefs['recap']['when']): NotifyPrefs['recap'] {
  const time = r.time === RECAP_DEFAULT_TIME[r.when] ? RECAP_DEFAULT_TIME[when] : r.time
  return { ...r, when, time }
}
