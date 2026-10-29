import type { MealType } from '../types'

/**
 * Device-local notification preferences (Android only). Pure: no Dexie, no Capacitor.
 * Persisted by `notifyStore.ts` in localStorage ('gymtracker-notify') — never Dexie, so they
 * are never synced or included in backups (ROUTEMAP invariant 3).
 */

/** 'HH:MM', 24 h, zero-padded. Validated by `isHHMM`. */
export type HHMM = string
/** 1 = Monday … 7 = Sunday (matches `mondayOf`). */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7

export interface NotifyPrefs {
  /** Master switch for reminders (not the rest timer). */
  enabled: boolean
  /** `openSessionNudge` ("workout still open") is independent of `enabled` (the training-day reminders). */
  workout: { enabled: boolean; days: IsoWeekday[]; time: HHMM; skipWhenTargetMet: boolean; openSessionNudge: boolean }
  meals: Record<MealType, { enabled: boolean; time: HHMM }>
  water: { enabled: boolean; start: HHMM; end: HHMM; intervalMin: 60 | 90 | 120 | 180 }
  rank: { decayWarning: boolean; decayTime: HHMM; streakWarning: boolean; streakTime: HHMM }
  /** 'monday-morning' recaps the previous ISO week; 'sunday-evening' the current one. */
  recap: { enabled: boolean; when: 'monday-morning' | 'sunday-evening'; time: HHMM }
  weighIn: { enabled: boolean; weekday: IsoWeekday; time: HHMM }
  /** At each supplement's own time (`Supplement.time`, synced), unless logged that day. */
  supplements: { enabled: boolean }
}

/** Native rest-timer notifications. 'notification' = discreet (follows ringer); 'alarm' = loud opt-in. */
export interface RestAlertPrefs {
  countdown: boolean
  alert: boolean
  alertMode: 'alarm' | 'notification'
  warmupAlert: boolean
}

export const DEFAULT_NOTIFY_PREFS: NotifyPrefs = {
  enabled: true,
  workout: { enabled: false, days: [], time: '18:00', skipWhenTargetMet: true, openSessionNudge: true },
  meals: {
    breakfast: { enabled: false, time: '08:30' },
    lunch: { enabled: false, time: '13:00' },
    snack: { enabled: false, time: '16:30' },
    dinner: { enabled: false, time: '20:00' },
  },
  water: { enabled: false, start: '09:00', end: '21:00', intervalMin: 120 },
  rank: { decayWarning: true, decayTime: '19:00', streakWarning: true, streakTime: '18:00' },
  recap: { enabled: true, when: 'monday-morning', time: '09:00' },
  weighIn: { enabled: false, weekday: 1, time: '08:00' },
  supplements: { enabled: true },
}

export const DEFAULT_REST_ALERT: RestAlertPrefs = { countdown: true, alert: true, alertMode: 'notification', warmupAlert: false }

const MEALS: MealType[] = ['breakfast', 'lunch', 'snack', 'dinner']
const WATER_INTERVALS = [60, 90, 120, 180] as const
const RECAP_WHEN = ['monday-morning', 'sunday-evening'] as const
const ALERT_MODES = ['alarm', 'notification'] as const

export function isHHMM(s: unknown): s is HHMM {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s)
}

function isWeekday(v: unknown): v is IsoWeekday {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 7
}

function obj(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d)
const hhmm = (v: unknown, d: HHMM): HHMM => (isHHMM(v) ? v : d)
const weekday = (v: unknown, d: IsoWeekday): IsoWeekday => (isWeekday(v) ? v : d)
const oneOf = <T>(v: unknown, allowed: readonly T[], d: T): T => (allowed.includes(v as T) ? (v as T) : d)

/** Valid weekdays only, deduplicated, ascending. Anything but an array → the default. */
function weekdays(v: unknown, d: IsoWeekday[]): IsoWeekday[] {
  if (!Array.isArray(v)) return [...d]
  return [...new Set(v.filter(isWeekday))].sort((a, b) => a - b)
}

/**
 * Deep-merges persisted (untrusted) prefs onto the defaults, field by field: unknown keys are
 * dropped and every invalid value (bad HH:MM, weekday, interval, enum, non-boolean) falls back
 * to its default. Always returns fresh objects (never shares references with the defaults).
 */
export function mergeNotifyPrefs(persisted: unknown): NotifyPrefs {
  const p = obj(persisted)
  const D = DEFAULT_NOTIFY_PREFS
  const w = obj(p.workout)
  const m = obj(p.meals)
  const wa = obj(p.water)
  const r = obj(p.rank)
  const rc = obj(p.recap)
  const wi = obj(p.weighIn)
  const su = obj(p.supplements)
  const meals = {} as NotifyPrefs['meals']
  for (const meal of MEALS) {
    const x = obj(m[meal])
    meals[meal] = { enabled: bool(x.enabled, D.meals[meal].enabled), time: hhmm(x.time, D.meals[meal].time) }
  }
  return {
    enabled: bool(p.enabled, D.enabled),
    workout: {
      enabled: bool(w.enabled, D.workout.enabled),
      days: weekdays(w.days, D.workout.days),
      time: hhmm(w.time, D.workout.time),
      skipWhenTargetMet: bool(w.skipWhenTargetMet, D.workout.skipWhenTargetMet),
      openSessionNudge: bool(w.openSessionNudge, D.workout.openSessionNudge),
    },
    meals,
    water: {
      enabled: bool(wa.enabled, D.water.enabled),
      start: hhmm(wa.start, D.water.start),
      end: hhmm(wa.end, D.water.end),
      intervalMin: oneOf(wa.intervalMin, WATER_INTERVALS, D.water.intervalMin),
    },
    rank: {
      decayWarning: bool(r.decayWarning, D.rank.decayWarning),
      decayTime: hhmm(r.decayTime, D.rank.decayTime),
      streakWarning: bool(r.streakWarning, D.rank.streakWarning),
      streakTime: hhmm(r.streakTime, D.rank.streakTime),
    },
    recap: {
      enabled: bool(rc.enabled, D.recap.enabled),
      when: oneOf(rc.when, RECAP_WHEN, D.recap.when),
      time: hhmm(rc.time, D.recap.time),
    },
    weighIn: {
      enabled: bool(wi.enabled, D.weighIn.enabled),
      weekday: weekday(wi.weekday, D.weighIn.weekday),
      time: hhmm(wi.time, D.weighIn.time),
    },
    supplements: { enabled: bool(su.enabled, D.supplements.enabled) },
  }
}

/** Same contract as `mergeNotifyPrefs`, for the rest-timer alert prefs. */
export function mergeRestAlert(persisted: unknown): RestAlertPrefs {
  const p = obj(persisted)
  const D = DEFAULT_REST_ALERT
  return {
    countdown: bool(p.countdown, D.countdown),
    alert: bool(p.alert, D.alert),
    alertMode: oneOf(p.alertMode, ALERT_MODES, D.alertMode),
    warmupAlert: bool(p.warmupAlert, D.warmupAlert),
  }
}
