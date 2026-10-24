import { describe, it, expect } from 'vitest'
import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { beforeEach } from 'vitest'
import { computeRepMaxes, gatherRepMaxes } from './repMax'
import { db } from '../db/db'

const set = (weightKg: number, reps: number, completedAt: number, isWarmup = false) =>
  ({ weightKg, reps, completedAt, isWarmup })

describe('computeRepMaxes', () => {
  it('fills every bucket up to the set’s reps with the heaviest qualifying set', () => {
    const { allTime } = computeRepMaxes([set(100, 6, 1), set(110, 2, 2), set(80, 12, 3)], 0)
    expect(allTime.get(1)).toEqual({ weightKg: 110, loadKg: 110, reps: 2, completedAt: 2, bodyweightLoad: false })
    expect(allTime.get(3)).toEqual({ weightKg: 100, loadKg: 100, reps: 6, completedAt: 1, bodyweightLoad: false })
    expect(allTime.get(5)).toEqual({ weightKg: 100, loadKg: 100, reps: 6, completedAt: 1, bodyweightLoad: false })
    expect(allTime.get(8)).toEqual({ weightKg: 80, loadKg: 80, reps: 12, completedAt: 3, bodyweightLoad: false })
    expect(allTime.get(12)).toEqual({ weightKg: 80, loadKg: 80, reps: 12, completedAt: 3, bodyweightLoad: false })
  })

  it('is monotonic: a lower bucket is never lighter than a higher one', () => {
    const { allTime } = computeRepMaxes([set(60, 15, 1), set(90, 4, 2), set(70, 10, 3)], 0)
    const weights = [1, 3, 5, 8, 10, 12].map(n => allTime.get(n)?.weightKg ?? 0)
    expect(weights).toEqual([90, 90, 70, 70, 70, 60])
  })

  it('breaks ties by more reps, then the earliest set', () => {
    const { allTime } = computeRepMaxes([set(100, 5, 9), set(100, 6, 5), set(100, 6, 2)], 0)
    expect(allTime.get(5)).toEqual({ weightKg: 100, loadKg: 100, reps: 6, completedAt: 2, bodyweightLoad: false })
  })

  it('omits buckets nobody reached and ignores warm-ups and unweighted rows', () => {
    const { allTime } = computeRepMaxes([set(140, 3, 1, true), set(100, 3, 2), set(0, 20, 3)], 0)
    expect([...allTime.keys()]).toEqual([1, 3])
    expect(allTime.get(1)?.weightKg).toBe(100)
  })

  it('scopes the season map to sets from the season start on', () => {
    const { allTime, season } = computeRepMaxes([set(120, 1, 10), set(105, 3, 50), set(100, 1, 60)], 50)
    expect(allTime.get(1)?.weightKg).toBe(120)
    expect(season.get(1)).toEqual({ weightKg: 105, loadKg: 105, reps: 3, completedAt: 50, bodyweightLoad: false })
    expect(season.get(3)?.weightKg).toBe(105)
    expect(season.has(5)).toBe(false)
  })

  it('returns empty maps without sets', () => {
    const { allTime, season } = computeRepMaxes([], 0)
    expect(allTime.size + season.size).toBe(0)
  })
})

describe('computeRepMaxes with bodyweight load', () => {
  const bw = (weightKg: number, loadKg: number, reps: number, completedAt: number) =>
    ({ weightKg, loadKg, reps, completedAt, isWarmup: false, bodyweightLoad: true })

  it('ranks by load, keeps the logged added kg and skips loads ≤ 0', () => {
    const { allTime } = computeRepMaxes([bw(0, 80, 10, 1), bw(10, 90, 5, 2), bw(-20, 60, 12, 3), bw(-90, 0, 15, 4)], 0)
    expect(allTime.get(5)).toEqual({ weightKg: 10, loadKg: 90, reps: 5, completedAt: 2, bodyweightLoad: true })
    expect(allTime.get(10)).toEqual({ weightKg: 0, loadKg: 80, reps: 10, completedAt: 1, bodyweightLoad: true })
    expect(allTime.get(12)?.weightKg).toBe(-20)
    expect(allTime.size).toBe(6)
  })

  it('a heavier load beats a lighter one with more added kg on a lighter day', () => {
    // 85 kg bodyweight + 0 beats 75 kg bodyweight + 5 kg.
    const { allTime } = computeRepMaxes([bw(5, 80, 5, 1), bw(0, 85, 5, 2)], 0)
    expect(allTime.get(5)?.completedAt).toBe(2)
  })
})

describe('gatherRepMaxes', () => {
  beforeEach(async () => {
    db.close()
    await Dexie.delete('gymtracker')
    await db.open()
  })

  it('joins each set to its session: stamped bodyweight sets count, old 0-kg ones do not', async () => {
    await db.exercises.put({ id: 7, name: 'Pull-Up', nameLower: 'pull-up', muscleGroup: 'back', equipment: 'bodyweight', defaultRestSec: 90, isCustom: false })
    await db.sessions.bulkPut([
      { id: 'old', name: 'Old', startedAt: 1, bodyweightKg: 80, extraExerciseIds: [] },
      { id: 'new', name: 'New', startedAt: 2, bodyweightKg: 80, extraExerciseIds: [], bwScoring: true },
    ])
    await db.sets.bulkPut([
      { id: 'a', sessionId: 'old', exerciseId: 7, setNumber: 1, weightKg: 0, reps: 12, isWarmup: false, completedAt: 1, e1rm: 0 },
      { id: 'b', sessionId: 'new', exerciseId: 7, setNumber: 1, weightKg: 0, reps: 8, isWarmup: false, completedAt: 2, e1rm: 0 },
    ])
    const { allTime } = await gatherRepMaxes(7)
    expect(allTime.get(8)).toEqual({ weightKg: 0, loadKg: 80, reps: 8, completedAt: 2, bodyweightLoad: true })
    expect(allTime.has(10)).toBe(false)
  })
})
