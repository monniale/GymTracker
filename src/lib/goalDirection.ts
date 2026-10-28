// Goal direction and goal-weight rules shared by the calculator
// (TargetsCalculator.tsx) and the goal sheet (GoalFields.tsx). Pure: no db, no i18n.
//
// The direction always comes from the goal weight vs the current weight (as in
// goalStatus.ts). The stored `goalRatePctPerWeek` sign can go stale (a weigh-in
// changes the current weight without rewriting the rate), so it only decides the
// direction when no goal weight is saved.

import { GOAL_REACHED_KG, rateChoice } from './tdee'
import type { Settings } from '../types'

/** -1 lose, +1 gain, 0 maintain. */
export type GoalDir = -1 | 0 | 1
export type Goal = 'lose' | 'maintain' | 'gain'

/** -1 lose, +1 gain, 0 maintain (goal within GOAL_REACHED_KG of the current weight). */
export function goalDirection(goalKg: number, currentKg: number): GoalDir {
  const diff = goalKg - currentKg
  return Math.abs(diff) < GOAL_REACHED_KG ? 0 : diff < 0 ? -1 : 1
}

/** The rate-choice side for a direction (maintain reads as lose: it has no rate). */
export function goalSide(d: GoalDir): 'lose' | 'gain' {
  return d > 0 ? 'gain' : 'lose'
}

const round05 = (v: number) => Math.round(v * 2) / 2

/** Goal weight bounds per direction: always at least 0.5 kg on the right side of the current weight. */
export function goalBounds(goal: 'lose' | 'gain', weightKg: number): [number, number] {
  return goal === 'lose'
    ? [Math.max(30, Math.floor(weightKg * 0.6)), Math.floor((weightKg - 0.5) * 2) / 2]
    : [Math.ceil((weightKg + 0.5) * 2) / 2, Math.min(300, Math.ceil(weightKg * 1.5))]
}

/** The goal weight to show for a direction: the saved one if it lies on that side, else a few kg away. */
export function goalWeightFor(goal: 'lose' | 'gain', weightKg: number, saved: number | undefined): number {
  const [lo, hi] = goalBounds(goal, weightKg)
  if (saved !== undefined && saved >= lo && saved <= hi) return saved
  return Math.min(hi, Math.max(lo, round05(weightKg + (goal === 'lose' ? -5 : 3))))
}

/**
 * The calculator's opening direction: from the saved goal weight vs the current
 * weight when a goal is saved, else from the saved rate's sign, else maintain.
 */
export function initialGoal(s: Pick<Settings, 'bodyweightKg' | 'goalWeightKg' | 'goalRatePctPerWeek'>): Goal {
  if (s.goalWeightKg !== undefined && Number.isFinite(s.goalWeightKg)) {
    const d = goalDirection(s.goalWeightKg, s.bodyweightKg)
    return d < 0 ? 'lose' : d > 0 ? 'gain' : 'maintain'
  }
  const r = s.goalRatePctPerWeek
  if (r !== undefined && Number.isFinite(r) && r !== 0) return r < 0 ? 'lose' : 'gain'
  return 'maintain'
}

/**
 * The settings patch for a new goal weight: the rate keeps the stored magnitude
 * when it is a choice for the new direction (else that direction's default) and
 * takes its sign from goal vs current weight (negative = lose, 0 = maintain).
 */
export function goalWeightPatch(
  goalKg: number,
  currentKg: number,
  storedPct: number | undefined,
): Pick<Settings, 'goalWeightKg' | 'goalRatePctPerWeek'> {
  const d = goalDirection(goalKg, currentKg)
  return { goalWeightKg: goalKg, goalRatePctPerWeek: d === 0 ? 0 : d * rateChoice(goalSide(d), storedPct) }
}
