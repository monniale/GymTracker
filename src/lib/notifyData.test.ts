import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { GymDB, onSyncDirty, withSyncTrackingSuspended } from '../db/db'
import { gatherPlannerData } from './notifyData'
import { planNotifications } from './notifyPlanner'
import { mergeNotifyPrefs } from './notifyPrefs'
import type { Settings } from '../types'

/* Local times (Europe/Rome, pinned by `npm test`). */
const T = (y: number, m: number, d: number, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi).getTime()
const NOW = T(2026, 10, 14, 10) // Wednesday 14 Oct 2026, 10:00

const SETTINGS: Settings = {
  id: 1, bodyweightKg: 80, kcalTarget: 2500, proteinTarget: 160, carbsTarget: 280, fatTarget: 80,
  soundEnabled: true, defaultRestSec: 90, weeklySessionTarget: 4, waterTargetMl: 3000,
}

let gdb: GymDB

beforeEach(async () => {
  await Dexie.delete('gymtracker')
  gdb = new GymDB()
  await gdb.open()
})

afterEach(() => {
  gdb.close()
})

/** Fixture rows written with sync tracking suspended, so `updatedAt` stays exactly as given. */
async function seed(): Promise<void> {
  await withSyncTrackingSuspended(async () => {
    await gdb.settings.put(SETTINGS)
    await gdb.rankState.put({
      id: 1, seasonId: 3, seasonStart: '2026-09-01', points: 1234, streakWeeks: 2, lastStreakWeek: '2026-10-05',
      lastSessionDate: '2026-10-13', idleDecayTaken: 0, lastDecayCheckDate: '2026-10-14',
    })
    await gdb.sessions.bulkPut([
      // last week (inside today-7 .. today+7)
      { id: 's-prev', name: 'Old', startedAt: T(2026, 10, 8, 18), endedAt: T(2026, 10, 8, 19), bodyweightKg: 80, extraExerciseIds: [] },
      // 8 days ago: outside the ±7-day window but in last week's recap
      { id: 's-prev2', name: 'Older', startedAt: T(2026, 10, 6, 18), endedAt: T(2026, 10, 6, 19), bodyweightKg: 80, extraExerciseIds: [] },
      // this week: Monday finished, Tuesday finished, today an unfinished (active) one
      { id: 's-mon', name: 'Mon', startedAt: T(2026, 10, 12, 18), endedAt: T(2026, 10, 12, 19), bodyweightKg: 80, extraExerciseIds: [] },
      { id: 's-tue', name: 'Tue', startedAt: T(2026, 10, 13, 7), endedAt: T(2026, 10, 13, 8), bodyweightKg: 80, extraExerciseIds: [] },
      { id: 's-now', name: 'Now', startedAt: T(2026, 10, 14, 9, 30), bodyweightKg: 80, extraExerciseIds: [] },
      // outside the ±7-day window
      { id: 's-old', name: 'Ancient', startedAt: T(2026, 9, 1, 18), endedAt: T(2026, 9, 1, 19), bodyweightKg: 80, extraExerciseIds: [] },
    ])
    await gdb.dayTypes.bulkPut([
      { date: '2026-10-16', type: 'rest' },
      { date: '2026-10-18', type: 'training' },
      { date: '2026-10-30', type: 'rest' }, // outside the window
    ])
    await gdb.foodLogs.bulkPut([
      { id: 'f1', date: '2026-10-14', meal: 'breakfast', foodId: 1, grams: 100, loggedAt: T(2026, 10, 14, 8) },
      { id: 'f2', date: '2026-10-14', meal: 'snack', foodId: 1, grams: 50, loggedAt: T(2026, 10, 14, 9) },
      { id: 'f3', date: '2026-10-13', meal: 'lunch', foodId: 1, grams: 200, loggedAt: T(2026, 10, 13, 13) },
    ])
    await gdb.waterLogs.bulkPut([
      { id: 'w1', date: '2026-10-14', ml: 250, updatedAt: T(2026, 10, 14, 8, 15) },
      { id: 'w2', date: '2026-10-14', ml: 500, updatedAt: T(2026, 10, 14, 9, 40) },
      { id: 'w3', date: '2026-10-13', ml: 2000, updatedAt: T(2026, 10, 13, 20) },
    ])
    await gdb.bodyLog.bulkPut([
      { date: '2026-10-15', weightKg: 80.2 },
      { date: '2026-10-01', weightKg: 81 },
    ])
    await gdb.scoreEvents.bulkPut([
      { id: 'e1', sessionId: 's-mon', date: '2026-10-12', basePoints: 100, prBonus: 0, streakMult: 1, dayFactor: 1, total: 120.5, breakdown: [] },
      { id: 'e2', sessionId: 's-tue', date: '2026-10-13', basePoints: 80, prBonus: 0, streakMult: 1, dayFactor: 1, total: 90, breakdown: [] },
      { id: 'e3', label: 'Quest', date: '2026-10-14', basePoints: 15, prBonus: 0, streakMult: 1, dayFactor: 1, total: 15, breakdown: [] },
      { id: 'e4', sessionId: 's-prev', date: '2026-10-08', basePoints: 70, prBonus: 0, streakMult: 1, dayFactor: 1, total: 70, breakdown: [] },
    ])
  })
}

describe('gatherPlannerData (fake-indexeddb, fresh GymDB)', () => {
  it('maps the Dexie rows to PlannerData', async () => {
    await seed()
    const prefs = mergeNotifyPrefs({ recap: { enabled: true, when: 'sunday-evening', time: '19:00' } })
    const d = await gatherPlannerData(NOW, prefs, 's-now', gdb)
    expect(d).toEqual({
      today: '2026-10-14',
      activeSession: true,
      activeSessionStartedAt: T(2026, 10, 14, 9, 30),
      sessionDays: ['2026-10-08', '2026-10-12', '2026-10-13', '2026-10-14'],
      weekSessionsDone: 2,
      weeklyTarget: 4,
      dayTypeOverrides: { '2026-10-16': 'rest', '2026-10-18': 'training' },
      mealsLoggedToday: ['breakfast', 'snack'],
      waterTodayMl: 750,
      waterTargetMl: 3000,
      lastWaterAt: T(2026, 10, 14, 9, 40),
      bodyLogDates: ['2026-10-15'],
      scheduledDays: {},
      rank: { points: 1234, seasonStart: '2026-09-01', lastSessionDate: '2026-10-13', streakWeeks: 2, lastStreakWeek: '2026-10-05' },
      // Sunday-evening recap on 18 Oct covers this week: 2 finished sessions, 120.5 + 90 + 15 pts.
      recap: { weekMonday: '2026-10-12', sessions: 2, points: 225.5 },
    })
  })

  it('a Monday-morning recap covers the previous week', async () => {
    await seed()
    const prefs = mergeNotifyPrefs({ recap: { enabled: true, when: 'monday-morning', time: '09:00' } })
    // Monday 12 Oct 08:00 → recap today at 09:00 about 5–11 Oct.
    const d = await gatherPlannerData(T(2026, 10, 12, 8), prefs, null, gdb)
    expect(d.recap).toEqual({ weekMonday: '2026-10-05', sessions: 2, points: 70 })
    expect(d.activeSession).toBe(false)
    expect(d.activeSessionStartedAt).toBeNull()
  })

  it('recap off → null; empty database → neutral defaults', async () => {
    const prefs = mergeNotifyPrefs({ recap: { enabled: false } })
    const d = await gatherPlannerData(NOW, prefs, null, gdb)
    expect(d).toMatchObject({
      sessionDays: [], weekSessionsDone: 0, weeklyTarget: 3, dayTypeOverrides: {}, mealsLoggedToday: [],
      waterTodayMl: 0, waterTargetMl: 2500, lastWaterAt: null, bodyLogDates: [], scheduledDays: {}, rank: null, recap: null,
    })
  })

  it('maps the template schedule onto the window dates (lowest position wins a shared weekday)', async () => {
    await withSyncTrackingSuspended(async () => {
      await gdb.templates.bulkPut([
        { id: 't-legs', name: 'Legs', position: 2, items: [], weekdays: [4, 1], updatedAt: 1 },
        { id: 't-push', name: 'Push', position: 0, items: [], weekdays: [1, 5], updatedAt: 1 },
        { id: 't-sun', name: 'Long run', position: 3, items: [], weekdays: [0], updatedAt: 1 },
        { id: 't-free', name: 'Free', position: 1, items: [], updatedAt: 1 },
      ])
    })
    // Wed 14 Oct: window 14..20 Oct.
    const d = await gatherPlannerData(NOW, mergeNotifyPrefs({}), null, gdb)
    expect(d.scheduledDays).toEqual({
      '2026-10-15': 'Legs', // Thursday
      '2026-10-16': 'Push', // Friday
      '2026-10-18': 'Long run', // Sunday = 0
      '2026-10-19': 'Push', // Monday: Push (position 0) before Legs (position 2)
    })
    const prefs = mergeNotifyPrefs({ workout: { enabled: true, days: [3], time: '18:00', skipWhenTargetMet: false } })
    const keys = planNotifications({ now: NOW, prefs, data: d }).filter(s => s.cat === 'workout').map(s => s.key)
    // The schedule replaces Wednesday from prefs.
    expect(keys).toEqual(['workout:2026-10-15', 'workout:2026-10-16', 'workout:2026-10-18', 'workout:2026-10-19'])
  })

  it('a finished or missing "active" session has no start time', async () => {
    await seed()
    const prefs = mergeNotifyPrefs({})
    expect((await gatherPlannerData(NOW, prefs, 's-tue', gdb)).activeSessionStartedAt).toBeNull()
    expect((await gatherPlannerData(NOW, prefs, 'nope', gdb)).activeSessionStartedAt).toBeNull()
    expect((await gatherPlannerData(NOW, prefs, 'nope', gdb)).activeSession).toBe(true)
  })

  it('only reads: no write reaches the sync middleware', async () => {
    await seed()
    let dirty = 0
    const off = onSyncDirty(() => dirty++)
    const before = await gdb.rankState.get(1)
    await gatherPlannerData(NOW, mergeNotifyPrefs({}), 's-now', gdb)
    off()
    expect(dirty).toBe(0)
    expect(await gdb.rankState.get(1)).toEqual(before)
    expect(await gdb.quests.count()).toBe(0) // evaluateQuests() never runs
  })

  it('feeds the planner end to end', async () => {
    await seed()
    const prefs = mergeNotifyPrefs({
      workout: { enabled: true, days: [3, 5, 7], time: '18:00', skipWhenTargetMet: true, openSessionNudge: true },
      meals: { breakfast: { enabled: true, time: '08:30' }, lunch: { enabled: true, time: '13:00' } },
      weighIn: { enabled: true, weekday: 4, time: '08:00' },
    })
    const specs = planNotifications({ now: NOW, prefs, data: await gatherPlannerData(NOW, prefs, 's-now', gdb) })
    const keys = specs.map(s => s.key)
    expect(keys).not.toContain('workout:2026-10-14') // trained today (active session)
    expect(keys).not.toContain('workout:2026-10-16') // rest-day override
    expect(keys).toContain('workout:2026-10-18')
    expect(keys).not.toContain('meal:2026-10-14:breakfast') // logged
    expect(keys).toContain('meal:2026-10-14:lunch')
    expect(keys).not.toContain('weighin:2026-10-15') // already weighed in
    expect(specs.find(s => s.cat === 'openSession')?.atMs).toBe(T(2026, 10, 14, 12, 30))
  })
})
