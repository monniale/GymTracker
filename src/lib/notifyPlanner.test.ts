import { describe, it, expect } from 'vitest'
import {
  CAT, CHANNEL_FOR, MAX_SCHEDULED, REMINDER_ROUTES, WINDOW_DAYS, LEAD_MS,
  atLocal, dayIdx, decodeNid, diffSchedules, isManagedId, isoWeekday, nextRecapDate, nid,
  planCleanup, planHorizon, planNotifications, recapWeekMonday,
} from './notifyPlanner'
import type { NotificationSpec, PlannerData, PlannerInput } from './notifyPlanner'
import { mergeNotifyPrefs } from './notifyPrefs'
import type { NotifyPrefs } from './notifyPrefs'
import { KNOWN_ROUTES } from '../routes'

/* Times below are LOCAL (Europe/Rome — pinned by `npm test`); `T(…)` = new Date(y, m-1, d, h, mi). */
const T = (y: number, m: number, d: number, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi).getTime()

/** Every category off; tests switch on what they exercise. */
function offPrefs(): NotifyPrefs {
  return mergeNotifyPrefs({
    enabled: true,
    workout: { enabled: false, days: [], time: '18:00', skipWhenTargetMet: true, openSessionNudge: false },
    rank: { decayWarning: false, decayTime: '19:00', streakWarning: false, streakTime: '18:00' },
    recap: { enabled: false, when: 'monday-morning', time: '09:00' },
  })
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends (infer U)[] ? U[] : T[K] extends object ? DeepPartial<T[K]> : T[K] }

function prefsWith(patch: DeepPartial<NotifyPrefs>): NotifyPrefs {
  const base = offPrefs() as unknown as Record<string, unknown>
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(patch)) {
    out[k] = v !== null && typeof v === 'object' && !Array.isArray(v)
      ? { ...(base[k] as object), ...(v as object) }
      : v
  }
  return mergeNotifyPrefs(out)
}

function data(patch: Partial<PlannerData> = {}): PlannerData {
  return {
    today: '2026-10-12',
    activeSession: false,
    activeSessionStartedAt: null,
    sessionDays: [],
    weekSessionsDone: 0,
    weeklyTarget: 3,
    dayTypeOverrides: {},
    mealsLoggedToday: [],
    waterTodayMl: 0,
    waterTargetMl: 2500,
    lastWaterAt: null,
    bodyLogDates: [],
    rank: null,
    recap: null,
    ...patch,
  }
}

function input(now: number, prefs: NotifyPrefs, d: Partial<PlannerData> = {}): PlannerInput {
  const today = new Date(now)
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  return { now, prefs, data: data({ today: iso, ...d }) }
}

const plan = (now: number, prefs: NotifyPrefs, d: Partial<PlannerData> = {}) => planNotifications(input(now, prefs, d))
const ofCat = (specs: NotificationSpec[], cat: NotificationSpec['cat']) => specs.filter(s => s.cat === cat)

const MON_12_10 = T(2026, 10, 12, 10) // Monday 12 Oct 2026, 10:00

describe('timezone guard', () => {
  it('runs in Europe/Rome so the DST cases below can fail', () => {
    // CEST (UTC+2) before 25 Oct 2026, CET (UTC+1) after: otherwise the DST tests prove nothing.
    expect(new Date(2026, 9, 24, 12).getTimezoneOffset()).toBe(-120)
    expect(new Date(2026, 9, 26, 12).getTimezoneOffset()).toBe(-60)
    expect(new Date(2026, 2, 28, 12).getTimezoneOffset()).toBe(-60)
    expect(new Date(2026, 2, 30, 12).getTimezoneOffset()).toBe(-120)
  })
})

describe('ids', () => {
  it('nid/decodeNid round-trip and stay 32-bit', () => {
    for (const [c, d, s] of [[10, 0, 0], [15, 284, 3], [18, 99_999, 99], [99, 0, 0]]) {
      const id = nid(c, d, s)
      expect(decodeNid(id)).toEqual({ cat: c, day: d, slot: s })
      expect(id).toBeLessThanOrEqual(2_147_483_647)
    }
    expect(nid(10, 284, 1)).toBe(100_028_401)
  })

  it('nid rejects out-of-range parts', () => {
    expect(() => nid(10, -1, 0)).toThrow(RangeError)
    expect(() => nid(10, 100_000, 0)).toThrow(RangeError)
    expect(() => nid(10, 0, 100)).toThrow(RangeError)
    expect(() => nid(9, 0, 0)).toThrow(RangeError)
    expect(() => nid(100, 0, 0)).toThrow(RangeError)
    expect(() => nid(10, 1.5, 0)).toThrow(RangeError)
  })

  it('isManagedId covers the planner categories 10..18 only', () => {
    for (let c = 10; c <= 18; c++) expect(isManagedId(nid(c, 284, 0))).toBe(true)
    expect(isManagedId(nid(19, 284, 0))).toBe(false)
    expect(isManagedId(nid(CAT.TEST, 0, 0))).toBe(false)
    expect(isManagedId(4201)).toBe(false)
    expect(isManagedId(4202)).toBe(false)
    expect(isManagedId(-5)).toBe(false)
    expect(decodeNid(4201)).toBeNull()
    expect(decodeNid(1.5e8 + 0.5)).toBeNull()
  })
})

describe('dates', () => {
  it('dayIdx counts calendar days from 2026-01-01', () => {
    expect(dayIdx('2026-01-01')).toBe(0)
    expect(dayIdx('2026-10-12')).toBe(284)
    expect(dayIdx('2026-10-26') - dayIdx('2026-10-25')).toBe(1)
    expect(dayIdx('2026-03-30') - dayIdx('2026-03-29')).toBe(1)
    expect(dayIdx('2027-01-01')).toBe(365)
  })

  it('atLocal is wall-clock time on DST days (fails on midnight + h·3600e3)', () => {
    // 25 Oct 2026: clocks go back 03:00 → 02:00, the day has 25 hours.
    expect(atLocal('2026-10-25', '13:00') - atLocal('2026-10-25', '00:00')).toBe(14 * 3_600_000)
    expect(atLocal('2026-10-25', '13:00')).toBe(Date.UTC(2026, 9, 25, 12, 0)) // 13:00 CET
    // 29 Mar 2026: clocks go forward 02:00 → 03:00, the day has 23 hours.
    expect(atLocal('2026-03-29', '13:00') - atLocal('2026-03-29', '00:00')).toBe(12 * 3_600_000)
    expect(atLocal('2026-03-29', '13:00')).toBe(Date.UTC(2026, 2, 29, 11, 0)) // 13:00 CEST
  })

  it('isoWeekday is Monday-first', () => {
    expect(isoWeekday('2026-10-12')).toBe(1)
    expect(isoWeekday('2026-10-18')).toBe(7)
    expect(isoWeekday('2026-10-25')).toBe(7)
  })

  it('nextRecapDate / recapWeekMonday', () => {
    const mon = { enabled: true, when: 'monday-morning' as const, time: '09:00' }
    const sun = { enabled: true, when: 'sunday-evening' as const, time: '19:00' }
    expect(nextRecapDate(T(2026, 10, 12, 8), mon)).toBe('2026-10-12')
    expect(nextRecapDate(T(2026, 10, 12, 10), mon)).toBe('2026-10-19')
    expect(nextRecapDate(T(2026, 10, 12, 8, 59, ), mon)).toBe('2026-10-12')
    expect(nextRecapDate(T(2026, 10, 12, 10), sun)).toBe('2026-10-18')
    expect(nextRecapDate(T(2026, 10, 18, 19, 30), sun)).toBe('2026-10-25')
    expect(recapWeekMonday('2026-10-19', 'monday-morning')).toBe('2026-10-12')
    expect(recapWeekMonday('2026-10-18', 'sunday-evening')).toBe('2026-10-12')
  })
})

describe('planNotifications — global', () => {
  it('master switch off → nothing', () => {
    const prefs = mergeNotifyPrefs({ enabled: false, workout: { enabled: true, days: [1, 2, 3, 4, 5, 6, 7] } })
    expect(plan(MON_12_10, prefs, { rank: { points: 500, seasonStart: '2026-10-01', streakWeeks: 2, lastStreakWeek: '2026-10-05' } })).toEqual([])
  })

  it('all categories off → nothing (not even the keep-alive)', () => {
    expect(plan(MON_12_10, offPrefs())).toEqual([])
  })

  it('lead time: at now+20 s excluded, at now+31 s included', () => {
    const prefs = prefsWith({ meals: { lunch: { enabled: true, time: '13:00' } } as NotifyPrefs['meals'] })
    const lunch = T(2026, 10, 12, 13)
    expect(ofCat(plan(lunch - 20_000, prefs), 'meal').some(s => s.atMs === lunch)).toBe(false)
    expect(ofCat(plan(lunch - 31_000, prefs), 'meal').some(s => s.atMs === lunch)).toBe(true)
    expect(LEAD_MS).toBe(30_000)
  })
})

describe('WORKOUT', () => {
  const prefs = prefsWith({ workout: { enabled: true, days: [1, 3, 5], time: '18:00' } })

  it('schedules the chosen weekdays in the window', () => {
    const w = ofCat(plan(MON_12_10, prefs), 'workout')
    expect(w.map(s => s.id)).toEqual([nid(10, dayIdx('2026-10-12'), 0), nid(10, dayIdx('2026-10-14'), 0), nid(10, dayIdx('2026-10-16'), 0)])
    expect(w.map(s => s.atMs)).toEqual([T(2026, 10, 12, 18), T(2026, 10, 14, 18), T(2026, 10, 16, 18)])
    expect(w[0]).toMatchObject({ title: 'Time to train', route: '/workout', channelId: 'workout_reminders_v1' })
    expect(w[0].body).toBe('0 of 3 sessions this week — tap to start.')
  })

  it('next-week days get the generic body', () => {
    const w = ofCat(plan(T(2026, 10, 16, 10), prefs), 'workout')
    expect(w.map(s => s.key)).toEqual(['workout:2026-10-16', 'workout:2026-10-19', 'workout:2026-10-21'])
    expect(w[1].body).toBe('Tap to start your workout.')
  })

  it('suppressed by a session that day, an active session today, and a rest-day override', () => {
    const keys = (d: Partial<PlannerData>) => ofCat(plan(MON_12_10, prefs, d), 'workout').map(s => s.key)
    expect(keys({ sessionDays: ['2026-10-12'] })).not.toContain('workout:2026-10-12')
    expect(keys({ activeSession: true })).not.toContain('workout:2026-10-12')
    expect(keys({ dayTypeOverrides: { '2026-10-14': 'rest' } })).toEqual(['workout:2026-10-12', 'workout:2026-10-16'])
    expect(keys({ dayTypeOverrides: { '2026-10-14': 'training' } })).toHaveLength(3)
  })

  it('skipWhenTargetMet skips this week only', () => {
    const fri = T(2026, 10, 16, 10)
    const keys = ofCat(plan(fri, prefs, { weekSessionsDone: 3, weeklyTarget: 3 }), 'workout').map(s => s.key)
    expect(keys).not.toContain('workout:2026-10-16')
    expect(keys).toContain('workout:2026-10-19')
    const off = prefsWith({ workout: { enabled: true, days: [1, 3, 5], time: '18:00', skipWhenTargetMet: false } })
    expect(ofCat(plan(fri, off, { weekSessionsDone: 3 }), 'workout').map(s => s.key)).toContain('workout:2026-10-16')
  })

  it('time already passed today → no spec for today', () => {
    const keys = ofCat(plan(T(2026, 10, 12, 19), prefs), 'workout').map(s => s.key)
    expect(keys).not.toContain('workout:2026-10-12')
    expect(keys[0]).toBe('workout:2026-10-14')
  })
})

describe('MEAL', () => {
  const prefs = prefsWith({
    meals: { breakfast: { enabled: true, time: '08:30' }, lunch: { enabled: true, time: '13:00' } } as NotifyPrefs['meals'],
  })

  it('skips a meal already logged today; tomorrow has both; static body', () => {
    const m = ofCat(plan(T(2026, 10, 12, 7), prefs, { mealsLoggedToday: ['breakfast'] }), 'meal')
    const today = m.filter(s => s.key.startsWith('meal:2026-10-12'))
    expect(today.map(s => s.id)).toEqual([nid(11, dayIdx('2026-10-12'), 1)])
    const tomorrow = m.filter(s => s.key.startsWith('meal:2026-10-13'))
    expect(tomorrow.map(s => s.id)).toEqual([nid(11, dayIdx('2026-10-13'), 0), nid(11, dayIdx('2026-10-13'), 1)])
    expect(today[0]).toMatchObject({ title: 'Log your lunch', body: 'Tap to log your lunch.', route: '/diet', channelId: 'meal_reminders_v1' })
    expect(m).toHaveLength(1 + 2 * (WINDOW_DAYS - 1))
  })
})

describe('WATER', () => {
  const water = (w: Partial<NotifyPrefs['water']>) => prefsWith({ water: { enabled: true, start: '09:00', end: '21:00', intervalMin: 120, ...w } })

  it('09–21 every 120 → 7 slots today and tomorrow only, static body', () => {
    const w = ofCat(plan(T(2026, 10, 12, 7), water({})), 'water')
    const days = new Set(w.map(s => s.key.split(':')[1]))
    expect([...days]).toEqual(['2026-10-12', '2026-10-13'])
    const today = w.filter(s => s.key.startsWith('water:2026-10-12'))
    expect(today.map(s => new Date(s.atMs).getHours())).toEqual([9, 11, 13, 15, 17, 19, 21])
    expect(today.map(s => decodeNid(s.id)!.slot)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(today.every(s => s.body === 'Time for some water.' && s.title === 'Drink some water')).toBe(true)
  })

  it('caps at 7 slots a day, evenly thinned, keeping grid-index ids', () => {
    const w = ofCat(plan(T(2026, 10, 12, 7), water({ intervalMin: 60 })), 'water').filter(s => s.key.startsWith('water:2026-10-12'))
    expect(w.map(s => new Date(s.atMs).getHours())).toEqual([9, 11, 13, 15, 17, 19, 21])
    expect(w.map(s => decodeNid(s.id)!.slot)).toEqual([0, 2, 4, 6, 8, 10, 12])
    const w90 = ofCat(plan(T(2026, 10, 12, 7), water({ intervalMin: 90 })), 'water').filter(s => s.key.startsWith('water:2026-10-12'))
    expect(w90).toHaveLength(7)
    expect(w90[0].atMs).toBe(T(2026, 10, 12, 9))
    expect(w90[6].atMs).toBe(T(2026, 10, 12, 21))
  })

  it('target reached → none today, 7 tomorrow', () => {
    const w = ofCat(plan(T(2026, 10, 12, 7), water({}), { waterTodayMl: 2500 }), 'water')
    expect(w.every(s => s.key.startsWith('water:2026-10-13'))).toBe(true)
    expect(w).toHaveLength(7)
  })

  it('drops slots within one interval of the last drink', () => {
    const now = T(2026, 10, 12, 10, 55)
    const w = ofCat(plan(now, water({}), { lastWaterAt: T(2026, 10, 12, 10, 50) }), 'water').filter(s => s.key.startsWith('water:2026-10-12'))
    expect(w[0].atMs).toBe(T(2026, 10, 12, 13))
  })

  it('drops a slot within 10 min of a meal reminder', () => {
    const prefs = prefsWith({
      water: { enabled: true, start: '09:00', end: '21:00', intervalMin: 120 },
      meals: { lunch: { enabled: true, time: '12:55' } } as NotifyPrefs['meals'],
    })
    const w = ofCat(plan(T(2026, 10, 12, 7), prefs), 'water').filter(s => s.key.startsWith('water:2026-10-12'))
    expect(w.map(s => new Date(s.atMs).getHours())).toEqual([9, 11, 15, 17, 19, 21])
  })

  it('end ≤ start → none', () => {
    expect(ofCat(plan(T(2026, 10, 12, 7), water({ start: '21:00', end: '09:00' })), 'water')).toEqual([])
    expect(ofCat(plan(T(2026, 10, 12, 7), water({ start: '09:00', end: '09:00' })), 'water')).toEqual([])
    expect(ofCat(plan(T(2026, 10, 12, 7), water({ start: '09:00', end: '10:00' })), 'water')).toHaveLength(2)
  })

  it('slots are wall-clock times across the DST change (25 Oct)', () => {
    const w = ofCat(plan(T(2026, 10, 24, 22), water({ start: '01:00', end: '05:00', intervalMin: 60 })), 'water')
      .filter(s => s.key.startsWith('water:2026-10-25'))
    // A naive start + k·60 min would put two slots at 02:00 (CEST, then CET) and stop at 04:00.
    expect(w.map(s => new Date(s.atMs).getHours())).toEqual([1, 2, 3, 4, 5])
  })
})

describe('DECAY', () => {
  const prefs = prefsWith({ rank: { decayWarning: true, decayTime: '19:00' } })
  const rank = (r: Partial<NonNullable<PlannerData['rank']>> = {}) =>
    ({ points: 800, seasonStart: '2026-09-01', lastSessionDate: '2026-10-08', streakWeeks: 0, lastStreakWeek: '', ...r })

  it('warns on the last day before decay (day 7 after the last session)', () => {
    const d = ofCat(plan(MON_12_10, prefs, { rank: rank() }), 'decay')
    expect(d.map(s => s.id)).toEqual([nid(13, dayIdx('2026-10-15'), 0)])
    expect(d[0]).toMatchObject({ atMs: T(2026, 10, 15, 19), title: 'Rank decay starts tomorrow', route: '/workout', channelId: 'rank_alerts_v1' })
    expect(d[0].body).toContain('3% a day (max 25%)')
  })

  it('no points → none; no last session → season start; past or trained → none', () => {
    expect(ofCat(plan(MON_12_10, prefs, { rank: rank({ points: 0 }) }), 'decay')).toEqual([])
    expect(ofCat(plan(MON_12_10, prefs, { rank: rank({ lastSessionDate: undefined, seasonStart: '2026-10-10' }) }), 'decay')[0].key)
      .toBe('decay:2026-10-17')
    expect(ofCat(plan(MON_12_10, prefs, { rank: rank({ lastSessionDate: '2026-10-01' }) }), 'decay')).toEqual([])
    expect(ofCat(plan(MON_12_10, prefs, { rank: rank(), sessionDays: ['2026-10-15'] }), 'decay')).toEqual([])
    expect(ofCat(plan(T(2026, 10, 15, 10), prefs, { rank: rank(), activeSession: true }), 'decay')).toEqual([])
  })
})

describe('STREAK', () => {
  const prefs = prefsWith({ rank: { streakWarning: true, streakTime: '18:00' } })
  const rank = (r: Partial<NonNullable<PlannerData['rank']>> = {}) =>
    ({ points: 800, seasonStart: '2026-09-01', lastSessionDate: '2026-10-11', streakWeeks: 3, lastStreakWeek: '2026-10-05', ...r })

  it('warns n days before Sunday for n sessions needed', () => {
    const one = ofCat(plan(MON_12_10, prefs, { rank: rank(), weekSessionsDone: 1 }), 'streak')
    expect(one.map(s => s.key)).toEqual(['streak:2026-10-17'])
    expect(one[0]).toMatchObject({ atMs: T(2026, 10, 17, 18), title: 'Keep your 3-week streak', body: '2 more sessions by Sunday keeps it alive.' })
    const two = ofCat(plan(MON_12_10, prefs, { rank: rank(), weekSessionsDone: 2 }), 'streak')
    expect(two.map(s => s.key)).toEqual(['streak:2026-10-18'])
    expect(two[0].body).toBe('1 more session by Sunday keeps it alive.')
  })

  it('not at risk: target met this week already, no streak, or the streak already broke', () => {
    expect(ofCat(plan(MON_12_10, prefs, { rank: rank({ lastStreakWeek: '2026-10-12' }) }), 'streak')).toEqual([])
    expect(ofCat(plan(MON_12_10, prefs, { rank: rank({ streakWeeks: 0 }) }), 'streak')).toEqual([])
    expect(ofCat(plan(MON_12_10, prefs, { rank: rank({ lastStreakWeek: '2026-09-28' }) }), 'streak')).toEqual([])
    expect(ofCat(plan(MON_12_10, prefs, { rank: rank(), weekSessionsDone: 3 }), 'streak')).toEqual([])
  })

  it('suppressed when more sessions are needed than days are left (today always counts)', () => {
    // Friday 10:00, 3 needed: Fri+Sat+Sun → feasible, warn today.
    expect(ofCat(plan(T(2026, 10, 16, 10), prefs, { rank: rank() }), 'streak').map(s => s.key)).toEqual(['streak:2026-10-16'])
    // Friday 19:00 (after the 18:00 warning time): today's warning already fired → silent.
    expect(ofCat(plan(T(2026, 10, 16, 19), prefs, { rank: rank() }), 'streak')).toEqual([])
    // Thursday, 4 needed: Thu..Sun is still feasible, so nothing moves to another day.
    expect(ofCat(plan(T(2026, 10, 15, 19), prefs, { rank: rank(), weeklyTarget: 4 }), 'streak')).toEqual([])
    // Sunday 10:00, 2 needed → silent; 1 needed → today 18:00.
    expect(ofCat(plan(T(2026, 10, 18, 10), prefs, { rank: rank(), weekSessionsDone: 1 }), 'streak')).toEqual([])
    expect(ofCat(plan(T(2026, 10, 18, 10), prefs, { rank: rank(), weekSessionsDone: 2 }), 'streak')[0].atMs).toBe(T(2026, 10, 18, 18))
  })

  it('an active session on the warning day suppresses it', () => {
    expect(ofCat(plan(T(2026, 10, 18, 10), prefs, { rank: rank(), weekSessionsDone: 2, activeSession: true }), 'streak')).toEqual([])
  })

  it("target met this week: next week's warning once it is inside the window", () => {
    const met = rank({ streakWeeks: 4, lastStreakWeek: '2026-10-12' })
    // Sat 17 Oct 20:00, target 3: next week's warning is Fri 23 Oct 18:00 (the window's last day).
    const sat = ofCat(plan(T(2026, 10, 17, 20), prefs, { rank: met, weekSessionsDone: 3 }), 'streak')
    expect(sat.map(s => s.key)).toEqual(['streak:2026-10-23'])
    expect(sat[0]).toMatchObject({ atMs: T(2026, 10, 23, 18), title: 'Keep your 4-week streak', body: '3 more sessions by Sunday keeps it alive.' })
    // Monday: Fri 23 is outside the 7-day window → none yet.
    expect(ofCat(plan(MON_12_10, prefs, { rank: met, weekSessionsDone: 3 }), 'streak')).toEqual([])
  })
})

describe('training nudges: at most one per day', () => {
  const prefs = prefsWith({
    workout: { enabled: true, days: [4], time: '18:00' },
    rank: { decayWarning: true, decayTime: '19:00', streakWarning: true, streakTime: '18:30' },
  })
  // Thursday 15 Oct: workout day, decay warning day (last session 8 Oct), and with 3 needed by
  // Sunday the streak warning lands on Fri 16 — make it Thu by needing 4.
  const rank = { points: 800, seasonStart: '2026-09-01', lastSessionDate: '2026-10-08', streakWeeks: 2, lastStreakWeek: '2026-10-05' }

  it('DECAY wins, folds the streak, fires at the earliest time', () => {
    const all = plan(MON_12_10, prefs, { rank, weeklyTarget: 4 })
    const thu = all.filter(s => s.key.includes(':2026-10-15'))
    expect(thu).toHaveLength(1)
    expect(thu[0]).toMatchObject({ cat: 'decay', id: nid(13, dayIdx('2026-10-15'), 0), atMs: T(2026, 10, 15, 18), channelId: 'rank_alerts_v1' })
    expect(thu[0].key).toBe('decay:2026-10-15+streak+workout')
    expect(thu[0].body).toBe('Train today to keep your points and your 2-week streak — 4 more sessions by Sunday.')
  })

  it('STREAK beats WORKOUT on the same day', () => {
    const p = prefsWith({ workout: { enabled: true, days: [6], time: '17:00' }, rank: { streakWarning: true, streakTime: '18:00' } })
    const sat = plan(MON_12_10, p, { rank: { ...rank, lastSessionDate: '2026-10-11' }, weekSessionsDone: 1 })
      .filter(s => s.key.includes(':2026-10-17'))
    expect(sat).toHaveLength(1)
    expect(sat[0]).toMatchObject({ cat: 'streak', atMs: T(2026, 10, 17, 17), title: 'Keep your 2-week streak' })
    expect(sat[0].body).toBe('2 more sessions by Sunday keeps it alive. Today is a training day.')
  })

  it('other days keep their own nudge', () => {
    const p = prefsWith({ workout: { enabled: true, days: [1, 2, 3, 4, 5, 6, 7], time: '18:00' }, rank: { decayWarning: true, decayTime: '19:00' } })
    const all = plan(MON_12_10, p, { rank })
    const training = all.filter(s => s.cat === 'workout' || s.cat === 'decay' || s.cat === 'streak')
    expect(new Set(training.map(s => s.key.split(':')[1].split('+')[0])).size).toBe(training.length)
    expect(training.find(s => s.key.startsWith('decay:'))?.key).toBe('decay:2026-10-15+workout')
  })

  it('a day whose earliest nudge already passed gets none (it already fired)', () => {
    const p = prefsWith({ workout: { enabled: true, days: [4], time: '18:00' }, rank: { decayWarning: true, decayTime: '19:00' } })
    expect(plan(T(2026, 10, 15, 18, 30), p, { rank }).filter(s => s.key.includes('2026-10-15'))).toEqual([])
  })

  it('a folded streak warning does not unfold after its time (default prefs: no second decay nudge)', () => {
    const p = prefsWith({ rank: { decayWarning: true, decayTime: '19:00', streakWarning: true, streakTime: '18:00' } })
    // Last session Fri 9 Oct, nothing this week, target 3: decay and streak warnings both land on Fri 16.
    const r = { ...rank, lastSessionDate: '2026-10-09' }
    const fri = (h: number, mi = 0, pr = p) => plan(T(2026, 10, 16, h, mi), pr, { rank: r }).filter(s => s.key.includes('2026-10-16'))
    expect(fri(10).map(s => [s.key, s.atMs])).toEqual([['decay:2026-10-16+streak', T(2026, 10, 16, 18)]])
    expect(fri(18, 10)).toEqual([])
    expect(fri(19, 30)).toEqual([])
    // The same with an opt-in workout reminder later than the streak time: no 20:00 "Time to train".
    const w = prefsWith({ workout: { enabled: true, days: [5], time: '20:00' }, rank: { streakWarning: true, streakTime: '18:00' } })
    expect(fri(10, 0, w).map(s => s.key)).toEqual(['streak:2026-10-16+workout'])
    expect(fri(19, 0, w)).toEqual([])
  })
})

describe('RECAP', () => {
  const mon = prefsWith({ recap: { enabled: true, when: 'monday-morning', time: '09:00' } })
  const sun = prefsWith({ recap: { enabled: true, when: 'sunday-evening', time: '19:00' } })
  const rank = { points: 800, seasonStart: '2026-09-01', streakWeeks: 4, lastStreakWeek: '2026-10-12' }

  it('Monday morning summarizes last week', () => {
    const r = ofCat(plan(MON_12_10, mon, { rank, recap: { weekMonday: '2026-10-12', sessions: 3, points: 412.4 } }), 'recap')
    expect(r.map(s => s.id)).toEqual([nid(15, dayIdx('2026-10-19'), 0)])
    expect(r[0]).toMatchObject({ atMs: T(2026, 10, 19, 9), title: 'Your weekly recap', route: '/progress/week', channelId: 'weekly_recap_v1' })
    expect(r[0].body).toBe('Last week: 3 sessions, +412 pts, 4-week streak.')
    const early = ofCat(plan(T(2026, 10, 12, 8), mon, { recap: { weekMonday: '2026-10-05', sessions: 1, points: 90 } }), 'recap')
    expect(early[0].atMs).toBe(T(2026, 10, 12, 9))
    expect(early[0].body).toBe('Last week: 1 session, +90 pts.')
  })

  it('the week the streak broke reports no streak', () => {
    // Week of 12 Oct: 1 of 3 sessions; the streak was last met the week of 5 Oct (still 3 until Monday's reset).
    const broke = { ...rank, streakWeeks: 3, lastStreakWeek: '2026-10-05' }
    const m = ofCat(plan(T(2026, 10, 18, 21), mon, { rank: broke, recap: { weekMonday: '2026-10-12', sessions: 1, points: 120 } }), 'recap')
    expect(m[0]).toMatchObject({ atMs: T(2026, 10, 19, 9), body: 'Last week: 1 session, +120 pts.' })
    // Sunday evening of that week: the streak is still alive until the week ends.
    const s = ofCat(plan(T(2026, 10, 18, 10), sun, { rank: broke, recap: { weekMonday: '2026-10-12', sessions: 1, points: 120 } }), 'recap')
    expect(s[0].body).toBe('This week: 1 session, +120 pts, 3-week streak.')
    // A streak that broke even earlier is gone on Sunday too.
    const old = ofCat(plan(T(2026, 10, 18, 10), sun, { rank: { ...broke, lastStreakWeek: '2026-09-28' }, recap: { weekMonday: '2026-10-12', sessions: 1, points: 120 } }), 'recap')
    expect(old[0].body).toBe('This week: 1 session, +120 pts.')
  })

  it('Sunday evening summarizes this week', () => {
    const r = ofCat(plan(MON_12_10, sun, { recap: { weekMonday: '2026-10-12', sessions: 2, points: 150 } }), 'recap')
    expect(r[0].atMs).toBe(T(2026, 10, 18, 19))
    expect(r[0].body).toBe('This week: 2 sessions, +150 pts.')
    expect(r[0].route).toBe('/rank') // the open week has no review yet
  })

  it('the sig changes with the numbers; mismatched week or no data → none', () => {
    const a = ofCat(plan(MON_12_10, mon, { recap: { weekMonday: '2026-10-12', sessions: 3, points: 100 } }), 'recap')[0]
    const b = ofCat(plan(MON_12_10, mon, { recap: { weekMonday: '2026-10-12', sessions: 3, points: 130 } }), 'recap')[0]
    expect(a.id).toBe(b.id)
    expect(a.sig).not.toBe(b.sig)
    expect(ofCat(plan(MON_12_10, mon, { recap: { weekMonday: '2026-10-05', sessions: 3, points: 100 } }), 'recap')).toEqual([])
    expect(ofCat(plan(MON_12_10, mon, { recap: null }), 'recap')).toEqual([])
  })
})

describe('WEIGHIN, OPEN_SESSION, KEEPALIVE', () => {
  it('weigh-in on its weekday unless already logged', () => {
    const p = prefsWith({ weighIn: { enabled: true, weekday: 3, time: '07:30' } })
    const w = ofCat(plan(MON_12_10, p), 'weighin')
    expect(w.map(s => s.id)).toEqual([nid(16, dayIdx('2026-10-14'), 0)])
    expect(w[0]).toMatchObject({ atMs: T(2026, 10, 14, 7, 30), route: '/progress', channelId: 'workout_reminders_v1' })
    expect(ofCat(plan(MON_12_10, p, { bodyLogDates: ['2026-10-14'] }), 'weighin')).toEqual([])
  })

  it('open session nudge 3 h after the start, only while the session is active', () => {
    const p = prefsWith({ workout: { openSessionNudge: true } })
    const start = T(2026, 10, 12, 9, 40)
    const o = ofCat(plan(MON_12_10, p, { activeSession: true, activeSessionStartedAt: start }), 'openSession')
    expect(o).toHaveLength(1)
    expect(o[0]).toMatchObject({ id: nid(17, dayIdx('2026-10-12'), 0), atMs: start + 3 * 3_600_000, route: '/workout/session' })
    expect(o[0].title).toBe('Workout still open')
    expect(ofCat(plan(MON_12_10, p, { activeSession: false, activeSessionStartedAt: start }), 'openSession')).toEqual([])
    expect(ofCat(plan(MON_12_10, prefsWith({}), { activeSession: true, activeSessionStartedAt: start }), 'openSession')).toEqual([])
    // Started 22:30 → nudge after midnight carries tomorrow's day index.
    const late = ofCat(plan(T(2026, 10, 12, 22, 31), p, { activeSession: true, activeSessionStartedAt: T(2026, 10, 12, 22, 30) }), 'openSession')
    expect(decodeNid(late[0].id)!.day).toBe(dayIdx('2026-10-13'))
    // Open for more than 3 h already → nothing (never fire immediately).
    expect(ofCat(plan(T(2026, 10, 12, 14), p, { activeSession: true, activeSessionStartedAt: T(2026, 10, 12, 10) }), 'openSession')).toEqual([])
  })

  it('keep-alive on the last window day at 12:00 when any category is on', () => {
    const p = prefsWith({ recap: { enabled: true, when: 'monday-morning', time: '09:00' } })
    const k = ofCat(plan(MON_12_10, p), 'keepalive')
    expect(k.map(s => s.id)).toEqual([nid(18, dayIdx('2026-10-18'), 0)])
    expect(k[0]).toMatchObject({ atMs: T(2026, 10, 18, 12), channelId: 'app_status_v1', route: '/workout' })
    expect(k[0].body).toBe('Open GymTracker to keep your reminders coming.')
    expect(ofCat(plan(MON_12_10, prefsWith({ workout: { openSessionNudge: true } })), 'keepalive')).toEqual([])
    expect(ofCat(plan(MON_12_10, prefsWith({ workout: { enabled: true, days: [] } })), 'keepalive')).toEqual([])
  })
})

describe('global invariants over a fully enabled fixture', () => {
  const all = mergeNotifyPrefs({
    enabled: true,
    workout: { enabled: true, days: [1, 2, 3, 4, 5, 6, 7], time: '18:00', skipWhenTargetMet: false, openSessionNudge: true },
    meals: {
      breakfast: { enabled: true, time: '08:30' }, lunch: { enabled: true, time: '13:00' },
      snack: { enabled: true, time: '16:30' }, dinner: { enabled: true, time: '20:00' },
    },
    water: { enabled: true, start: '07:00', end: '23:00', intervalMin: 60 },
    rank: { decayWarning: true, decayTime: '19:00', streakWarning: true, streakTime: '18:00' },
    recap: { enabled: true, when: 'monday-morning', time: '09:00' },
    weighIn: { enabled: true, weekday: 2, time: '08:00' },
  })
  const fixture = input(T(2026, 10, 12, 0, 5), all, {
    activeSession: true,
    activeSessionStartedAt: T(2026, 10, 12, 0, 1),
    rank: { points: 900, seasonStart: '2026-09-01', lastSessionDate: '2026-10-06', streakWeeks: 5, lastStreakWeek: '2026-10-05' },
    recap: { weekMonday: '2026-10-05', sessions: 4, points: 380 },
  })
  const specs = planNotifications(fixture)

  it('unique ids, sorted, capped, known channels and routes, sig consistent', () => {
    expect(specs.length).toBeGreaterThan(40)
    expect(new Set(specs.map(s => s.id)).size).toBe(specs.length)
    for (let i = 1; i < specs.length; i++) {
      expect(specs[i].atMs > specs[i - 1].atMs || (specs[i].atMs === specs[i - 1].atMs && specs[i].id > specs[i - 1].id)).toBe(true)
    }
    expect(specs.length).toBeLessThanOrEqual(MAX_SCHEDULED)
    const channels = new Set(Object.values(CHANNEL_FOR))
    const routes = new Set<string>(REMINDER_ROUTES)
    for (const s of specs) {
      expect(channels.has(s.channelId)).toBe(true)
      expect(routes.has(s.route)).toBe(true)
      expect(isManagedId(s.id)).toBe(true)
      expect(s.atMs).toBeGreaterThan(fixture.now + LEAD_MS)
      expect(s.sig).toBe(`${s.atMs}|${s.channelId}|${s.title}|${s.body}|${s.route}`)
      expect(s.id).toBeLessThanOrEqual(2_147_483_647)
    }
    const cats = new Set(specs.map(s => s.cat))
    for (const c of ['workout', 'meal', 'water', 'decay', 'recap', 'weighin', 'openSession', 'keepalive']) expect(cats.has(c as never)).toBe(true)
  })

  it('reminder routes are real screens, never a summary (invariant 11)', () => {
    for (const r of REMINDER_ROUTES) expect(KNOWN_ROUTES).toContain(r)
    expect(REMINDER_ROUTES.some(r => r.includes('summary'))).toBe(false)
  })

  it('MAX_SCHEDULED truncation keeps the keep-alive', () => {
    const many = mergeNotifyPrefs({ ...all, water: { enabled: true, start: '00:00', end: '23:00', intervalMin: 60 } })
    const s = planNotifications({ ...fixture, prefs: many })
    expect(s.length).toBeLessThanOrEqual(MAX_SCHEDULED)
    expect(s.some(x => x.cat === 'keepalive')).toBe(true)
  })

  it('planHorizon ignores the keep-alive', () => {
    const k = specs.find(s => s.cat === 'keepalive')!
    const others = specs.filter(s => s.cat !== 'keepalive')
    expect(planHorizon(specs)).toBe(Math.max(...others.map(s => s.atMs)))
    expect(planHorizon([k])).toBeUndefined()
    expect(planHorizon([])).toBeUndefined()
  })

  it('an Italian plan has the same alarms with Italian text, so every sig changes', () => {
    const it_ = planNotifications({ ...fixture, lang: 'it' })
    expect(it_.map(s => [s.id, s.atMs, s.route])).toEqual(specs.map(s => [s.id, s.atMs, s.route]))
    for (let i = 0; i < specs.length; i++) expect(it_[i].sig).not.toBe(specs[i].sig)
    const one = (cat: NotificationSpec['cat']) => it_.find(s => s.cat === cat)!
    expect(one('meal')).toMatchObject({ title: 'Registra la colazione', body: 'Tocca per registrare la colazione.' })
    expect(one('water')).toMatchObject({ title: 'Bevi un po’ d’acqua', body: 'È il momento di bere.' })
    expect(one('recap')).toMatchObject({ title: 'Il tuo riepilogo settimanale', body: 'Settimana scorsa: 4 allenamenti, +380 pt, streak di 5 settimane.' })
    expect(one('keepalive').title).toBe('Promemoria di GymTracker')
    expect(planNotifications({ ...fixture, lang: 'en' })).toEqual(specs) // English is the default
  })
})

describe('DST', () => {
  const lunch = prefsWith({ meals: { lunch: { enabled: true, time: '13:00' } } as NotifyPrefs['meals'] })

  it('autumn: the 25 Oct lunch reminder is at 13:00 CET', () => {
    const s = ofCat(plan(T(2026, 10, 24, 12), lunch), 'meal').find(x => x.key === 'meal:2026-10-25:lunch')!
    expect(s.atMs).toBe(new Date(2026, 9, 25, 13, 0).getTime())
    expect(s.atMs).toBe(Date.UTC(2026, 9, 25, 12, 0))
    expect(decodeNid(s.id)!.day).toBe(dayIdx('2026-10-25'))
  })

  it('spring: the 29 Mar lunch reminder is at 13:00 CEST', () => {
    const s = ofCat(plan(T(2026, 3, 28, 12), lunch), 'meal').find(x => x.key === 'meal:2026-03-29:lunch')!
    expect(s.atMs).toBe(Date.UTC(2026, 2, 29, 11, 0))
  })

  it('a workout window spanning the change keeps 18:00 local every day', () => {
    const p = prefsWith({ workout: { enabled: true, days: [1, 2, 3, 4, 5, 6, 7], time: '18:00', skipWhenTargetMet: false } })
    const w = ofCat(plan(T(2026, 10, 22, 10), p), 'workout')
    expect(w).toHaveLength(7)
    expect(w.every(s => new Date(s.atMs).getHours() === 18 && new Date(s.atMs).getMinutes() === 0)).toBe(true)
  })
})

describe('diffSchedules', () => {
  const prefs = prefsWith({ meals: { lunch: { enabled: true, time: '13:00' } } as NotifyPrefs['meals'] })
  const desired = plan(MON_12_10, prefs).filter(s => s.cat === 'meal').slice(0, 3)
  const pending = desired.map(s => ({ id: s.id, sig: s.sig, exact: true }))

  it('identical → nothing to do', () => {
    expect(diffSchedules(pending, desired, true)).toEqual({ cancel: [], schedule: [] })
  })

  it('changed sig → cancel + schedule of the same id', () => {
    const p = [{ ...pending[0], sig: 'old' }, ...pending.slice(1)]
    const d = diffSchedules(p, desired, true)
    expect(d.cancel).toEqual([desired[0].id])
    expect(d.schedule.map(s => s.id)).toEqual([desired[0].id])
  })

  it('unknown managed pending → cancel; new desired → schedule', () => {
    const extra = { id: nid(12, 300, 4), sig: 'x', exact: true }
    const d = diffSchedules([...pending.slice(1), extra], desired, true)
    expect(d.cancel).toEqual([extra.id])
    expect(d.schedule.map(s => s.id)).toEqual([desired[0].id])
  })

  it('never touches RestTimer or test ids', () => {
    const d = diffSchedules([...pending, { id: 4201 }, { id: 4202 }, { id: nid(99, 0, 0), sig: 'x' }], desired, true)
    expect(d).toEqual({ cancel: [], schedule: [] })
  })

  it('an alarm whose exactness differs from the current state is re-armed', () => {
    const inexact = pending.map(p => ({ ...p, exact: false }))
    const d = diffSchedules(inexact, desired, true)
    expect(d.cancel.sort()).toEqual(desired.map(s => s.id).sort())
    expect(d.schedule).toHaveLength(desired.length)
    // Unknown exactness or no current state → only the sig decides.
    expect(diffSchedules(pending.map(p => ({ id: p.id, sig: p.sig })), desired, true)).toEqual({ cancel: [], schedule: [] })
    expect(diffSchedules(inexact, desired)).toEqual({ cancel: [], schedule: [] })
  })
})

describe('planCleanup', () => {
  const prefs = prefsWith({
    meals: { breakfast: { enabled: true, time: '08:30' }, lunch: { enabled: true, time: '13:00' } } as NotifyPrefs['meals'],
    water: { enabled: true, start: '09:00', end: '21:00', intervalMin: 120 },
    workout: { enabled: true, days: [1], time: '08:00' },
    rank: { decayWarning: true, decayTime: '09:00' },
    recap: { enabled: true, when: 'monday-morning', time: '08:00' },
  })
  const today = dayIdx('2026-10-12')
  const now = T(2026, 10, 12, 16)
  const rank = { points: 500, seasonStart: '2026-09-01', lastSessionDate: '2026-10-05', streakWeeks: 0, lastStreakWeek: '' }

  it('keeps only the latest water slot today; removes yesterday, logged meals and the keep-alive', () => {
    const delivered = [
      nid(12, today, 0), nid(12, today, 1), nid(12, today, 3), // water 09, 11, 15 (13 sits on lunch)
      nid(11, today, 0), // breakfast (logged)
      nid(11, today, 1), // lunch (not logged)
      nid(11, today - 1, 3), nid(12, today - 1, 6), // yesterday
      nid(18, today, 0), // keep-alive
      4201, 4202, nid(99, 0, 0),
    ]
    const out = planCleanup(delivered, input(now, prefs, { mealsLoggedToday: ['breakfast'], rank }))
    expect(out.sort()).toEqual([
      nid(12, today, 0), nid(12, today, 1), nid(11, today, 0), nid(11, today - 1, 3), nid(12, today - 1, 6), nid(18, today, 0),
    ].sort())
  })

  it('removes water once the target is reached or after a drink', () => {
    const w15 = nid(12, today, 3)
    expect(planCleanup([w15], input(now, prefs, { waterTodayMl: 2500 }))).toEqual([w15])
    expect(planCleanup([w15], input(now, prefs, { lastWaterAt: T(2026, 10, 12, 15, 20) }))).toEqual([w15])
    expect(planCleanup([w15], input(now, prefs))).toEqual([])
  })

  it('removes the workout nudge once trained or in a session; decay when it no longer applies', () => {
    expect(planCleanup([nid(10, today, 0)], input(now, prefs))).toEqual([])
    expect(planCleanup([nid(10, today, 0)], input(now, prefs, { sessionDays: ['2026-10-12'] }))).toEqual([nid(10, today, 0)])
    expect(planCleanup([nid(10, today, 0)], input(now, prefs, { activeSession: true }))).toEqual([nid(10, today, 0)])
    const decay = nid(13, today, 0)
    expect(planCleanup([decay], input(now, prefs, { rank }))).toEqual([])
    expect(planCleanup([decay], input(now, prefs, { rank, sessionDays: ['2026-10-12'] }))).toEqual([decay])
    expect(planCleanup([decay], input(now, prefs, { rank: { ...rank, points: 0 } }))).toEqual([decay])
  })

  it('a delivered streak warning survives until the day ends', () => {
    const p = prefsWith({ rank: { streakWarning: true, streakTime: '18:00' } })
    const r = { points: 500, seasonStart: '2026-09-01', lastSessionDate: '2026-10-11', streakWeeks: 2, lastStreakWeek: '2026-10-05' }
    const fri = dayIdx('2026-10-16')
    // Fri 18:00 warning (3 needed); at 18:30 planning would call it infeasible, cleanup keeps it.
    expect(ofCat(plan(T(2026, 10, 16, 18, 30), p, { rank: r }), 'streak')).toEqual([])
    expect(planCleanup([nid(14, fri, 0)], input(T(2026, 10, 16, 18, 30), p, { rank: r }))).toEqual([])
    expect(planCleanup([nid(14, fri, 0)], input(T(2026, 10, 17, 9), p, { rank: r }))).toEqual([nid(14, fri, 0)])
  })

  it("keeps today's and yesterday's recap only", () => {
    expect(planCleanup([nid(15, today, 0), nid(15, today - 1, 0), nid(15, today - 2, 0)], input(now, prefs))).toEqual([nid(15, today - 2, 0)])
  })

  it('open-session nudge stays while the session is open', () => {
    const p = prefsWith({ workout: { openSessionNudge: true } })
    const start = T(2026, 10, 11, 21)
    const id = nid(17, dayIdx('2026-10-12'), 0)
    expect(planCleanup([id], input(now, p, { activeSession: true, activeSessionStartedAt: start }))).toEqual([])
    expect(planCleanup([id], input(now, p, { activeSession: false }))).toEqual([id])
  })

  it('master switch off removes every managed notification and nothing else', () => {
    const off = mergeNotifyPrefs({ ...prefs, enabled: false })
    expect(planCleanup([nid(15, today, 0), nid(11, today, 1), 4201, nid(99, 0, 0)], input(now, off))).toEqual([nid(15, today, 0), nid(11, today, 1)])
  })
})
