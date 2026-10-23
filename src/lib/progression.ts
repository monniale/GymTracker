export interface PrevSet {
  weightKg: number
  reps: number
}

export interface ProgressionSuggestion {
  weightKg: number
  reps: number
  reason: 'weight-up' | 'reps-up'
}

export interface ProgressionOpts {
  /** Bodyweight load (src/lib/load.ts): weightKg is ADDED kg, so 0 (just bodyweight) and
   * negative (assisted) sets count, and the weight step is at most `BODYWEIGHT_STEP_KG`. */
  bodyweight?: boolean
}

/** Largest added-kg step suggested for a bodyweight move (a small plate on a dip belt). */
export const BODYWEIGHT_STEP_KG = 1.25

/**
 * Double progression over the last session's work sets for an exercise:
 * - every top-weight set hit the target reps → add the progression step;
 * - otherwise → same weight, one more rep on the weakest top-weight set
 *   (capped at target reps).
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

  const topWeight = Math.max(...work.map(s => s.weightKg))
  const topSets = work.filter(s => s.weightKg === topWeight)
  const allHitTarget = topSets.every(s => s.reps >= targetReps)
  const step = opts.bodyweight ? Math.min(stepKg, BODYWEIGHT_STEP_KG) : stepKg

  if (allHitTarget) {
    return {
      weightKg: Math.round((topWeight + step) * 100) / 100,
      reps: targetReps,
      reason: 'weight-up',
    }
  }

  const weakest = Math.min(...topSets.map(s => s.reps))
  const nextReps = Math.min(targetReps, weakest + 1)
  if (nextReps <= weakest) return null
  return { weightKg: topWeight, reps: nextReps, reason: 'reps-up' }
}
