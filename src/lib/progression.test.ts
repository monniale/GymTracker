import { describe, it, expect } from 'vitest'
import { suggestNext } from './progression'
import { platesPerSide, warmupRamp, formatPlates } from './plates'

describe('suggestNext (double progression)', () => {
  it('suggests +2.5kg when all top-weight sets hit target reps', () => {
    const s = suggestNext([
      { weightKg: 80, reps: 8 }, { weightKg: 80, reps: 8 }, { weightKg: 80, reps: 8 },
    ], 8)
    expect(s).toEqual({ weightKg: 82.5, reps: 8, reason: 'weight-up' })
  })

  it('respects a custom progression step', () => {
    const s = suggestNext([{ weightKg: 100, reps: 5 }], 5, 5)
    expect(s?.weightKg).toBe(105)
  })

  it('suggests +1 rep on the weakest set when target reps missed', () => {
    const s = suggestNext([
      { weightKg: 80, reps: 8 }, { weightKg: 80, reps: 6 },
    ], 8)
    expect(s).toEqual({ weightKg: 80, reps: 7, reason: 'reps-up' })
  })

  it('only considers top-weight sets (ignores back-off sets)', () => {
    const s = suggestNext([
      { weightKg: 100, reps: 5 }, { weightKg: 80, reps: 3 },
    ], 5)
    expect(s?.reason).toBe('weight-up')
    expect(s?.weightKg).toBe(102.5)
  })

  it('returns null with no history', () => {
    expect(suggestNext([], 8)).toBeNull()
  })
})

describe('platesPerSide', () => {
  it('loads 100kg as 25+15 per side', () => {
    const r = platesPerSide(100)
    expect(r?.plates).toEqual([25, 15])
    expect(r?.remainder).toBe(0)
  })
  it('reports unloadable remainder', () => {
    const r = platesPerSide(21) // 0.5/side with nothing smaller than 1.25
    expect(r?.remainder).toBeCloseTo(0.5)
    expect(formatPlates(r!)).toContain('unloadable')
  })
  it('returns null at or below bar weight', () => {
    expect(platesPerSide(20)).toBeNull()
  })
})

describe('warmupRamp', () => {
  it('builds bar/40/60/80 ramp for 100kg', () => {
    expect(warmupRamp(100)).toEqual([
      { weightKg: 20, reps: 10 },
      { weightKg: 40, reps: 5 },
      { weightKg: 60, reps: 3 },
      { weightKg: 80, reps: 1 },
    ])
  })
  it('gives just the bar for light work weights', () => {
    expect(warmupRamp(28)).toEqual([{ weightKg: 20, reps: 10 }])
    expect(warmupRamp(15)).toEqual([])
  })
  it('drops percentage steps that land at or below the bar', () => {
    const ramp = warmupRamp(40)
    expect(ramp[0]).toEqual({ weightKg: 20, reps: 10 })
    expect(ramp.every(r => r.weightKg <= 40 && r.weightKg >= 20)).toBe(true)
  })
  it('rounds steps to 2.5', () => {
    const ramp = warmupRamp(90)
    expect(ramp.map(r => r.weightKg)).toEqual([20, 35, 55, 72.5])
  })
})
