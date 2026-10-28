import { describe, it, expect } from 'vitest'
import { goalBounds, goalDirection, goalWeightFor, goalWeightPatch, initialGoal } from './goalDirection'
import { GOAL_REACHED_KG } from './tdee'

describe('goalDirection', () => {
  it('is lose below, gain above, maintain within the reached threshold', () => {
    expect(goalDirection(75, 80)).toBe(-1)
    expect(goalDirection(85, 80)).toBe(1)
    expect(goalDirection(80.2, 80)).toBe(0)
    expect(goalDirection(79.8, 80)).toBe(0)
  })

  it('the threshold itself is not "maintain" (binary-exact 0.3 vs 0)', () => {
    expect(goalDirection(GOAL_REACHED_KG, 0)).toBe(1)
    expect(goalDirection(0, GOAL_REACHED_KG)).toBe(-1)
  })
})

describe('goalBounds / goalWeightFor', () => {
  it('keeps lose bounds at least 0.5 kg under and gain bounds 0.5 kg over the current weight', () => {
    for (const w of [50, 74.5, 80, 80.3, 120]) {
      const [loL, hiL] = goalBounds('lose', w)
      const [loG, hiG] = goalBounds('gain', w)
      expect(hiL).toBeLessThanOrEqual(w - 0.5)
      expect(loL).toBeLessThan(hiL)
      expect(loG).toBeGreaterThanOrEqual(w + 0.5)
      expect(hiG).toBeGreaterThan(loG)
    }
  })

  it('keeps a saved goal on the right side and replaces one on the wrong side', () => {
    expect(goalWeightFor('lose', 80, 75)).toBe(75)
    expect(goalWeightFor('gain', 80, 83)).toBe(83)
    expect(goalWeightFor('lose', 74.5, 75)).toBe(69.5) // 75 is above 74.5: not a lose goal
    expect(goalWeightFor('gain', 80, 75)).toBe(83)
    expect(goalWeightFor('lose', 80, undefined)).toBe(75)
  })
})

describe('initialGoal', () => {
  it('follows goal vs current weight, not a stale stored sign', () => {
    // Lost past a lose goal: the weight is now under it, so the goal reads as gain.
    expect(initialGoal({ bodyweightKg: 74.5, goalWeightKg: 75, goalRatePctPerWeek: -0.5 })).toBe('gain')
    // A 0 rate stored at "maintain", then the weight drifted away from the goal.
    expect(initialGoal({ bodyweightKg: 78, goalWeightKg: 75, goalRatePctPerWeek: 0 })).toBe('lose')
    expect(initialGoal({ bodyweightKg: 75.1, goalWeightKg: 75, goalRatePctPerWeek: -0.5 })).toBe('maintain')
  })

  it('falls back to the rate sign without a goal weight, else maintain', () => {
    expect(initialGoal({ bodyweightKg: 80, goalRatePctPerWeek: -0.5 })).toBe('lose')
    expect(initialGoal({ bodyweightKg: 80, goalRatePctPerWeek: 0.25 })).toBe('gain')
    expect(initialGoal({ bodyweightKg: 80, goalRatePctPerWeek: 0 })).toBe('maintain')
    expect(initialGoal({ bodyweightKg: 80 })).toBe('maintain')
  })
})

describe('goalWeightPatch', () => {
  it('signs the rate from goal vs current weight: negative to lose, positive to gain', () => {
    expect(goalWeightPatch(75, 80, -0.75)).toEqual({ goalWeightKg: 75, goalRatePctPerWeek: -0.75 })
    expect(goalWeightPatch(83, 80, 0.5)).toEqual({ goalWeightKg: 83, goalRatePctPerWeek: 0.5 })
    // A stored lose magnitude that is also a gain choice keeps it, with the new sign.
    expect(goalWeightPatch(83, 80, -0.5)).toEqual({ goalWeightKg: 83, goalRatePctPerWeek: 0.5 })
  })

  it('uses the direction default for a missing, zero or unlisted magnitude', () => {
    expect(goalWeightPatch(75, 80, undefined).goalRatePctPerWeek).toBe(-0.5)
    expect(goalWeightPatch(75, 80, 0).goalRatePctPerWeek).toBe(-0.5)
    expect(goalWeightPatch(83, 80, -1).goalRatePctPerWeek).toBe(0.25) // 1 % is not a gain choice
  })

  it('stores rate 0 for a goal within 0.3 kg', () => {
    expect(goalWeightPatch(80, 80.2, -0.5)).toEqual({ goalWeightKg: 80, goalRatePctPerWeek: 0 })
  })
})
