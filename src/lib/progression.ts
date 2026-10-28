import type { SetRow } from '../types'

export interface PrevSet {
  weightKg: number
  reps: number
  /** RPE 6–10 (src/lib/setTypes.ts), when recorded. */
  rpe?: number
  /** Absent = working set. */
  setType?: SetRow['setType']
}

export interface ProgressionSuggestion {
  weightKg: number
  reps: number
  /** 'hold' = repeat the same weight and reps: the last session ended near the limit. */
  reason: 'weight-up' | 'reps-up' | 'hold'
}

export interface ProgressionOpts {
  /** Bodyweight load (src/lib/load.ts): weightKg is ADDED kg, so 0 (just bodyweight) and
   * negative (assisted) sets count, and the weight step is at most `BODYWEIGHT_STEP_KG`
   * (doubled, like any step, after an easy session). */
  bodyweight?: boolean
  /** Top of a rep range (`TemplateItem.targetRepsMax`, default `targetReps`): reps climb up to it,
   * then the weight goes up and the reps go back to `targetReps`. */
  targetRepsMax?: number
}

/** Largest added-kg step suggested for a bodyweight move (a small plate on a dip belt). */
export const BODYWEIGHT_STEP_KG = 1.25

/** Top sets this easy (max RPE at or under it) with every target hit → a double step. */
export const EASY_RPE = 7
/** Any top set this hard (max RPE at or over it) → hold the same weight and reps. */
export const HOLD_RPE = 9.5

/** A set's effort for progression: its RPE, or 10 for a set taken to failure without one. */
function effortOf(s: PrevSet): number | undefined {
  if (typeof s.rpe === 'number' && Number.isFinite(s.rpe)) return s.rpe
  return s.setType === 'failure' ? 10 : undefined
}

/**
 * Double progression over the last session's work sets for an exercise:
 * - drop sets never set the top weight (they are lighter by design);
 * - the hardest top-weight set was RPE 9.5+ (a failure set without an RPE
 *   counts as 10) → hold: same weight, same reps (capped at target reps);
 * - every top-weight set hit the target reps at RPE 7 or less → two steps;
 * - every top-weight set hit the target reps → add the progression step;
 * - otherwise → same weight, one more rep on the weakest top-weight set
 *   (capped at target reps).
 * With a rep range (`opts.targetRepsMax` above `targetReps`) "the target"
 * above is the top of the range: reps climb to it, and the weight step resets
 * the reps to `targetReps` (the bottom of the range).
 * Sets without an RPE follow the plain rule: the double step needs every
 * top-weight set rated, while one rated RPE 9.5+ set is enough to hold.
 * With `opts.bodyweight` the weight is the added kg (0 = bodyweight only,
 * negative = assisted): reps climb first, then the added kg grows by at most
 * 1.25 kg (or the assistance shrinks by as much).
 * Returns null when there is no history or nothing to improve on
 * (already progressing via prefill).
 */
export function suggestNext(
  prevSets: PrevSet[],
  targetReps: number,
  stepKg = 2.5,
  opts: ProgressionOpts = {},
): ProgressionSuggestion | null {
  const work = prevSets.filter(s => (opts.bodyweight || s.weightKg > 0) && s.reps > 0)
  if (work.length === 0) return null

  // A session of drop sets only still progresses on them.
  const straight = work.filter(s => s.setType !== 'drop')
  const pool = straight.length > 0 ? straight : work
  const topWeight = Math.max(...pool.map(s => s.weightKg))
  const topSets = pool.filter(s => s.weightKg === topWeight)
  const maxReps = Math.max(targetReps, opts.targetRepsMax ?? targetReps)
  const allHitTarget = topSets.every(s => s.reps >= maxReps)
  const step = opts.bodyweight ? Math.min(stepKg, BODYWEIGHT_STEP_KG) : stepKg
  const weakest = Math.min(...topSets.map(s => s.reps))

  const efforts = topSets.map(effortOf).filter((e): e is number => e !== undefined)
  const maxRpe = efforts.length > 0 ? Math.max(...efforts) : undefined

  if (maxRpe !== undefined && maxRpe >= HOLD_RPE) {
    return { weightKg: topWeight, reps: Math.min(maxReps, weakest), reason: 'hold' }
  }

  if (allHitTarget) {
    const allRated = efforts.length === topSets.length
    const steps = allRated && maxRpe !== undefined && maxRpe <= EASY_RPE ? 2 : 1
    return {
      weightKg: Math.round((topWeight + step * steps) * 100) / 100,
      reps: targetReps,
      reason: 'weight-up',
    }
  }

  const nextReps = Math.min(maxReps, weakest + 1)
  if (nextReps <= weakest) return null
  return { weightKg: topWeight, reps: nextReps, reason: 'reps-up' }
}
