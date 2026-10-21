import { describe, it, expect } from 'vitest'
import { computeRepMaxes } from './repMax'

const set = (weightKg: number, reps: number, completedAt: number, isWarmup = false) =>
  ({ weightKg, reps, completedAt, isWarmup })

describe('computeRepMaxes', () => {
  it('fills every bucket up to the set’s reps with the heaviest qualifying set', () => {
    const { allTime } = computeRepMaxes([set(100, 6, 1), set(110, 2, 2), set(80, 12, 3)], 0)
    expect(allTime.get(1)).toEqual({ weightKg: 110, reps: 2, completedAt: 2 })
    expect(allTime.get(3)).toEqual({ weightKg: 100, reps: 6, completedAt: 1 })
    expect(allTime.get(5)).toEqual({ weightKg: 100, reps: 6, completedAt: 1 })
    expect(allTime.get(8)).toEqual({ weightKg: 80, reps: 12, completedAt: 3 })
    expect(allTime.get(12)).toEqual({ weightKg: 80, reps: 12, completedAt: 3 })
  })

  it('is monotonic: a lower bucket is never lighter than a higher one', () => {
    const { allTime } = computeRepMaxes([set(60, 15, 1), set(90, 4, 2), set(70, 10, 3)], 0)
    const weights = [1, 3, 5, 8, 10, 12].map(n => allTime.get(n)?.weightKg ?? 0)
    expect(weights).toEqual([90, 90, 70, 70, 70, 60])
  })

  it('breaks ties by more reps, then the earliest set', () => {
    const { allTime } = computeRepMaxes([set(100, 5, 9), set(100, 6, 5), set(100, 6, 2)], 0)
    expect(allTime.get(5)).toEqual({ weightKg: 100, reps: 6, completedAt: 2 })
  })

  it('omits buckets nobody reached and ignores warm-ups and unweighted rows', () => {
    const { allTime } = computeRepMaxes([set(140, 3, 1, true), set(100, 3, 2), set(0, 20, 3)], 0)
    expect([...allTime.keys()]).toEqual([1, 3])
    expect(allTime.get(1)?.weightKg).toBe(100)
  })

  it('scopes the season map to sets from the season start on', () => {
    const { allTime, season } = computeRepMaxes([set(120, 1, 10), set(105, 3, 50), set(100, 1, 60)], 50)
    expect(allTime.get(1)?.weightKg).toBe(120)
    expect(season.get(1)).toEqual({ weightKg: 105, reps: 3, completedAt: 50 })
    expect(season.get(3)?.weightKg).toBe(105)
    expect(season.has(5)).toBe(false)
  })

  it('returns empty maps without sets', () => {
    const { allTime, season } = computeRepMaxes([], 0)
    expect(allTime.size + season.size).toBe(0)
  })
})
