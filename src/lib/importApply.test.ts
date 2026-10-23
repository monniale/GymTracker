import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '../db/db'
import { ensureSeeded } from '../db/seed'
import { parseHistoryCsv } from './importHistory'
import { previewImport, applyImport } from './importApply'
import { rescoreSession } from './finishSession'
import { useUiStore } from './uiStore'
import { collectTables } from '../db/backup'
import { t } from '../i18n'

const T = (y: number, m: number, d: number, h = 0) => new Date(y, m - 1, d, h).getTime()

function memoryStorage(): Storage {
  const m = new Map<string, string>()
  return {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: k => m.get(k) ?? null,
    key: i => [...m.keys()][i] ?? null,
    removeItem: k => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  }
}

const CSV = [
  'Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE',
  // Before the season (starts 2026-10-01): history only, no points.
  '2026-09-20 18:00:00,Push,1h,Bench Press (Barbell),W,40,10,0,0,,,',
  '2026-09-20 18:00:00,Push,1h,Bench Press (Barbell),1,100,5,0,0,,,',
  '2026-09-20 18:00:00,Push,1h,Cable Fly Crossovers,1,15,12,0,0,,,',
  // In season.
  '2026-10-05 18:00:00,Push,1h,Bench Press (Barbell),1,105,5,0,0,,,',
  '2026-10-05 18:00:00,Push,1h,Farmer Carry,1,40,1,0,0,,,',
  '2026-10-07 07:00:00,Run,30m,Running (Treadmill),1,0,0,5,1500,,,',
].join('\n')

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T(2026, 10, 15, 12))
  vi.stubGlobal('localStorage', memoryStorage())
  db.close()
  await Dexie.delete('gymtracker')
  await db.open()
  await ensureSeeded()
  await db.rankState.update(1, { seasonStart: '2026-10-01', points: 500, streakWeeks: 2, lastStreakWeek: '2026-10-05' })
  await db.bodyLog.put({ date: '2026-09-01', weightKg: 82 })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('importing a Strong history', () => {
  it('previews workouts, matches and new exercises', async () => {
    const p = await previewImport(parseHistoryCsv(CSV))
    expect(p).toMatchObject({ format: 'strong', workouts: 3, duplicates: 0, firstDate: '2026-09-20', lastDate: '2026-10-07', sets: 6, cardioSets: 1 })
    expect(p.matched.map(m => m.name).sort()).toEqual(['Bench Press', 'Cable Crossover', 'Treadmill Run'])
    expect(p.toCreate).toEqual([{ raw: 'Farmer Carry', muscleGroup: 'other' }])
  })

  it('writes sessions, sets and score events; adds only in-season points; leaves the streak alone', async () => {
    const res = await applyImport(parseHistoryCsv(CSV))
    expect(res).toMatchObject({ workouts: 3, duplicates: 0, sets: 6, exercisesCreated: 1 })

    const sessions = await db.sessions.orderBy('startedAt').toArray()
    expect(sessions.map(s => [s.name, s.importedFrom, typeof s.id])).toEqual([
      ['Push', 'strong', 'string'], ['Push', 'strong', 'string'], ['Run', 'strong', 'string'],
    ])
    expect(sessions[0].bodyweightKg).toBe(82)
    const events = await db.scoreEvents.toArray()
    expect(events).toHaveLength(3)
    const inSeason = events.filter(e => e.date >= '2026-10-01').reduce((a, e) => a + e.total, 0)
    expect(res.pointsAdded).toBe(inSeason)
    const rank = await db.rankState.get(1)
    expect(rank).toMatchObject({ points: 500 + inSeason, streakWeeks: 2, lastStreakWeek: '2026-10-05' })
    // The 105×5 in October is an in-season first: no PR against September's history.
    const oct5 = events.find(e => e.date === '2026-10-05')!
    expect(oct5.breakdown.find(b => b.exerciseName === 'Bench Press')?.e1rmPr).toBe(false)

    const sets = await db.sets.toArray()
    expect(sets).toHaveLength(6)
    expect(sets.every(s => typeof s.id === 'string' && sessions.some(x => x.id === s.sessionId))).toBe(true)
    expect(sets.find(s => s.durationSec)).toMatchObject({ durationSec: 1500, distanceM: 5000, weightKg: 0, reps: 0 })
    const custom = await db.exercises.where('nameLower').equals('farmer carry').first()
    expect(custom).toMatchObject({ isCustom: true, muscleGroup: 'other' })
  })

  it('editing an imported workout from before the season never moves the rank', async () => {
    await applyImport(parseHistoryCsv(CSV))
    const points = (await db.rankState.get(1))!.points
    const old = await db.sessions.where('startedAt').below(T(2026, 10, 1)).first()
    const set = await db.sets.where('sessionId').equals(old!.id!).filter(s => s.reps === 5).first()
    await db.sets.update(set!.id!, { reps: 1, e1rm: 100 })
    await rescoreSession(old!.id!)
    expect((await db.rankState.get(1))!.points).toBe(points)
  })

  it('skips workouts already imported and reuses the custom exercises', async () => {
    await applyImport(parseHistoryCsv(CSV))
    const before = { sessions: await db.sessions.count(), exercises: await db.exercises.count(), points: (await db.rankState.get(1))!.points }
    const again = await applyImport(parseHistoryCsv(CSV))
    expect(again).toMatchObject({ workouts: 0, duplicates: 3, exercisesCreated: 0, pointsAdded: 0 })
    expect(await db.sessions.count()).toBe(before.sessions)
    expect(await db.exercises.count()).toBe(before.exercises)
    expect((await db.rankState.get(1))!.points).toBe(before.points)
    expect((await previewImport(parseHistoryCsv(CSV))).duplicates).toBe(3)
  })
})

describe('importing bodyweight sets', () => {
  const PULL = [
    'Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE',
    '2026-10-05 18:00:00,Pull,1h,Pull Up,1,0,10,0,0,,,',
    '2026-10-05 18:00:00,Pull,1h,Pull Up,2,10,8,0,0,,,',
    '2026-10-05 18:00:00,Pull,1h,Pull Up,3,-5,8,0,0,,,',
  ].join('\n')

  it('stamps the sessions and stores e1RM at bodyweight load (added kg never negative)', async () => {
    await applyImport(parseHistoryCsv(PULL))
    const [s] = await db.sessions.toArray()
    expect(s).toMatchObject({ bwScoring: true, bodyweightKg: 82 })
    const sets = await db.sets.where('sessionId').equals(s.id!).sortBy('setNumber')
    expect(sets.map(x => x.weightKg)).toEqual([0, 10, 0])
    // Pull-Up factor 1.0 at 82 kg.
    expect(sets.map(x => Math.round(x.e1rm * 10) / 10)).toEqual([109.3, 116.5, 103.9])
  })

  it('a rescore of the stamped import reproduces its points', async () => {
    await applyImport(parseHistoryCsv(PULL))
    const [s] = await db.sessions.toArray()
    const before = (await db.scoreEvents.where('sessionId').equals(s.id!).first())!.total
    expect(before).toBeGreaterThan(0)
    await rescoreSession(s.id!)
    expect((await db.scoreEvents.where('sessionId').equals(s.id!).first())!.total).toBe(before)
  })

  it('reads an unstamped 0-kg bodyweight session as no prior best', async () => {
    const pullUp = (await db.exercises.where('nameLower').equals('pull-up').first())!
    const old = await db.sessions.add({ id: 'old', name: 'Old', startedAt: T(2026, 10, 2, 18), endedAt: T(2026, 10, 2, 19), bodyweightKg: 82, extraExerciseIds: [] })
    await db.sets.add({ id: 'o1', sessionId: old, exerciseId: pullUp.id!, setNumber: 1, weightKg: 0, reps: 15, isWarmup: false, completedAt: T(2026, 10, 2, 18) + 600_000, e1rm: 0 })
    await applyImport(parseHistoryCsv(PULL))
    const ev = (await db.scoreEvents.where('date').equals('2026-10-05').first())!
    expect(ev.breakdown[0]).toMatchObject({ exerciseName: 'Pull-Up', e1rmPr: false, volumePr: false })
  })

  it('never compares with an unstamped weighted pull-up, and a rescore reproduces the import', async () => {
    const pullUp = (await db.exercises.where('nameLower').equals('pull-up').first())!
    const old = await db.sessions.add({ id: 'old', name: 'Old', startedAt: T(2026, 10, 2, 18), endedAt: T(2026, 10, 2, 19), bodyweightKg: 82, extraExerciseIds: [] })
    // Added kg only (pre-feature build): e1RM 12.7, another unit than the import's bodyweight load.
    await db.sets.add({ id: 'o1', sessionId: old, exerciseId: pullUp.id!, setNumber: 1, weightKg: 10, reps: 8, isWarmup: false, completedAt: T(2026, 10, 2, 18) + 600_000, e1rm: 12.7 })
    await applyImport(parseHistoryCsv(PULL))
    const s = (await db.sessions.where('startedAt').equals(T(2026, 10, 5, 18)).first())!
    const ev = (await db.scoreEvents.where('sessionId').equals(s.id!).first())!
    expect(ev.breakdown[0]).toMatchObject({ exerciseName: 'Pull-Up', e1rmPr: false, volumePr: false })
    expect(ev.prBonus).toBe(0)
    await rescoreSession(s.id!)
    expect((await db.scoreEvents.where('sessionId').equals(s.id!).first())!.total).toBe(ev.total)
  })
})

describe('importing while the demo is loaded', () => {
  afterEach(() => useUiStore.getState().setDemoLoaded(false))

  it('is refused and writes nothing: clearing the demo would delete the import with it', async () => {
    useUiStore.getState().setDemoLoaded(true)
    const before = await collectTables()
    await expect(applyImport(parseHistoryCsv(CSV))).rejects.toThrow(t('settings.importHistory.demoLoaded'))
    expect(await collectTables()).toEqual(before)
  })
})
