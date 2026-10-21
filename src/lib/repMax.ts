import { db } from '../db/db'
import { parseLocalDate } from './dates'
import type { Id, SetRow } from '../types'

/** Rep counts shown in the rep-max table (1RM, 3RM, …). */
export const REP_BUCKETS = [1, 3, 5, 8, 10, 12] as const

/** The set that holds a rep max: the heaviest set done for at least N reps. */
export interface RepMax {
  weightKg: number
  reps: number
  completedAt: number
}

/** Bucket N → its record. Buckets without a qualifying set are absent. */
export type RepMaxMap = Map<number, RepMax>

type RepMaxSet = Pick<SetRow, 'weightKg' | 'reps' | 'isWarmup' | 'completedAt'>

/** Heavier wins; then more reps; then the earliest (the first time it was done). */
function beats(a: RepMax, b: RepMax): boolean {
  if (a.weightKg !== b.weightKg) return a.weightKg > b.weightKg
  if (a.reps !== b.reps) return a.reps > b.reps
  return a.completedAt < b.completedAt
}

function offer(map: RepMaxMap, bucket: number, s: RepMax) {
  const cur = map.get(bucket)
  if (!cur || beats(s, cur)) map.set(bucket, s)
}

/**
 * Standard N-rep maxes: bucket N = the best weight among working sets with
 * `reps ≥ N`, so the values never increase from 1RM to 12RM. Warm-ups and
 * unweighted rows (bodyweight, cardio) are ignored. `season` only counts sets
 * completed at or after `seasonStartMs`.
 */
export function computeRepMaxes(
  sets: RepMaxSet[],
  seasonStartMs: number,
): { allTime: RepMaxMap; season: RepMaxMap } {
  const allTime: RepMaxMap = new Map()
  const season: RepMaxMap = new Map()
  for (const s of sets) {
    if (s.isWarmup || s.weightKg <= 0 || s.reps < 1) continue
    const rec = { weightKg: s.weightKg, reps: s.reps, completedAt: s.completedAt }
    for (const n of REP_BUCKETS) {
      if (s.reps < n) break
      offer(allTime, n, rec)
      if (s.completedAt >= seasonStartMs) offer(season, n, rec)
    }
  }
  return { allTime, season }
}

/** Rep maxes of one exercise, all-time and for the current rank season. */
export async function gatherRepMaxes(exerciseId: Id) {
  const state = await db.rankState.get(1)
  const seasonStartMs = state ? parseLocalDate(state.seasonStart).getTime() : 0
  const sets = await db.sets.where('exerciseId').equals(exerciseId).toArray()
  return computeRepMaxes(sets, seasonStartMs)
}
