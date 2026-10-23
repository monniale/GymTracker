import type { MealType } from '../types'
import type { Lang } from './uiStore'
import type { HHMM, IsoWeekday, NotifyPrefs } from './notifyPrefs'
import { addDays, daysBetween, localDateStr, mondayOf } from './dates'
import { DECAY_GRACE_DAYS, DECAY_MAX, DECAY_PER_DAY } from './ranks'
import { bindT, type Translator } from '../i18n'

/**
 * Reminder planner (Android). PURE: no Dexie, no Capacitor, no `Date.now()`, no localStorage —
 * everything comes in through `PlannerInput`, so it is unit-tested to the minute (TZ pinned to
 * Europe/Rome by `npm test`). `src/native/notifications.ts` turns the specs into one-shot
 * LocalNotifications alarms over a rolling window and re-plans on launch / resume / data change.
 * Titles and bodies come from `bindT(input.lang ?? 'en')` (the `notify.planner` dictionary), never
 * from the stored UI language; they are part of each spec's sig, so a language change re-plans.
 *
 * Notification ids (ROUTEMAP invariant 16): `cat*10_000_000 + dayIdx*100 + slot`.
 * cat 10..18 belong to the planner (`isManagedId`), 99 is the Settings test reminder, and the
 * RestTimer's 4201/4202 are never touched.
 */

export const CAT = {
  WORKOUT: 10,
  MEAL: 11,
  WATER: 12,
  DECAY: 13,
  STREAK: 14,
  RECAP: 15,
  WEIGHIN: 16,
  OPEN_SESSION: 17,
  KEEPALIVE: 18,
  TEST: 99,
} as const

export type Category =
  | 'workout' | 'meal' | 'water' | 'decay' | 'streak' | 'recap' | 'weighin' | 'openSession' | 'keepalive'

const CAT_ID: Record<Category, number> = {
  workout: CAT.WORKOUT,
  meal: CAT.MEAL,
  water: CAT.WATER,
  decay: CAT.DECAY,
  streak: CAT.STREAK,
  recap: CAT.RECAP,
  weighin: CAT.WEIGHIN,
  openSession: CAT.OPEN_SESSION,
  keepalive: CAT.KEEPALIVE,
}

/** Android channel per category. Channels are immutable: change one by bumping its `_vN` (invariant 17). */
export const CHANNEL_FOR: Record<Category, string> = {
  workout: 'workout_reminders_v1',
  meal: 'meal_reminders_v1',
  water: 'water_reminders_v1',
  decay: 'rank_alerts_v1',
  streak: 'rank_alerts_v1',
  recap: 'weekly_recap_v1',
  weighin: 'workout_reminders_v1',
  openSession: 'workout_reminders_v1',
  keepalive: 'app_status_v1',
}

/** Hash routes a reminder tap may open (⊆ ALLOWED_ROUTES in src/native/navigation.ts). */
export const REMINDER_ROUTES = ['/workout', '/workout/session', '/diet', '/progress', '/progress/week', '/rank', '/settings'] as const
export type ReminderRoute = (typeof REMINDER_ROUTES)[number]

export const MEAL_SLOT: Record<MealType, number> = { breakfast: 0, lunch: 1, snack: 2, dinner: 3 }
const MEAL_ORDER: MealType[] = ['breakfast', 'lunch', 'snack', 'dinner']

/** Days planned ahead (today included). The app re-plans whenever it runs. */
export const WINDOW_DAYS = 7
/** Water nudges are planned for today and tomorrow only. */
export const WATER_DAYS = 2
/** At most this many water nudges per day (evenly thinned when the interval allows more). */
export const WATER_MAX_SLOTS = 7
/** A one-shot `at` in the past fires immediately: never schedule closer than this. */
export const LEAD_MS = 30_000
/** Hard cap on scheduled alarms (AOSP per-UID limit is 500). */
export const MAX_SCHEDULED = 100
/** A water nudge this close to a meal reminder on the same day is dropped. */
export const WATER_MEAL_GAP_MS = 10 * 60_000
/** "Workout still open" fires this long after the session started. */
export const OPEN_SESSION_AFTER_MS = 3 * 3_600_000
/** Time of the keep-alive nudge on the last planned day. */
export const KEEPALIVE_TIME: HHMM = '12:00'

const DAY_MS = 86_400_000
const EPOCH_UTC = Date.UTC(2026, 0, 1)

/* ------------------------------ ids & dates ------------------------------ */

/** Whole days since 2026-01-01 (calendar arithmetic in UTC: DST cannot shift it). */
export function dayIdx(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return Math.round((Date.UTC(y, m - 1, d) - EPOCH_UTC) / DAY_MS)
}

/** Notification id. Throws RangeError outside 10 ≤ cat ≤ 99, 0 ≤ day < 100 000, 0 ≤ slot < 100. */
export function nid(cat: number, day: number, slot: number): number {
  if (!Number.isInteger(cat) || cat < 10 || cat > 99) throw new RangeError(`nid: bad category ${cat}`)
  if (!Number.isInteger(day) || day < 0 || day >= 100_000) throw new RangeError(`nid: bad day ${day}`)
  if (!Number.isInteger(slot) || slot < 0 || slot >= 100) throw new RangeError(`nid: bad slot ${slot}`)
  return cat * 10_000_000 + day * 100 + slot
}

export function decodeNid(id: number): { cat: number; day: number; slot: number } | null {
  if (!Number.isInteger(id) || id < 100_000_000 || id > 999_999_999) return null
  const rest = id % 10_000_000
  return { cat: Math.floor(id / 10_000_000), day: Math.floor(rest / 100), slot: rest % 100 }
}

/** Ids owned by the planner (cat 10..18). Excludes the test reminder (99) and RestTimer 4201/4202. */
export function isManagedId(id: number): boolean {
  const d = decodeNid(id)
  return d !== null && d.cat >= CAT.WORKOUT && d.cat <= CAT.KEEPALIVE
}

function hhmmMinutes(hhmm: HHMM): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/** Local wall-clock `minutes` after midnight of `date` (a DST-correct local time, overflow rolls on). */
function atLocalMinutes(date: string, minutes: number): number {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d, 0, minutes, 0, 0).getTime()
}

/** Epoch ms of local `hhmm` on `date` — wall clock, so DST days are handled (never midnight + h·3600e3). */
export function atLocal(date: string, hhmm: HHMM): number {
  return atLocalMinutes(date, hhmmMinutes(hhmm))
}

/** 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: string): IsoWeekday {
  const [y, m, d] = date.split('-').map(Number)
  return (((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7) + 1) as IsoWeekday
}

/** Next recap day: Monday ('monday-morning') or Sunday ('sunday-evening') whose time is still > now + LEAD_MS. */
export function nextRecapDate(now: number, recap: NotifyPrefs['recap']): string {
  const today = localDateStr(new Date(now))
  const target: IsoWeekday = recap.when === 'monday-morning' ? 1 : 7
  for (let k = 0; k <= 7; k++) {
    const d = addDays(today, k)
    if (isoWeekday(d) === target && atLocal(d, recap.time) > now + LEAD_MS) return d
  }
  return addDays(today, 7) // unreachable: some k in 0..7 always matches
}

/** Monday of the ISO week a recap on `recapDate` summarizes: the previous week on Monday, the current one on Sunday. */
export function recapWeekMonday(recapDate: string, when: NotifyPrefs['recap']['when']): string {
  return when === 'monday-morning' ? addDays(mondayOf(recapDate), -7) : mondayOf(recapDate)
}

/* ------------------------------ types ------------------------------ */

export interface PlannerData {
  /** localDateStr(new Date(now)) */
  today: string
  /** useAppStore.activeSessionId !== null */
  activeSession: boolean
  /** startedAt of the active (unfinished) session, if its row exists. */
  activeSessionStartedAt: number | null
  /** Local dates in [today-7, today+7] with ≥ 1 session STARTED (finished or not). */
  sessionDays: string[]
  /** Finished sessions since this Monday 00:00 (= registerSessionForStreak's count). */
  weekSessionsDone: number
  /** settings.weeklySessionTarget */
  weeklyTarget: number
  /** Manual day-type overrides for the window dates. */
  dayTypeOverrides: Record<string, 'training' | 'rest'>
  mealsLoggedToday: MealType[]
  waterTodayMl: number
  /** settings.waterTargetMl ?? 2500 */
  waterTargetMl: number
  /** max(updatedAt) of today's water logs, or null. */
  lastWaterAt: number | null
  /** Window dates that already have a bodyweight entry. */
  bodyLogDates: string[]
  /** Window date → name of the template scheduled that weekday (`WorkoutTemplate.weekdays`; two on
   * one day: the lower position). With any entry these dates replace `prefs.workout.days`. */
  scheduledDays?: Record<string, string>
  rank: { points: number; seasonStart: string; lastSessionDate?: string; streakWeeks: number; lastStreakWeek: string } | null
  /** Stats of the week the next recap covers (recapWeekMonday(nextRecapDate)); null when the recap is off. */
  recap: { weekMonday: string; sessions: number; points: number } | null
}

export interface PlannerInput {
  now: number
  prefs: NotifyPrefs
  data: PlannerData
  /** Language of titles and bodies (part of each spec's sig, so a change re-plans). Default 'en'. */
  lang?: Lang
}

export interface NotificationSpec {
  id: number
  cat: Category
  channelId: string
  atMs: number
  title: string
  body: string
  route: ReminderRoute
  /** Human-readable identity for diagnostics, e.g. 'meal:2026-10-12:lunch'. */
  key: string
  /** Everything the user would see or that decides when: a different sig means re-schedule. */
  sig: string
}

/* ------------------------------ planning ------------------------------ */

function spec(
  cat: Category, date: string, slot: number, atMs: number,
  title: string, body: string, route: ReminderRoute, key: string,
): NotificationSpec | null {
  const day = dayIdx(date)
  if (day < 0 || day >= 100_000) return null // device clock far off: plan nothing rather than throw
  const channelId = CHANNEL_FOR[cat]
  return {
    id: nid(CAT_ID[cat], day, slot), cat, channelId, atMs, title, body, route, key,
    sig: `${atMs}|${channelId}|${title}|${body}|${route}`,
  }
}

const byTime = (a: NotificationSpec, b: NotificationSpec) => a.atMs - b.atMs || a.id - b.id

/** True when the data carries a template schedule: it then decides the training days. */
function hasSchedule(data: PlannerData): data is PlannerData & { scheduledDays: Record<string, string> } {
  return !!data.scheduledDays && Object.keys(data.scheduledDays).length > 0
}

function anyReminderEnabled(p: NotifyPrefs, data: PlannerData): boolean {
  return (p.workout.enabled && (p.workout.days.length > 0 || hasSchedule(data)))
    || MEAL_ORDER.some(m => p.meals[m].enabled)
    || p.water.enabled
    || p.rank.decayWarning
    || p.rank.streakWarning
    || p.recap.enabled
    || p.weighIn.enabled
}

type TrainingReason =
  | { kind: 'decay'; atMs: number }
  | { kind: 'streak'; atMs: number; weeks: number; needed: number }
  | { kind: 'workout'; atMs: number; body: string }

const PRIORITY: Record<TrainingReason['kind'], number> = { decay: 0, streak: 1, workout: 2 }

/** At most one training nudge per day: DECAY > STREAK > WORKOUT, the others folded into its body. */
function trainingNudge(tr: Translator, date: string, reasons: TrainingReason[]): NotificationSpec | null {
  const sorted = [...reasons].sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind])
  const win = sorted[0]
  const streak = reasons.find((r): r is Extract<TrainingReason, { kind: 'streak' }> => r.kind === 'streak')
  const hasWorkout = reasons.some(r => r.kind === 'workout')
  // Earliest of the folded times: the user asked to be nudged then.
  const atMs = Math.min(...reasons.map(r => r.atMs))
  const key = `${win.kind}:${date}${sorted.slice(1).map(r => `+${r.kind}`).join('')}`
  const { t, tp } = tr
  if (win.kind === 'decay') {
    const body = streak
      ? t('notify.planner.decayBodyStreak', {
        streak: tp('notify.planner.weekStreak', streak.weeks),
        sessions: tp('notify.planner.moreSessions', streak.needed),
      })
      : t('notify.planner.decayBody', { pct: Math.round(DECAY_PER_DAY * 100), max: Math.round(DECAY_MAX * 100) })
    return spec('decay', date, 0, atMs, t('notify.planner.decayTitle'), body, '/workout', key)
  }
  if (win.kind === 'streak') {
    const sessions = tp('notify.planner.moreSessions', win.needed)
    const body = t(hasWorkout ? 'notify.planner.streakBodyTrainingDay' : 'notify.planner.streakBody', { sessions })
    const title = t('notify.planner.streakTitle', { streak: tp('notify.planner.weekStreak', win.weeks) })
    return spec('streak', date, 0, atMs, title, body, '/workout', key)
  }
  return spec('workout', date, 0, atMs, t('notify.planner.workoutTitle'), win.body, '/workout', key)
}

/**
 * Every reminder the current state justifies, BEFORE the `now + LEAD_MS` cut. `planCleanup` uses
 * it to decide which already-delivered notifications are still relevant. It never depends on the
 * time of day within today: a reason that came and went with the clock would split a folded
 * training nudge and fire its remainder a second time.
 */
function planCandidates(input: PlannerInput): NotificationSpec[] {
  const { now, prefs, data } = input
  const { today } = data
  const tr = bindT(input.lang ?? 'en')
  const { t, tp } = tr
  const out: NotificationSpec[] = []
  const push = (s: NotificationSpec | null) => { if (s) out.push(s) }
  const windowDates = Array.from({ length: WINDOW_DAYS }, (_, k) => addDays(today, k))
  const sessionDays = new Set(data.sessionDays)
  const thisMonday = mondayOf(today)

  /* ---- training nudges (DECAY / STREAK / WORKOUT), grouped per day for the dedupe ---- */
  const training = new Map<string, TrainingReason[]>()
  const addReason = (date: string, r: TrainingReason) => {
    const list = training.get(date)
    if (list) list.push(r)
    else training.set(date, [r])
  }

  if (prefs.workout.enabled) {
    // A template schedule replaces the weekdays picked in Settings › Notifications.
    const scheduled = hasSchedule(data) ? data.scheduledDays : null
    const days = new Set(prefs.workout.days)
    const targetMet = data.weekSessionsDone >= data.weeklyTarget
    for (const d of windowDates) {
      const name = scheduled ? scheduled[d] : undefined
      if (scheduled ? name === undefined : !days.has(isoWeekday(d))) continue
      if (data.dayTypeOverrides[d] === 'rest') continue
      if (sessionDays.has(d)) continue
      if (d === today && data.activeSession) continue
      const currentWeek = mondayOf(d) === thisMonday
      if (prefs.workout.skipWhenTargetMet && currentWeek && targetMet) continue
      addReason(d, {
        kind: 'workout',
        atMs: atLocal(d, prefs.workout.time),
        body: name !== undefined
          ? currentWeek
            ? t('notify.planner.workoutBodyTemplate', { name, done: data.weekSessionsDone, target: data.weeklyTarget })
            : t('notify.planner.workoutBodyTemplateDay', { name })
          : currentWeek
            ? t('notify.planner.workoutBodyWeek', { done: data.weekSessionsDone, target: data.weeklyTarget })
            : t('notify.planner.workoutBody'),
      })
    }
  }

  const rank = data.rank
  if (prefs.rank.decayWarning && rank && rank.points > 0) {
    // Decay applies once idleDays > DECAY_GRACE_DAYS (season.ts runDailyChecks): warn on the last free day.
    const warnDate = addDays(rank.lastSessionDate ?? rank.seasonStart, DECAY_GRACE_DAYS)
    if (warnDate >= today && !sessionDays.has(warnDate) && !(warnDate === today && data.activeSession)) {
      addReason(warnDate, { kind: 'decay', atMs: atLocal(warnDate, prefs.rank.decayTime) })
    }
  }

  if (prefs.rank.streakWarning && rank && rank.streakWeeks > 0
    && rank.lastStreakWeek === addDays(thisMonday, -7)
    && data.weekSessionsDone < data.weeklyTarget) {
    const needed = data.weeklyTarget - data.weekSessionsDone
    const sunday = addDays(thisMonday, 6)
    // Feasible only with one session a day; today always counts. Once today's warning time has
    // passed, the `now + LEAD_MS` cut drops it (and any nudge it is folded into: it already fired).
    const daysLeft = daysBetween(today, sunday) + 1
    if (needed <= daysLeft) {
      const latest = addDays(sunday, -(Math.min(needed, 7) - 1))
      const warnDate = latest > today ? latest : today
      if (!(warnDate === today && data.activeSession)) {
        addReason(warnDate, { kind: 'streak', atMs: atLocal(warnDate, prefs.rank.streakTime), weeks: rank.streakWeeks, needed })
      }
    }
  }

  // Target met this week: next week's warning, when it falls inside the window. Without it a user
  // who does not open the app during the lapse week would get no warning at all.
  if (prefs.rank.streakWarning && rank && rank.streakWeeks > 0 && rank.lastStreakWeek === thisMonday
    && data.weeklyTarget > 0 && data.weeklyTarget <= 7) {
    const needed = data.weeklyTarget
    const warnDate = addDays(addDays(thisMonday, 13), -(needed - 1))
    if (warnDate <= windowDates[WINDOW_DAYS - 1]) {
      addReason(warnDate, { kind: 'streak', atMs: atLocal(warnDate, prefs.rank.streakTime), weeks: rank.streakWeeks, needed })
    }
  }

  for (const [date, reasons] of training) push(trainingNudge(tr, date, reasons))

  /* ---- meals ---- */
  const mealsByDay = new Map<string, number[]>()
  for (const d of windowDates) {
    for (const meal of MEAL_ORDER) {
      if (!prefs.meals[meal].enabled) continue
      if (d === today && data.mealsLoggedToday.includes(meal)) continue
      const at = atLocal(d, prefs.meals[meal].time)
      const s = spec('meal', d, MEAL_SLOT[meal], at, t(`notify.planner.mealTitle.${meal}`), t(`notify.planner.mealBody.${meal}`),
        '/diet', `meal:${d}:${meal}`)
      if (!s) continue
      out.push(s)
      const list = mealsByDay.get(d)
      if (list) list.push(at)
      else mealsByDay.set(d, [at])
    }
  }

  /* ---- water (today + tomorrow, static body: no stale numbers in the shade) ---- */
  if (prefs.water.enabled) {
    const startMin = hhmmMinutes(prefs.water.start)
    const endMin = hhmmMinutes(prefs.water.end)
    const step = prefs.water.intervalMin
    const grid: number[] = []
    if (endMin > startMin) for (let j = 0; j < 24 && startMin + j * step <= endMin; j++) grid.push(j)
    let slots = grid
    if (grid.length > WATER_MAX_SLOTS) {
      // Evenly thinned, keeping the first and last slot; ids keep the grid index so they stay stable.
      slots = Array.from({ length: WATER_MAX_SLOTS }, (_, i) => grid[Math.round((i * (grid.length - 1)) / (WATER_MAX_SLOTS - 1))])
    }
    const stepMs = step * 60_000
    for (let k = 0; k < WATER_DAYS; k++) {
      const d = windowDates[k]
      if (d === today && data.waterTodayMl >= data.waterTargetMl) continue
      const meals = mealsByDay.get(d) ?? []
      for (const j of slots) {
        const at = atLocalMinutes(d, startMin + j * step)
        if (d === today && data.lastWaterAt !== null && at - data.lastWaterAt < stepMs) continue
        if (meals.some(m => Math.abs(m - at) <= WATER_MEAL_GAP_MS)) continue
        push(spec('water', d, j, at, t('notify.planner.waterTitle'), t('notify.planner.waterBody'), '/diet', `water:${d}:${j}`))
      }
    }
  }

  /* ---- weekly recap (exactly one; its body is recomputed on every re-plan) ---- */
  if (prefs.recap.enabled && data.recap) {
    const d = nextRecapDate(now, prefs.recap)
    if (data.recap.weekMonday === recapWeekMonday(d, prefs.recap.when)) {
      // The streak as it stands after the covered week: on Monday it survives only if that week met
      // the target (runDailyChecks resets it later that day); on Sunday the week is still open.
      const wk = data.recap.weekMonday
      const alive = !!rank && (prefs.recap.when === 'monday-morning'
        ? rank.lastStreakWeek === wk
        : rank.lastStreakWeek >= addDays(wk, -7))
      const streakWeeks = alive && rank ? rank.streakWeeks : 0
      const monday = prefs.recap.when === 'monday-morning'
      const body = t(
        streakWeeks > 0
          ? (monday ? 'notify.planner.recapLastWeekStreak' : 'notify.planner.recapThisWeekStreak')
          : (monday ? 'notify.planner.recapLastWeek' : 'notify.planner.recapThisWeek'),
        {
          sessions: tp('notify.planner.sessions', data.recap.sessions),
          points: tr.fmtNum(Math.round(data.recap.points)),
          streak: tp('notify.planner.weekStreak', streakWeeks),
        },
      )
      // Monday's recap covers a finished week: open its review. Sunday's covers the open week, which the
      // review screen doesn't open on (it starts at the last finished week), so that one keeps Rank.
      const route = monday ? '/progress/week' : '/rank'
      push(spec('recap', d, 0, atLocal(d, prefs.recap.time), t('notify.planner.recapTitle'), body, route, `recap:${d}`))
    }
  }

  /* ---- weigh-in ---- */
  if (prefs.weighIn.enabled) {
    const logged = new Set(data.bodyLogDates)
    for (const d of windowDates) {
      if (isoWeekday(d) !== prefs.weighIn.weekday || logged.has(d)) continue
      push(spec('weighin', d, 0, atLocal(d, prefs.weighIn.time), t('notify.planner.weighInTitle'),
        t('notify.planner.weighInBody'), '/progress', `weighin:${d}`))
    }
  }

  /* ---- session left open ---- */
  if (prefs.workout.openSessionNudge && data.activeSession && data.activeSessionStartedAt !== null) {
    const at = data.activeSessionStartedAt + OPEN_SESSION_AFTER_MS
    const d = localDateStr(new Date(at))
    push(spec('openSession', d, 0, at, t('notify.planner.openSessionTitle'), t('notify.planner.openSessionBody'),
      '/workout/session', `openSession:${data.activeSessionStartedAt}`))
  }

  /* ---- keep-alive on the last planned day: nothing re-plans while the app is never opened ---- */
  if (anyReminderEnabled(prefs, data)) {
    const d = windowDates[WINDOW_DAYS - 1]
    push(spec('keepalive', d, 0, atLocal(d, KEEPALIVE_TIME), t('notify.planner.keepAliveTitle'),
      t('notify.planner.keepAliveBody'), '/workout', `keepalive:${d}`))
  }

  // Ids are unique by construction; keep the first defensively.
  const seen = new Set<number>()
  return out.filter(s => (seen.has(s.id) ? false : (seen.add(s.id), true)))
}

/**
 * The reminders to have scheduled right now: candidates later than `now + LEAD_MS`, sorted by
 * time then id, capped at MAX_SCHEDULED (the keep-alive always survives the cap).
 */
export function planNotifications(input: PlannerInput): NotificationSpec[] {
  if (!input.prefs.enabled) return []
  const minAt = input.now + LEAD_MS
  const live = planCandidates(input).filter(s => s.atMs > minAt).sort(byTime)
  const keepalive = live.filter(s => s.cat === 'keepalive')
  const rest = live.filter(s => s.cat !== 'keepalive').slice(0, MAX_SCHEDULED - keepalive.length)
  return [...rest, ...keepalive].sort(byTime)
}

/** Last reminder time in a plan (the keep-alive excluded): "reminders scheduled through …". */
export function planHorizon(specs: { id: number; atMs: number }[]): number | undefined {
  let max: number | undefined
  for (const s of specs) {
    if (decodeNid(s.id)?.cat === CAT.KEEPALIVE) continue
    if (max === undefined || s.atMs > max) max = s.atMs
  }
  return max
}

export interface PendingLike {
  id: number
  sig?: string
  /** isExactNotification of the stored alarm, when known. */
  exact?: boolean
}

/**
 * What to cancel and (re)schedule to turn `pending` into `desired`. Only planner-managed pending
 * ids are considered (RestTimer 4201/4202 and the test reminder are ignored). A pending alarm whose
 * exactness differs from `exact` counts as changed, so granting exact alarms re-arms the window.
 */
export function diffSchedules(
  pending: PendingLike[], desired: NotificationSpec[], exact?: boolean,
): { cancel: number[]; schedule: NotificationSpec[] } {
  const want = new Map(desired.map(d => [d.id, d]))
  const have = new Map(pending.filter(p => isManagedId(p.id)).map(p => [p.id, p]))
  const stale = (p: PendingLike, d: NotificationSpec | undefined) =>
    !d || p.sig !== d.sig || (exact !== undefined && p.exact !== undefined && p.exact !== exact)
  const cancel = [...have.values()].filter(p => stale(p, want.get(p.id))).map(p => p.id)
  const schedule = desired.filter(d => {
    const p = have.get(d.id)
    return !p || stale(p, d)
  })
  return { cancel, schedule }
}

/**
 * Which delivered (visible) planner notifications to remove from the shade: anything from an
 * earlier day (a recap stays one extra day), the keep-alive (the app is open now), and every
 * reminder whose reason is gone — a logged meal, a finished workout, water after the target or
 * after a drink, a decay/streak warning that no longer applies. Of today's water nudges only the
 * latest is kept. Never returns unmanaged ids (RestTimer 4201/4202, the test reminder).
 */
export function planCleanup(deliveredIds: number[], input: PlannerInput): number[] {
  const { prefs, data } = input
  const today = dayIdx(data.today)
  const candidates = new Set(prefs.enabled ? planCandidates(input).map(s => s.id) : [])
  const managed = deliveredIds
    .filter(isManagedId)
    .map(id => ({ id, d: decodeNid(id)! }))
  const latestWater = Math.max(-1, ...managed.filter(x => x.d.cat === CAT.WATER && x.d.day === today).map(x => x.d.slot))
  const remove: number[] = []
  for (const { id, d } of managed) {
    let keep: boolean
    if (d.cat === CAT.KEEPALIVE) keep = false
    else if (d.cat === CAT.RECAP) keep = prefs.enabled && prefs.recap.enabled && d.day >= today - 1
    else if (d.cat === CAT.WATER) keep = d.day === today && d.slot === latestWater && candidates.has(id)
    else keep = candidates.has(id)
    if (!keep) remove.push(id)
  }
  return remove
}
