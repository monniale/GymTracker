export interface PrevSet {
  weightKg: number
  reps: number
}

export interface ProgressionSuggestion {
  weightKg: number
  reps: number
  reason: 'weight-up' | 'reps-up'
}

/**
 * Double progression over the last session's work sets for an exercise:
 * - every top-weight set hit the target reps → add the progression step;
 * - otherwise → same weight, one more rep on the weakest top-weight set
 *   (capped at target reps).
 * Returns null when there is no history or nothing to improve on
 * (already progressing via prefill).
 */
export function suggestNext(
  prevSets: PrevSet[],
  targetReps: number,
  stepKg = 2.5,
): ProgressionSuggestion | null {
  const work = prevSets.filter(s => s.weightKg > 0 && s.reps > 0)
  if (work.length === 0) return null

  const topWeight = Math.max(...work.map(s => s.weightKg))
  const topSets = work.filter(s => s.weightKg === topWeight)
  const allHitTarget = topSets.every(s => s.reps >= targetReps)

  if (allHitTarget) {
    return {
      weightKg: Math.round((topWeight + stepKg) * 100) / 100,
      reps: targetReps,
      reason: 'weight-up',
    }
  }

  const weakest = Math.min(...topSets.map(s => s.reps))
  const nextReps = Math.min(targetReps, weakest + 1)
  if (nextReps <= weakest) return null
  return { weightKg: topWeight, reps: nextReps, reason: 'reps-up' }
}
