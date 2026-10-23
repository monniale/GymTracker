import { describe, it, expect } from 'vitest'
import { goalStatus } from './goalStatus'
import { GOAL_REACHED_KG } from './tdee'
import type { BodyLogEntry } from '../types'

const e = (date: string, weightKg: number): BodyLogEntry => ({ date, weightKg })
const TODAY = '2026-10-15'
// Losing 0.5 kg/week over the last two weeks: 80 → 79.5 → 79.
const losing = [e('2026-10-01', 80), e('2026-10-08', 79.5), e('2026-10-15', 79)]

describe('goalStatus', () => {
  it('is none without a goal', () => {
    expect(goalStatus(losing, { bodyweightKg: 79 }, TODAY)).toEqual({ kind: 'none' })
  })

  it('uses the observed rate when it moves toward the goal', () => {
    const s = goalStatus(losing, { bodyweightKg: 79, goalWeightKg: 75, goalRatePctPerWeek: -1 }, TODAY)
    expect(s).toEqual({ kind: 'eta', goalKg: 75, weeks: 8, rateKgPerWeek: -0.5, source: 'observed' })
  })

  it('falls back to the planned rate when the trend points away', () => {
    // Trend is −0.5 kg/wk but the goal is above: planned +0.5 % of 79 kg = +0.395 kg/wk.
    const s = goalStatus(losing, { bodyweightKg: 79, goalWeightKg: 81, goalRatePctPerWeek: 0.5 }, TODAY)
    expect(s.kind).toBe('eta')
    if (s.kind !== 'eta') return
    expect(s.source).toBe('planned')
    expect(s.rateKgPerWeek).toBeCloseTo(0.395)
    expect(s.weeks).toBe(Math.ceil(2 / 0.395))
  })

  it('takes the planned direction from goal vs current, not the stored sign', () => {
    const s = goalStatus(losing, { bodyweightKg: 79, goalWeightKg: 81, goalRatePctPerWeek: -0.5 }, TODAY)
    expect(s).toMatchObject({ kind: 'eta', source: 'planned' })
  })

  it('uses the planned rate from the newest weigh-in when there is no trend yet', () => {
    // bodyweightKg (90) lags behind the newest weigh-in (80): the plan is 0.5 % of 80 kg.
    const s = goalStatus([e('2026-10-15', 80)], { bodyweightKg: 90, goalWeightKg: 76, goalRatePctPerWeek: -0.5 }, TODAY)
    expect(s).toEqual({ kind: 'eta', goalKg: 76, weeks: 10, rateKgPerWeek: -0.4, source: 'planned' })
  })

  it('commits to a slow trend toward the goal: far, not the planned ETA', () => {
    // −0.05 kg/wk with 10 kg to go is 200 weeks; the planned −0.5 % (0.45 kg/wk) would say 23.
    const slow = [e('2026-10-01', 90.1), e('2026-10-08', 90.05), e('2026-10-15', 90)]
    expect(goalStatus(slow, { bodyweightKg: 90, goalWeightKg: 80, goalRatePctPerWeek: -0.5 }, TODAY)).toEqual({ kind: 'far', goalKg: 80 })
  })

  it('only counts a listed rate choice as a plan (what the goal sheet highlights)', () => {
    const one = [e('2026-10-15', 80)]
    // A 0 rate (stored at "maintain") or a magnitude that is not a choice for this direction: no plan.
    expect(goalStatus(one, { bodyweightKg: 80, goalWeightKg: 76, goalRatePctPerWeek: 0 }, TODAY).kind).toBe('offTrack')
    expect(goalStatus(one, { bodyweightKg: 80, goalWeightKg: 84, goalRatePctPerWeek: -1 }, TODAY).kind).toBe('offTrack')
    // 0.5 is a choice on both sides, so a stale sign keeps its magnitude.
    expect(goalStatus(one, { bodyweightKg: 80, goalWeightKg: 84, goalRatePctPerWeek: -0.5 }, TODAY)).toMatchObject({ kind: 'eta', weeks: 10 })
  })

  it('is reached within 0.3 kg', () => {
    expect(goalStatus(losing, { bodyweightKg: 79, goalWeightKg: 79.2 }, TODAY)).toEqual({ kind: 'reached', goalKg: 79.2 })
    expect(goalStatus(losing, { bodyweightKg: 79, goalWeightKg: 78.5 }, TODAY).kind).not.toBe('reached')
    // Exactly the threshold away (binary-exact 0.3 vs 0) is not reached.
    expect(goalStatus([], { bodyweightKg: 0, goalWeightKg: GOAL_REACHED_KG }, TODAY).kind).not.toBe('reached')
  })

  it('is off track with no usable rate', () => {
    // Trend away from the goal and no planned rate.
    expect(goalStatus(losing, { bodyweightKg: 79, goalWeightKg: 85 }, TODAY)).toEqual({ kind: 'offTrack', goalKg: 85 })
  })

  it('is far when the planned rate needs more than two years', () => {
    // 40 kg at 0.25 % of 79 kg/wk (0.1975 kg/wk) is about 203 weeks.
    expect(goalStatus([e('2026-10-15', 79)], { bodyweightKg: 79, goalWeightKg: 39, goalRatePctPerWeek: -0.25 }, TODAY)).toEqual({ kind: 'far', goalKg: 39 })
  })

  it('reads the newest weigh-in whatever the order, else the settings bodyweight', () => {
    const shuffled = [losing[2], losing[0], losing[1]]
    expect(goalStatus(shuffled, { bodyweightKg: 90, goalWeightKg: 79.1 }, TODAY).kind).toBe('reached')
    expect(goalStatus([], { bodyweightKg: 70, goalWeightKg: 70.2 }, TODAY).kind).toBe('reached')
  })

  it('with the calculator profile saved, uses the rate the kcal floor allows', () => {
    // f, 30 y, 160 cm, 55 kg, sedentary at -1 %: the floor holds the deficit at ~-0.225 kg/wk, not -0.55.
    const profile = { sex: 'f' as const, birthYear: 1996, heightCm: 160, activity: 'sedentary' as const }
    const s = goalStatus([], { bodyweightKg: 55, goalWeightKg: 50, goalRatePctPerWeek: -1, ...profile }, TODAY)
    expect(s).toMatchObject({ kind: 'eta', weeks: 23, source: 'planned' })
    if (s.kind === 'eta') expect(s.rateKgPerWeek).toBeCloseTo(-0.2253, 3)
  })

  it('is not on track when the floor is maintenance', () => {
    const profile = { sex: 'f' as const, birthYear: 1966, heightCm: 150, activity: 'sedentary' as const }
    const s = goalStatus([], { bodyweightKg: 45, goalWeightKg: 42, goalRatePctPerWeek: -1, ...profile }, TODAY)
    expect(s).toEqual({ kind: 'offTrack', goalKg: 42 })
  })
})
