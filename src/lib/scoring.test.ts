import { describe, it, expect } from 'vitest'
import { epley, intensityMult, scoreSession, SCORING, type ScoreInput } from './scoring'

function input(partial: Partial<ScoreInput>): ScoreInput {
  return {
    sets: [],
    bodyweightKg: 80,
    priorBestE1rm: new Map(),
    priorBestVolume: new Map(),
    streakWeeks: 0,
    isFirstSessionOfDay: true,
    exerciseNames: new Map([[1, 'Bench Press'], [2, 'Squat'], [3, 'Row'], [4, 'OHP'], [5, 'Curl']]),
    ...partial,
  }
}

const set = (exerciseId: number, weightKg: number, reps: number, isWarmup = false) =>
  ({ exerciseId, weightKg, reps, isWarmup })

describe('epley', () => {
  it('computes the standard estimate', () => {
    expect(epley(100, 5)).toBeCloseTo(116.67, 1)
    expect(epley(100, 1)).toBeCloseTo(103.33, 1)
  })
  it('caps reps at 12 where the formula stays reliable', () => {
    expect(epley(100, 20)).toBe(epley(100, 12))
  })
  it('returns 0 for empty sets', () => {
    expect(epley(0, 10)).toBe(0)
    expect(epley(100, 0)).toBe(0)
  })
})

describe('intensityMult', () => {
  it('discounts junk-light sets and rewards heavy ones', () => {
    expect(intensityMult(0.2)).toBe(0.25)
    expect(intensityMult(0.45)).toBe(0.75)
    expect(intensityMult(0.7)).toBe(1.0)
    expect(intensityMult(0.9)).toBe(1.1)
  })
})

describe('scoreSession', () => {
  it('scores a simple session against a known prior best', () => {
    // 4x8 @ 80kg bench, prior best e1RM 100, bw 80.
    // relInt = 0.8 -> mult 1.0; setPoints = 80*8*1.0/80 = 8; base = 32.
    // session e1RM = 80*(1+8/30) = 101.3 > 100 -> e1RM PR (+25).
    // volume 2560 > prior 2000 -> volume PR (+10).
    const r = scoreSession(input({
      sets: [set(1, 80, 8), set(1, 80, 8), set(1, 80, 8), set(1, 80, 8)],
      priorBestE1rm: new Map([[1, 100]]),
      priorBestVolume: new Map([[1, 2000]]),
    }))
    expect(r.basePoints).toBeCloseTo(32, 1)
    expect(r.prBonus).toBe(35)
    expect(r.total).toBe(67)
    expect(r.breakdown[0].e1rmPr).toBe(true)
    expect(r.breakdown[0].volumePr).toBe(true)
  })

  it('gives no PR bonus the first time an exercise is performed', () => {
    const r = scoreSession(input({ sets: [set(1, 80, 8)] }))
    expect(r.prBonus).toBe(0)
  })

  it('excludes warm-up sets', () => {
    const r = scoreSession(input({
      sets: [set(1, 40, 10, true), set(1, 80, 8)],
      priorBestE1rm: new Map([[1, 110]]),
    }))
    expect(r.breakdown[0].totalSets).toBe(1)
  })

  it('counts at most 6 sets per exercise', () => {
    const sets = Array.from({ length: 12 }, () => set(1, 80, 8))
    const r = scoreSession(input({ sets, priorBestE1rm: new Map([[1, 110]]) }))
    expect(r.breakdown[0].countedSets).toBe(SCORING.maxSetsPerExercise)
    expect(r.basePoints).toBeCloseTo(48, 1) // 6 * 8
  })

  it('counts at most 24 sets per session', () => {
    // 5 exercises x 6 light-ish sets = 30 counted candidates -> trimmed to 24.
    // 40kg x 8 vs prior 55 -> relInt 0.73 -> mult 1.0 -> 4 pts/set, under the 150 cap.
    const sets = [1, 2, 3, 4, 5].flatMap(ex =>
      Array.from({ length: 6 }, () => set(ex, 40, 8)))
    const r = scoreSession(input({
      priorBestE1rm: new Map([[1, 55], [2, 55], [3, 55], [4, 55], [5, 55]]),
      sets,
    }))
    expect(r.basePoints).toBeCloseTo(24 * 4, 1)
  })

  it('caps base points at 150', () => {
    const sets = Array.from({ length: 6 }, () => set(1, 200, 10))
    const r = scoreSession(input({
      sets,
      bodyweightKg: 60,
      priorBestE1rm: new Map([[1, 260]]),
    }))
    expect(r.basePoints).toBe(SCORING.sessionBaseCap)
  })

  it('discounts junk-light volume', () => {
    // 20kg vs prior best 200 -> relInt 0.1 -> 0.25 mult.
    const r = scoreSession(input({
      sets: [set(1, 20, 20)],
      priorBestE1rm: new Map([[1, 200]]),
    }))
    expect(r.basePoints).toBe(1.3) // (20*20*0.25)/80 = 1.25, rounded to one decimal
  })

  it('ignores reps beyond 20 for volume', () => {
    const a = scoreSession(input({ sets: [set(1, 50, 20)], priorBestE1rm: new Map([[1, 70]]) }))
    const b = scoreSession(input({ sets: [set(1, 50, 35)], priorBestE1rm: new Map([[1, 70]]) }))
    expect(a.basePoints).toBe(b.basePoints)
  })

  it('applies the streak multiplier with its cap', () => {
    const sets = [set(1, 80, 8)]
    const prior = new Map([[1, 110]])
    const base = scoreSession(input({ sets, priorBestE1rm: prior }))
    const s2 = scoreSession(input({ sets, priorBestE1rm: prior, streakWeeks: 2 }))
    const s99 = scoreSession(input({ sets, priorBestE1rm: prior, streakWeeks: 99 }))
    expect(s2.total).toBe(Math.round(base.basePoints * 1.1))
    expect(s99.streakMult).toBe(SCORING.streakCap)
  })

  it('discounts a second session on the same day', () => {
    const r = scoreSession(input({
      sets: [set(1, 80, 8)],
      priorBestE1rm: new Map([[1, 110]]),
      isFirstSessionOfDay: false,
    }))
    expect(r.dayFactor).toBe(SCORING.extraSessionFactor)
    expect(r.total).toBe(Math.round(8 * 0.25))
  })

  it('caps the PR bonus at 75', () => {
    // 5 exercises, all with e1RM PRs (25*3 capped) + volume PRs (10*3) -> 75+30 -> cap 75.
    const sets = [1, 2, 3, 4, 5].map(ex => set(ex, 100, 8))
    const r = scoreSession(input({
      sets,
      priorBestE1rm: new Map([[1, 50], [2, 50], [3, 50], [4, 50], [5, 50]]),
      priorBestVolume: new Map([[1, 100], [2, 100], [3, 100], [4, 100], [5, 100]]),
    }))
    expect(r.prBonus).toBe(SCORING.prBonusCap)
  })
})
