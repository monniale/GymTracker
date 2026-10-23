import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { db } from '../db/db'
import { epley } from './scoring'
import { exerciseStats, gatherExerciseHistory, groupBySession, heldRepMaxes, type HistorySet } from './exerciseHistory'
import type { Session, SetRow } from '../types'

const session = (id: string, startedAt: number, extra: Partial<Session> = {}): Session =>
  ({ id, name: id, startedAt, endedAt: startedAt + 3600_000, bodyweightKg: 80, extraExerciseIds: [], ...extra })

const row = (id: string, sessionId: string, setNumber: number, weightKg: number, reps: number, completedAt: number, extra: Partial<SetRow> = {}): SetRow =>
  ({ id, sessionId, exerciseId: 1, setNumber, weightKg, reps, isWarmup: false, completedAt, e1rm: epley(weightKg, reps), ...extra })

const loaded = (s: SetRow, loadKg = s.weightKg): HistorySet => ({ ...s, loadKg })

describe('groupBySession', () => {
  it('orders workouts newest first and sets by set number', () => {
    const byId = new Map([['a', session('a', 1000)], ['b', session('b', 5000)]])
    const groups = groupBySession([
      row('1', 'a', 2, 100, 5, 1200),
      row('2', 'b', 1, 105, 5, 5100),
      row('3', 'a', 1, 100, 5, 1100),
      row('4', 'b', 2, 105, 4, 5200),
    ], byId)
    expect(groups.map(g => g.session.id)).toEqual(['b', 'a'])
    expect(groups[1].sets.map(s => s.id)).toEqual(['3', '1'])
    expect(groups[0].sets.map(s => s.id)).toEqual(['2', '4'])
  })

  it('leaves out unfinished and missing sessions', () => {
    const byId = new Map([['done', session('done', 1000)], ['live', session('live', 9000, { endedAt: undefined })]])
    const groups = groupBySession([
      row('1', 'done', 1, 60, 10, 1100),
      row('2', 'live', 1, 70, 10, 9100),
      row('3', 'gone', 1, 80, 10, 500),
    ], byId)
    expect(groups.map(g => g.session.id)).toEqual(['done'])
  })
})

describe('exerciseStats', () => {
  it('finds the best e1RM and the heaviest set and counts working sets only', () => {
    const stats = exerciseStats([
      loaded(row('w', 'a', 1, 140, 2, 10, { isWarmup: true })),
      loaded(row('1', 'a', 2, 100, 8, 20)),
      loaded(row('2', 'a', 3, 110, 3, 30)),
      loaded(row('3', 'b', 1, 90, 12, 40, { setType: 'drop' })),
    ])
    expect(stats.workingSets).toBe(3)
    expect(stats.sessionCount).toBe(2)
    expect(stats.lastDone).toBe(40)
    expect(stats.bestE1rm?.set.id).toBe('1') // 100 × 8 ≈ 126.7 beats 110 × 3 = 121
    expect(stats.bestE1rm?.e1rm).toBeCloseTo(epley(100, 8))
    expect(stats.heaviest?.set.id).toBe('2') // the 140 kg warm-up never counts
    expect(stats.cardio).toBeUndefined()
  })

  it('heaviest: more reps break a tie on load', () => {
    const five = loaded(row('5', 'a', 1, 100, 5, 10))
    const eight = loaded(row('8', 'b', 1, 100, 8, 20))
    expect(exerciseStats([five, eight]).heaviest?.set.id).toBe('8')
    expect(exerciseStats([eight, five]).heaviest?.set.id).toBe('8')
  })

  it('the earlier of two identical sets holds both records, whatever the order', () => {
    const first = loaded(row('first', 'a', 1, 100, 5, 10))
    const again = loaded(row('again', 'b', 1, 100, 5, 20))
    for (const sets of [[first, again], [again, first]]) {
      const stats = exerciseStats(sets)
      expect(stats.bestE1rm?.set.id).toBe('first')
      expect(stats.heaviest?.set.id).toBe('first')
    }
  })

  it('ranks bodyweight sets by effective load and skips rows without load', () => {
    const stats = exerciseStats([
      loaded(row('old', 'a', 1, 0, 15, 10), 0), // unstamped 0-kg row
      loaded(row('bw', 'b', 1, 0, 10, 20), 80),
      loaded(row('plus', 'b', 2, 10, 5, 30), 90),
      loaded(row('assist', 'b', 3, -20, 8, 40), 60),
    ])
    expect(stats.workingSets).toBe(4)
    expect(stats.heaviest?.set.id).toBe('plus')
    expect(stats.heaviest?.set.loadKg).toBe(90)
    expect(stats.bestE1rm?.set.id).toBe('bw') // 80 × 10 ≈ 106.7 beats 90 × 5 = 105
  })

  it('sums time and distance for cardio and has no e1RM', () => {
    const cardio = (id: string, sec: number, m: number | undefined, at: number, isWarmup = false) =>
      loaded({ ...row(id, 'c', at, 0, 0, at, { isWarmup }), e1rm: 0, durationSec: sec, distanceM: m })
    const stats = exerciseStats([cardio('1', 600, 2000, 1), cardio('2', 900, undefined, 2), cardio('w', 300, 500, 3, true)])
    expect(stats.cardio).toEqual({ totalSec: 1500, totalM: 2000 })
    expect(stats.workingSets).toBe(2)
    expect(stats.bestE1rm).toBeUndefined()
    expect(stats.heaviest).toBeUndefined()
  })

  it('is empty without sets', () => {
    expect(exerciseStats([])).toEqual({ workingSets: 0, sessionCount: 0, bestE1rm: undefined, heaviest: undefined, lastDone: undefined, cardio: undefined })
  })
})

describe('heldRepMaxes', () => {
  const rec = (loadKg: number, reps: number, completedAt: number) => ({ weightKg: loadKg, loadKg, reps, completedAt, bodyweightLoad: false })
  it('lists the buckets whose record is this set', () => {
    const allTime = new Map([[1, rec(120, 3, 5)], [3, rec(120, 3, 5)], [5, rec(100, 6, 9)]])
    expect(heldRepMaxes({ completedAt: 5, loadKg: 120, reps: 3, isWarmup: false }, allTime)).toEqual([1, 3])
    expect(heldRepMaxes({ completedAt: 7, loadKg: 120, reps: 3, isWarmup: false }, allTime)).toEqual([])
    expect(heldRepMaxes({ completedAt: 5, loadKg: 120, reps: 3, isWarmup: true }, allTime)).toEqual([])
  })
})

describe('gatherExerciseHistory', () => {
  beforeEach(async () => {
    db.close()
    await Dexie.delete('gymtracker')
    await db.open()
  })

  it('returns null for an unknown exercise', async () => {
    expect(await gatherExerciseHistory(404)).toBeNull()
  })

  it('joins sets to finished sessions with effective loads and rep-max records', async () => {
    await db.exercises.bulkPut([
      { id: 7, name: 'Pull-Up', nameLower: 'pull-up', muscleGroup: 'back', equipment: 'bodyweight', defaultRestSec: 90, isCustom: false },
      { id: 8, name: 'Row', nameLower: 'row', muscleGroup: 'back', equipment: 'barbell', defaultRestSec: 90, isCustom: false },
    ])
    await db.sessions.bulkPut([
      session('old', 1000),
      session('new', 5000, { bwScoring: true }),
      session('live', 9000, { endedAt: undefined, bwScoring: true }),
    ])
    await db.sets.bulkPut([
      { ...row('a', 'old', 1, 0, 12, 1100), exerciseId: 7, e1rm: 0 },
      { ...row('b', 'new', 1, 10, 6, 5100), exerciseId: 7 },
      { ...row('c', 'new', 2, 0, 8, 5200, { isWarmup: true }), exerciseId: 7 },
      { ...row('d', 'live', 1, 20, 1, 9100), exerciseId: 7 },
      { ...row('e', 'new', 1, 60, 10, 5300), exerciseId: 8 },
    ])
    const h = (await gatherExerciseHistory(7))!
    expect(h.exercise.name).toBe('Pull-Up')
    expect(h.sessions.map(g => g.session.id)).toEqual(['new', 'old'])
    expect(h.sessions[0].sets.map(s => [s.id, s.loadKg])).toEqual([['b', 90], ['c', 80]])
    expect(h.sessions[1].sets.map(s => [s.id, s.loadKg])).toEqual([['a', 0]])
    expect(h.stats.workingSets).toBe(2)
    expect(h.stats.sessionCount).toBe(2)
    expect(h.stats.heaviest?.set.id).toBe('b')
    expect(h.stats.lastDone).toBe(5200)
    // The live workout's single (100 kg) is not listed, so it holds no star: the listed 90 kg × 6
    // set keeps the 1RM, 3RM and 5RM, matching the stats.
    expect(heldRepMaxes(h.sessions[0].sets[0], h.repMaxes.allTime)).toEqual([1, 3, 5])
    expect(h.repMaxes.allTime.get(1)).toMatchObject({ loadKg: 90, weightKg: 10, bodyweightLoad: true })
  })
})
