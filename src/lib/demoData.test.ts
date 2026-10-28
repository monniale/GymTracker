import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db, isSyncDirty, setSyncDirty } from '../db/db'
import { collectTables, importBackup, TABLES, type BackupFile, type TableDump } from '../db/backup'
import { DEFAULT_SETTINGS, ensureSeeded } from '../db/seed'
import { DECAY_GRACE_DAYS, SEASON_CARRYOVER } from './ranks'
import { addDays, daysBetween, localDateStr, mondayOf, parseLocalDate } from './dates'
import { useUiStore } from './uiStore'
import { useAppStore } from '../store'
import { useSyncStore } from './sync'
import { t } from '../i18n'
import {
  DEMO_TZ, DEMO_URL, canOfferDemo, reanchorMs, clearDemoData, demoPlanShiftDays, demoShiftDays, hasUserData, isDemoLoaded,
  loadDemoData, rebaseDemoTables,
} from './demoData'
import type {
  CoachJudgement, FoodLog, PlannedFood, QuestState, RankState, SavedMeal, ScoreEvent, Season,
  Session, SetRow, WorkoutTemplate,
} from '../types'

/** Local wall-clock time (npm test pins TZ=Europe/Rome). */
const T = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime()
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
/** Epoch ms between 2001 and 2286: no other number in the data (ids, kg, points) gets that big. */
const isMs = (v: unknown): v is number => typeof v === 'number' && v >= 1e12 && v < 1e13
const shiftMsLocal = (ms: number, days: number) => {
  const d = new Date(ms)
  d.setDate(d.getDate() + days)
  return d.getTime()
}

/** Node has no localStorage; the dirty flag, the weekly review marker and the zustand stores
 * (gymtracker-ui, gymtracker-app) live there. Installed before the stores are imported. */
vi.hoisted(() => {
  const m = new Map<string, string>()
  const storage: Storage = {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: k => m.get(k) ?? null,
    key: i => [...m.keys()][i] ?? null,
    removeItem: k => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  }
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true })
})

const note = { headline: 'Solid week', tone: 'positive' as const, insights: [] }

/** A small demo covering every TABLES table, exported on Wed 14 Oct 2026 at 20:00. */
function fixture(): BackupFile {
  const s = (id: string, start: number): Session => ({
    id, templateId: 't1', name: 'Push', startedAt: start, endedAt: start + 3_600_000,
    bodyweightKg: 84, extraExerciseIds: [2], points: 100, updatedAt: start + 3_600_000,
  })
  const sessions = [s('s1', T(2026, 10, 5, 18)), s('s2', T(2026, 10, 7, 18, 30)), s('s3', T(2026, 10, 12, 18)), s('s4', T(2026, 10, 14, 7))]
  const sets: SetRow[] = sessions.flatMap((ss, i) => [1, 2].map(n => ({
    id: `set-${i}-${n}`, sessionId: ss.id!, exerciseId: n, setNumber: n, weightKg: 80, reps: 8,
    isWarmup: false, completedAt: ss.startedAt + n * 600_000, e1rm: 101.3, updatedAt: ss.startedAt + n * 600_000,
  })))
  const ev = (id: string, sessionId: string | undefined, date: string, total: number): ScoreEvent => ({
    id, sessionId, date, basePoints: total, prBonus: 0, streakMult: 1, dayFactor: 1, total, breakdown: [],
    ...(sessionId ? {} : { label: 'Quest: Three sessions' }), updatedAt: T(2026, 10, 14, 8),
  })
  const scoreEvents = [
    ev('e0', undefined, '2026-09-20', 999), // previous season: outside the current season sum
    ev('e1', 's1', '2026-10-05', 100), ev('e2', 's2', '2026-10-07', 120),
    ev('e3', 's3', '2026-10-12', 110), ev('e4', 's4', '2026-10-14', 90), ev('e5', undefined, '2026-10-14', 15),
  ]
  const seasons: Season[] = [{
    id: 'season-1', seasonId: 1, startDate: '2026-07-06', endDate: '2026-09-27', finalPoints: 500,
    finalRank: 'Silver II', updatedAt: T(2026, 9, 28, 9),
  }]
  const rankState: RankState[] = [{
    id: 1, seasonId: 2, seasonStart: '2026-09-28', points: 100 + 100 + 120 + 110 + 90 + 15,
    streakWeeks: 2, lastStreakWeek: '2026-10-12', lastSessionDate: '2026-10-14', idleDecayTaken: 0,
    lastDecayCheckDate: '2026-10-14', updatedAt: T(2026, 10, 14, 8),
  }]
  const templates: WorkoutTemplate[] = [{
    id: 't1', name: 'Push', position: 0, items: [{ exerciseId: 1, targetSets: 3, targetReps: 8 }],
    updatedAt: T(2026, 10, 1, 9),
  }]
  const foodLogs: FoodLog[] = [{ id: 'fl1', date: '2026-10-14', meal: 'lunch', foodId: 'f1', grams: 150, loggedAt: T(2026, 10, 14, 13), updatedAt: T(2026, 10, 14, 13) }]
  const plannedFoods: PlannedFood[] = [{ id: 'p1', date: '2026-10-15', meal: 'lunch', foodId: 'f1', grams: 150, plannedAt: T(2026, 10, 14, 21), updatedAt: T(2026, 10, 14, 21) }]
  const savedMeals: SavedMeal[] = [{ id: 'm1', name: 'Rice bowl', items: [{ foodId: 'f1', grams: 150 }, { foodId: 'f2', grams: 20 }], lastUsedAt: T(2026, 10, 14, 13) }]
  const quests: QuestState[] = [{ weekKey: '2026-10-12', quests: [{ id: 'sessions3', done: true, awardedAt: T(2026, 10, 14, 8) }, { id: 'protein', done: false }] }]
  const coachHistory: CoachJudgement[] = [
    { id: 'c1', kind: 'week', date: '2026-10-05', note, model: 'demo', generatedAt: T(2026, 10, 12, 8) },
    { id: 'c2', kind: 'workout', sessionId: 's3', date: '2026-10-12', title: 'Push', note, model: 'demo', generatedAt: T(2026, 10, 12, 19, 5) },
  ]
  const tables: TableDump = {
    exercises: [
      { id: 1, name: 'Bench Press', nameLower: 'bench press', muscleGroup: 'chest', equipment: 'barbell', defaultRestSec: 120, isCustom: false, updatedAt: 0 },
      { id: 2, name: 'Squat', nameLower: 'squat', muscleGroup: 'legs', equipment: 'barbell', defaultRestSec: 150, isCustom: false, updatedAt: 0 },
    ],
    templates, sessions, sets,
    foods: [
      { id: 'f1', source: 'custom', name: 'Rice', nameLower: 'rice', kcal100: 130, protein100: 2.7, carbs100: 28, fat100: 0.3, userOverridden: false, lastUsedAt: T(2026, 10, 14, 13), useCount: 9 },
      { id: 'f2', source: 'custom', name: 'Olive oil', nameLower: 'olive oil', kcal100: 884, protein100: 0, carbs100: 0, fat100: 100, userOverridden: false, lastUsedAt: 0, useCount: 0 },
    ],
    foodLogs, savedMeals,
    settings: [{ ...DEFAULT_SETTINGS, updatedAt: T(2026, 9, 1, 10) }],
    rankState, scoreEvents, seasons,
    dayTypes: [{ date: '2026-10-11', type: 'rest', updatedAt: T(2026, 10, 11, 9) }],
    bodyLog: [{ date: '2026-10-05', weightKg: 84 }, { date: '2026-10-12', weightKg: 83.5 }],
    waterLogs: [{ id: 'w1', date: '2026-10-14', ml: 500 }],
    achievements: [{ id: 'first-session', unlockedAt: T(2026, 10, 5, 19) }],
    quests,
    tombstones: [
      { id: 'tb1', table: 'bodyLog', rowId: '2026-10-06', deletedAt: T(2026, 10, 7, 9) },
      { id: 'tb2', table: 'sets', rowId: 'set-gone', deletedAt: T(2026, 10, 7, 9) },
    ],
    coachHistory, plannedFoods,
    programs: [{ id: 'pr1', name: 'Push cycle', templateIds: ['t1'], cycleWeeks: 4, cycleStartDate: '2026-10-12', updatedAt: T(2026, 10, 12, 9) }],
  }
  return { app: 'gymtracker', version: 2, exportedAt: T(2026, 10, 14, 20), tables }
}

const DEMO_PATH = resolve(__dirname, '../../public/demo-backup.json')
const hasDemoFile = existsSync(DEMO_PATH)
const demoFile = (): BackupFile => JSON.parse(readFileSync(DEMO_PATH, 'utf8'))

/** Invariants a demo backup must satisfy (run on the inline fixture and on the committed file). */
function expectConsistent(tables: Partial<TableDump>) {
  for (const k of Object.keys(tables)) expect(TABLES as readonly string[]).toContain(k)
  const ids = (rows: unknown[] | undefined) => new Set((rows ?? []).map(r => (r as { id: unknown }).id))
  const sessionIds = ids(tables.sessions)
  const exerciseIds = ids(tables.exercises)
  const foodIds = ids(tables.foods)
  const templateIds = ids(tables.templates)

  for (const s of (tables.sets ?? []) as SetRow[]) {
    expect(sessionIds, `set ${s.id} session`).toContain(s.sessionId)
    expect(exerciseIds, `set ${s.id} exercise`).toContain(s.exerciseId)
  }
  for (const s of (tables.sessions ?? []) as Session[]) {
    if (s.templateId !== undefined) expect(templateIds, `session ${s.id} template`).toContain(s.templateId)
    for (const e of s.extraExerciseIds) expect(exerciseIds, `session ${s.id} extra`).toContain(e)
  }
  for (const tpl of (tables.templates ?? []) as WorkoutTemplate[]) {
    for (const it of tpl.items) expect(exerciseIds, `template ${tpl.id} item`).toContain(it.exerciseId)
  }
  for (const l of [...(tables.foodLogs ?? []), ...(tables.plannedFoods ?? [])] as FoodLog[]) {
    expect(foodIds, `food row ${l.id}`).toContain(l.foodId)
  }
  for (const m of (tables.savedMeals ?? []) as SavedMeal[]) {
    for (const it of m.items) expect(foodIds, `meal ${m.id} item`).toContain(it.foodId)
  }
  for (const e of (tables.scoreEvents ?? []) as ScoreEvent[]) {
    if (e.sessionId !== undefined) expect(sessionIds, `event ${e.id} session`).toContain(e.sessionId)
  }
  for (const c of (tables.coachHistory ?? []) as CoachJudgement[]) {
    if (c.sessionId !== undefined) expect(sessionIds, `verdict ${c.id} session`).toContain(c.sessionId)
  }

  // Rank points: what the sync merge recomputes them to (merge.ts mergeRankState): the carry-over of
  // the previous season plus every score event of this season, minus the decay of the current idle
  // streak. A demo that broke this would see its points jump on the first merge.
  const rank = (tables.rankState ?? []) as RankState[]
  expect(rank).toHaveLength(1)
  const rs = rank[0]
  const prev = ((tables.seasons ?? []) as Season[]).find(s => s.seasonId === rs.seasonId - 1)
  const carry = prev ? Math.round(prev.finalPoints * SEASON_CARRYOVER) : 0
  const seasonSum = ((tables.scoreEvents ?? []) as ScoreEvent[])
    .filter(e => e.date >= rs.seasonStart)
    .reduce((a, e) => a + e.total, 0)
  expect(rs.points).toBe(Math.max(0, Math.round(carry + seasonSum - rs.idleDecayTaken)))

  for (const q of (tables.quests ?? []) as QuestState[]) expect(mondayOf(q.weekKey)).toBe(q.weekKey)
  if (rs.lastStreakWeek) expect(mondayOf(rs.lastStreakWeek)).toBe(rs.lastStreakWeek)
}

/**
 * Independent oracle for the rebase: walks every value of every row and shifts whatever looks like a
 * local day or an epoch-ms timestamp, leaving everything else alone. If `rebaseDemoTables` misses a
 * date field (or shifts something that is not a date), the deep comparison fails on that path.
 */
function shiftEverythingDateLike(value: unknown, days: number): unknown {
  if (typeof value === 'string' && DAY_RE.test(value)) return addDays(value, days)
  if (isMs(value)) return shiftMsLocal(value, days)
  if (Array.isArray(value)) return value.map(v => shiftEverythingDateLike(v, days))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shiftEverythingDateLike(v, days)]))
  }
  return value
}

describe('demoShiftDays', () => {
  it('is a whole number of weeks that lands the export day in the last 7 days', () => {
    const exportedAt = T(2026, 10, 14, 20) // Wed
    expect(demoShiftDays(exportedAt, T(2026, 10, 14, 23))).toBe(0)
    expect(demoShiftDays(exportedAt, T(2026, 10, 20, 9))).toBe(0) // next Tue: Wed would be tomorrow
    expect(demoShiftDays(exportedAt, T(2026, 10, 21, 0, 5))).toBe(7) // next Wed
    expect(demoShiftDays(exportedAt, T(2027, 2, 3, 12))).toBe(16 * 7)
    for (let d = 0; d < 60; d++) {
      const today = localDateStr(new Date(T(2026, 10, 14, 12) + d * 86_400_000))
      const shift = demoShiftDays(exportedAt, parseLocalDate(today).getTime() + 12 * 3_600_000)
      expect(shift % 7).toBe(0)
      const landed = addDays('2026-10-14', shift)
      expect(landed <= today).toBe(true)
      expect(landed > addDays(today, -7)).toBe(true)
    }
  })

  it('is 0 when today is before the export', () => {
    expect(demoShiftDays(T(2026, 10, 14, 20), T(2026, 9, 1, 12))).toBe(0)
  })

  it('maps an export stamped on a Monday onto the current week', () => {
    const exportedAt = T(2026, 10, 12, 9) // Mon
    for (const today of ['2026-11-16', '2026-11-18', '2026-11-22']) {
      const shift = demoShiftDays(exportedAt, parseLocalDate(today).getTime() + 3_600_000)
      expect(addDays('2026-10-12', shift)).toBe(mondayOf(today))
    }
  })
})

describe('rebaseDemoTables', () => {
  it('shifts every date and timestamp of every table, and nothing else', () => {
    const f = fixture()
    const today = T(2027, 1, 22, 10)
    const shift = demoShiftDays(f.exportedAt, today)
    expect(shift).toBe(14 * 7)
    const out = rebaseDemoTables(f.tables, f.exportedAt, today)
    expect(Object.keys(out).sort()).toEqual([...TABLES].sort())
    // Planned meals move by the exact number of days instead (Wed 14 Oct to Fri 22 Jan: 100).
    expect(demoPlanShiftDays(f.exportedAt, today)).toBe(100)
    expect(out).toEqual({
      ...(shiftEverythingDateLike(f.tables, shift) as object),
      plannedFoods: shiftEverythingDateLike(f.tables.plannedFoods, 100),
    })
    // Spot checks on the trickier fields.
    expect((out.quests as QuestState[])[0].quests[0].awardedAt).toBe(T(2027, 1, 20, 8))
    expect((out.tombstones as { rowId: unknown }[])[0].rowId).toBe('2027-01-12')
    expect((out.tombstones as { rowId: unknown }[])[1].rowId).toBe('set-gone')
    expect((out.exercises as { updatedAt: number }[])[0].updatedAt).toBe(0)
    expect((out.foods as { lastUsedAt: number }[])[1].lastUsedAt).toBe(0)
  })

  it('keeps weekdays, order and Monday keys, and the rebased data stays consistent', () => {
    const f = fixture()
    const out = rebaseDemoTables(f.tables, f.exportedAt, T(2026, 12, 3, 10))
    const before = f.tables.sessions as Session[]
    const after = out.sessions as Session[]
    expect(after.map(s => s.id)).toEqual(before.map(s => s.id))
    for (let i = 0; i < before.length; i++) {
      expect(new Date(after[i].startedAt).getDay()).toBe(new Date(before[i].startedAt).getDay())
      expect(new Date(after[i].startedAt).getHours()).toBe(new Date(before[i].startedAt).getHours())
      if (i > 0) expect(after[i].startedAt).toBeGreaterThan(after[i - 1].startedAt)
    }
    for (const [b, a] of (f.tables.foodLogs as FoodLog[]).map((l, i) => [l, (out.foodLogs as FoodLog[])[i]])) {
      expect(parseLocalDate(a.date).getDay()).toBe(parseLocalDate(b.date).getDay())
    }
    expectConsistent(out)
    expect((out.rankState as RankState[])[0].lastStreakWeek).toBe('2026-11-30')
    expect((out.quests as QuestState[])[0].weekKey).toBe('2026-11-30')
    // The last session lands on or before today.
    expect(localDateStr(new Date(after[after.length - 1].startedAt)) <= '2026-12-03').toBe(true)
  })

  it('moves a meal planned for the day after the export to tomorrow, on every weekday', () => {
    const f = fixture() // exported Wed 14 Oct, lunch planned for Thu 15 Oct
    for (let d = 0; d < 21; d++) {
      const today = addDays('2026-10-14', d)
      const out = rebaseDemoTables(f.tables, f.exportedAt, parseLocalDate(today).getTime() + 10 * 3_600_000)
      expect((out.plannedFoods as PlannedFood[])[0].date).toBe(addDays(today, 1))
    }
    expect(demoPlanShiftDays(f.exportedAt, T(2026, 9, 1, 12))).toBe(0)
  })

  it('keeps unset values as they are', () => {
    const f = fixture()
    ;(f.tables.rankState as RankState[])[0].lastStreakWeek = ''
    delete (f.tables.rankState as RankState[])[0].lastSessionDate
    delete (f.tables.sessions as Session[])[3].endedAt
    const out = rebaseDemoTables(f.tables, f.exportedAt, T(2026, 12, 3, 10))
    const rs = (out.rankState as RankState[])[0]
    expect(rs.lastStreakWeek).toBe('')
    expect('lastSessionDate' in rs).toBe(false)
    expect('endedAt' in (out.sessions as Session[])[3]).toBe(false)
  })

  it('keeps the wall-clock time across the March DST change', () => {
    const f = fixture()
    const exportedAt = T(2026, 3, 18, 12) // Wed, before the 29 March switch to CEST
    f.tables.sessions = [{ ...(f.tables.sessions as Session[])[0], startedAt: T(2026, 3, 16, 18), endedAt: T(2026, 3, 16, 19) }]
    f.tables.dayTypes = [{ date: '2026-03-16', type: 'training' }]
    const out = rebaseDemoTables(f.tables, exportedAt, T(2026, 4, 1, 9))
    const s = (out.sessions as Session[])[0]
    expect(s.startedAt).toBe(T(2026, 3, 30, 18))
    expect(s.startedAt - T(2026, 3, 16, 18)).toBe(14 * 86_400_000 - 3_600_000)
    expect(new Date(s.startedAt).getDay()).toBe(1)
    expect((out.dayTypes as { date: string }[])[0].date).toBe('2026-03-30')
  })

  it('keeps the wall-clock time across the October DST change', () => {
    const f = fixture()
    const exportedAt = T(2026, 10, 21, 12) // Wed, before the 25 October switch back to CET
    f.tables.sessions = [{ ...(f.tables.sessions as Session[])[0], startedAt: T(2026, 10, 19, 7, 30) }]
    f.tables.quests = [{ weekKey: '2026-10-19', quests: [] }]
    const out = rebaseDemoTables(f.tables, exportedAt, T(2026, 10, 28, 12))
    const s = (out.sessions as Session[])[0]
    expect(s.startedAt).toBe(T(2026, 10, 26, 7, 30))
    expect(s.startedAt - T(2026, 10, 19, 7, 30)).toBe(7 * 86_400_000 + 3_600_000)
    expect((out.quests as QuestState[])[0].weekKey).toBe('2026-10-26')
  })

  it('re-reads timestamps as wall-clock times of the zone the demo was made in', () => {
    // A demo made in Tokyo: a session at 01:30 on Wed 14 Oct there is 18:30 on Tue 13 Oct here.
    const f = fixture()
    const tokyo = Date.UTC(2026, 9, 13, 16, 30) // 01:30 on 14 Oct in Asia/Tokyo (UTC+9)
    expect(new Date(tokyo).getDate()).toBe(13)
    f.tables.sessions = [{ ...(f.tables.sessions as Session[])[0], startedAt: tokyo }]
    const exportedAt = Date.UTC(2026, 9, 14, 3) // 12:00 on Wed 14 Oct in Tokyo
    const out = rebaseDemoTables(f.tables, exportedAt, T(2026, 10, 28, 12), 'Asia/Tokyo')
    const s = (out.sessions as Session[])[0]
    expect(s.startedAt).toBe(T(2026, 10, 28, 1, 30)) // still 01:30 on a Wednesday, two weeks on
  })

  it('reanchorMs is the identity in the demo zone and for an unknown zone', () => {
    const ms = T(2026, 10, 19, 18, 42) + 123
    expect(DEMO_TZ).toBe('Europe/Rome')
    expect(reanchorMs(ms, DEMO_TZ)).toBe(ms)
    expect(reanchorMs(ms, 'Not/AZone')).toBe(ms)
    expect(reanchorMs(Date.UTC(2026, 9, 19, 23, 59, 59, 7), 'UTC')).toBe(T(2026, 10, 19, 23, 59) + 59_007)
  })

  it('changes nothing when today is before the export, and never mutates its input', () => {
    const f = fixture()
    const copy = structuredClone(f.tables)
    expect(rebaseDemoTables(f.tables, f.exportedAt, T(2026, 9, 1, 12))).toEqual(copy)
    rebaseDemoTables(f.tables, f.exportedAt, T(2027, 6, 1, 12))
    expect(f.tables).toEqual(copy)
  })

  it('drops keys outside TABLES', () => {
    const f = fixture()
    const out = rebaseDemoTables({ ...f.tables, coachNotes: [{ sessionId: 's1' }] } as never, f.exportedAt, T(2026, 11, 1))
    expect(Object.keys(out)).not.toContain('coachNotes')
  })
})

describe('inline demo fixture', () => {
  it('is consistent', () => {
    expectConsistent(fixture().tables)
  })
})

describe.skipIf(!hasDemoFile)('public/demo-backup.json', () => {
  it('is a version 2 GymTracker backup with only synced tables', () => {
    const f = demoFile()
    expect(f.app).toBe('gymtracker')
    expect(f.version).toBe(2)
    expect(typeof f.exportedAt).toBe('number')
    for (const k of Object.keys(f.tables)) expect(TABLES as readonly string[]).toContain(k)
  })

  it('is consistent: foreign keys resolve, rank points match the score events', () => {
    expectConsistent(demoFile().tables)
  })

  it('never starts idle decay, whatever weekday it is loaded on', () => {
    // The whole-week shift lands the export day 0-6 days before today, so the newest session must
    // be within DECAY_GRACE_DAYS - 6 days of the export day.
    const f = demoFile()
    const rs = (f.tables.rankState as RankState[])[0]
    const exportDay = localDateStr(new Date(f.exportedAt))
    expect(rs.lastSessionDate).toBeDefined()
    expect(daysBetween(rs.lastSessionDate!, exportDay) + 6).toBeLessThanOrEqual(DECAY_GRACE_DAYS)
    for (let k = 0; k < 7; k++) {
      const today = parseLocalDate(addDays(exportDay, 7 * 3 + k)).getTime() + 9 * 3_600_000
      const out = rebaseDemoTables(f.tables, f.exportedAt, today)
      const last = (out.rankState as RankState[])[0].lastSessionDate!
      expect(daysBetween(last, localDateStr(new Date(today)))).toBeLessThanOrEqual(DECAY_GRACE_DAYS)
    }
  })

  it('has every date field covered by the rebase', () => {
    const f = demoFile()
    const today = f.exportedAt + 10 * 7 * 86_400_000 + 3 * 3_600_000
    const shift = demoShiftDays(f.exportedAt, today)
    expect(shift).toBe(70)
    const out = rebaseDemoTables(f.tables, f.exportedAt, today)
    expect(out).toEqual(shiftEverythingDateLike(f.tables, shift))
    expectConsistent(out)
  })
})

describe('loadDemoData / clearDemoData', () => {
  const NOW = T(2026, 10, 23, 12) // Fri

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    localStorage.clear()
    useUiStore.getState().setDemoLoaded(false)
    useAppStore.getState().setActiveSessionId(null)
    db.close()
    await Dexie.delete('gymtracker')
    await db.open()
    await ensureSeeded()
  })

  afterEach(() => {
    useSyncStore.getState().disconnect()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  function stubFetch(body: unknown, ok = true) {
    const fetchMock = vi.fn(async () => ({ ok, json: async () => body }) as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('loads the rebased demo without marking the device dirty, then clears back to the seed', async () => {
    const seedOnly = await collectTables()
    const f = fixture()
    const fetchMock = stubFetch(f)
    setSyncDirty(true)
    useAppStore.getState().setActiveSessionId('some-live-session')

    await loadDemoData()

    expect(fetchMock).toHaveBeenCalledWith(DEMO_URL)
    expect(DEMO_URL.endsWith('demo-backup.json')).toBe(true)
    expect(isDemoLoaded()).toBe(true)
    expect(useUiStore.getState().demoLoaded).toBe(true)
    expect(isSyncDirty()).toBe(false)
    expect(useAppStore.getState().activeSessionId).toBeNull()
    const loaded = await collectTables()
    const expected = rebaseDemoTables(f.tables, f.exportedAt, NOW)
    for (const name of TABLES) {
      const byKey = (rows: unknown[]) => [...rows].map(r => JSON.stringify(r)).sort()
      expect(byKey(loaded[name]), name).toEqual(byKey(expected[name] ?? []))
    }
    expect(loaded.sessions.length).toBe(4)
    // Exported Wed 14 Oct, today Fri 23 Oct: one week forward.
    expect((loaded.rankState[0] as RankState).lastSessionDate).toBe('2026-10-21')

    // Device-local leftovers the demo may have produced.
    await db.coachNotes.put({ sessionId: 's1', note, model: 'demo', generatedAt: NOW })
    await db.dietNotes.put({ date: '2026-10-21', note, model: 'demo', generatedAt: NOW })
    await db.workoutSuggestions.put({ sessionId: 's1', plan: [], model: 'demo', generatedAt: NOW })
    await db.dietSuggestions.put({ date: '2026-10-21', basis: 'x', suggestion: { headline: 'h', items: [] }, model: 'demo', generatedAt: NOW })
    localStorage.setItem('gymtracker-week-review-auto', '2026-10-19')
    setSyncDirty(true)

    await clearDemoData()

    expect(isDemoLoaded()).toBe(false)
    expect(isSyncDirty()).toBe(false)
    expect(await collectTables()).toEqual(seedOnly)
    expect(await db.coachNotes.count()).toBe(0)
    expect(await db.dietNotes.count()).toBe(0)
    expect(await db.workoutSuggestions.count()).toBe(0)
    expect(await db.dietSuggestions.count()).toBe(0)
    expect(localStorage.getItem('gymtracker-week-review-auto')).toBeNull()
  })

  it('clears the late tables too (an explicit [] for every table)', async () => {
    stubFetch(fixture())
    await loadDemoData()
    expect(await db.coachHistory.count()).toBeGreaterThan(0)
    expect(await db.plannedFoods.count()).toBeGreaterThan(0)
    await clearDemoData()
    expect(await db.coachHistory.count()).toBe(0)
    expect(await db.plannedFoods.count()).toBe(0)
  })

  it('rejects a file that is not a version 2 GymTracker backup and leaves the data alone', async () => {
    const before = await collectTables()
    stubFetch({ ...fixture(), app: 'other' })
    await expect(loadDemoData()).rejects.toThrow()
    stubFetch({ ...fixture(), version: 1 })
    await expect(loadDemoData()).rejects.toThrow()
    stubFetch(fixture(), false)
    await expect(loadDemoData()).rejects.toThrow()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline') }))
    await expect(loadDemoData()).rejects.toThrow()
    expect(isDemoLoaded()).toBe(false)
    expect(await collectTables()).toEqual(before)
  })

  it('refuses while connected to a sync repo, before fetching, and leaves the data alone', async () => {
    const before = await collectTables()
    const fetchMock = stubFetch(fixture())
    useSyncStore.setState({ token: 'github_pat_test_token_000000', owner: 'someone', repo: 'gymtracker-data' })
    await expect(loadDemoData()).rejects.toThrow(t('data.demo.connected'))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(isDemoLoaded()).toBe(false)
    expect(await collectTables()).toEqual(before)
  })

  it('refuses when the device holds real data, and leaves it alone', async () => {
    await db.bodyLog.put({ date: '2026-10-20', weightKg: 81 })
    const before = await collectTables()
    stubFetch(fixture())
    await expect(loadDemoData()).rejects.toThrow(t('data.demo.notEmpty'))
    expect(isDemoLoaded()).toBe(false)
    expect(await collectTables()).toEqual(before)
  })

  it('forgets the last synced sha on clear, so a connected device pulls instead of pushing', async () => {
    stubFetch(fixture())
    await loadDemoData()
    useSyncStore.setState({ lastSyncedSha: 'abc123' })
    await clearDemoData()
    expect(useSyncStore.getState().lastSyncedSha).toBeNull()
    expect(isSyncDirty()).toBe(false)
  })

  it('a real backup restore over the demo turns the flag off and marks the device dirty', async () => {
    stubFetch(fixture())
    await loadDemoData()
    await db.coachNotes.put({ sessionId: 's1', note, model: 'demo', generatedAt: NOW })
    localStorage.setItem('gymtracker-week-review-auto', '2026-10-19')
    const real = fixture()
    real.tables.sessions = (real.tables.sessions as Session[]).map(s => ({ ...s, id: `real-${s.id}` }))
    real.tables.sets = (real.tables.sets as SetRow[]).map(s => ({ ...s, sessionId: `real-${s.sessionId}` }))
    await importBackup(JSON.stringify(real))
    expect(isDemoLoaded()).toBe(false)
    expect(isSyncDirty()).toBe(true)
    expect((await db.sessions.toArray()).map(s => s.id).sort()).toEqual(['real-s1', 'real-s2', 'real-s3', 'real-s4'])
    expect(await db.coachNotes.count()).toBe(0)
    expect(localStorage.getItem('gymtracker-week-review-auto')).toBeNull()
  })

  it('an older backup without the late tables still removes the demo rows from them', async () => {
    stubFetch(fixture())
    await loadDemoData()
    expect(await db.coachHistory.count()).toBeGreaterThan(0)
    expect(await db.plannedFoods.count()).toBeGreaterThan(0)
    const old = fixture()
    delete old.tables.coachHistory
    delete old.tables.plannedFoods
    await importBackup(JSON.stringify({ ...old, version: 1 }))
    expect(isDemoLoaded()).toBe(false)
    expect(await db.coachHistory.count()).toBe(0)
    expect(await db.plannedFoods.count()).toBe(0)
    expect(await db.sessions.count()).toBe(4)
  })

  it('an older backup without the late tables keeps local rows when no demo is loaded', async () => {
    await db.plannedFoods.put({ id: 'mine', date: '2026-10-24', meal: 'lunch', foodId: 'f1', grams: 100, plannedAt: NOW })
    const old = fixture()
    delete old.tables.coachHistory
    delete old.tables.plannedFoods
    await importBackup(JSON.stringify(old))
    expect((await db.plannedFoods.toArray()).map(p => p.id)).toEqual(['mine'])
  })

  it.runIf(hasDemoFile)('loads and clears the committed demo file', async () => {
    const seedOnly = await collectTables()
    const f = demoFile()
    stubFetch(f)
    await loadDemoData()
    const loaded = await collectTables()
    expect(loaded.sessions.length).toBe((f.tables.sessions ?? []).length)
    expectConsistent(loaded)
    const last = Math.max(...(loaded.sessions as Session[]).map(s => s.startedAt))
    expect(last).toBeLessThanOrEqual(NOW + 86_400_000)
    await clearDemoData()
    expect(await collectTables()).toEqual(seedOnly)
  })
})

describe('canOfferDemo / hasUserData', () => {
  beforeEach(async () => {
    db.close()
    await Dexie.delete('gymtracker')
    await db.open()
    await ensureSeeded()
  })

  const base = { isNative: false, demoLoaded: false, connected: false, hasUserData: false }

  it('offers the demo only on an empty, unconnected web device', () => {
    expect(canOfferDemo(base)).toBe(true)
    expect(canOfferDemo({ ...base, isNative: true })).toBe(false)
    expect(canOfferDemo({ ...base, demoLoaded: true })).toBe(false)
    expect(canOfferDemo({ ...base, connected: true })).toBe(false)
    expect(canOfferDemo({ ...base, hasUserData: true })).toBe(false)
  })

  it('a freshly seeded device has no user data', async () => {
    expect(await hasUserData()).toBe(false)
  })

  it('only bodyLog rows count as user data', async () => {
    await db.bodyLog.put({ date: '2026-10-20', weightKg: 81 })
    expect(await hasUserData()).toBe(true)
  })

  it.each([
    ['waterLogs', () => db.waterLogs.put({ id: 'w', date: '2026-10-20', ml: 250 })],
    ['foods', () => db.foods.put({ id: 'f', source: 'custom', name: 'Rice', nameLower: 'rice', kcal100: 130, protein100: 3, carbs100: 28, fat100: 0, userOverridden: false, lastUsedAt: 0, useCount: 0 })],
    ['savedMeals', () => db.savedMeals.put({ id: 'm', name: 'Bowl', items: [], lastUsedAt: 0 })],
    ['plannedFoods', () => db.plannedFoods.put({ id: 'p', date: '2026-10-24', meal: 'lunch', foodId: 'f', grams: 100, plannedAt: 1 })],
    ['dayTypes', () => db.dayTypes.put({ date: '2026-10-20', type: 'rest' })],
    ['a lone program row', () => db.programs.put({ id: 'pr', name: 'Starting Strength', templateIds: [], cycleStartDate: '2026-10-19' })],
    ['a custom exercise', () => db.exercises.add({ name: 'My lift', nameLower: 'my lift', muscleGroup: 'back', defaultRestSec: 90, isCustom: true })],
    ['an edited catalog exercise', () => db.exercises.update(1, { notes: 'elbows in' })],
    ['edited settings', () => db.settings.update(1, { bodyweightKg: 81 })],
  ])('%s counts as user data', async (_label, write) => {
    await write()
    expect(await hasUserData()).toBe(true)
  })
})
