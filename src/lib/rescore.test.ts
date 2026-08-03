import { describe, it, expect } from 'vitest'
import { scoreSession, SCORING } from './scoring'

/**
 * rescoreSession carries historical finish-context (streakMult, dayFactor) from
 * the stored scoreEvent rather than recomputing it. These tests pin the two
 * reconstruction assumptions it relies on.
 */

const score = (streakWeeks: number, isFirstSessionOfDay = true) =>
  scoreSession({
    sets: [],
    bodyweightKg: 80,
    priorBestE1rm: new Map(),
    priorBestVolume: new Map(),
    streakWeeks,
    isFirstSessionOfDay,
    exerciseNames: new Map(),
  })

describe('rescore: streak reconstruction round-trips without drift', () => {
  it('round((streakMult-1)/streakStep) reproduces the stored streakMult for all week counts', () => {
    for (let w = 0; w <= 30; w++) {
      const stored = score(w).streakMult
      const reconstructedWeeks = Math.round((stored - 1) / SCORING.streakStep)
      const reproduced = score(reconstructedWeeks).streakMult
      expect(reproduced).toBe(stored) // no ±1pt drift, including at the cap
    }
  })

  it('caps at streakCap and stays there', () => {
    expect(score(6).streakMult).toBe(SCORING.streakCap)
    expect(score(50).streakMult).toBe(SCORING.streakCap)
  })
})

describe('rescore: dayFactor carry via (dayFactor === 1)', () => {
  it('scoreSession emits exactly 1 or the extra-session factor', () => {
    expect(score(0, true).dayFactor).toBe(1)
    expect(score(0, false).dayFactor).toBe(SCORING.extraSessionFactor)
  })

  it('carrying isFirstSessionOfDay = (storedDayFactor === 1) reproduces the factor', () => {
    for (const first of [true, false]) {
      const storedDayFactor = score(0, first).dayFactor
      const carried = storedDayFactor === 1
      expect(score(0, carried).dayFactor).toBe(storedDayFactor)
    }
  })
})
