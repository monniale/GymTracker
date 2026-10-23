import { db } from '../db/db'
import { parseLocalDate } from './dates'
import { usesBodyweightLoad, withLoads } from './load'
import type { Exercise, Id, Session, SetRow } from '../types'

/** Rep counts shown in the rep-max table (1RM, 3RM, …). */
export const REP_BUCKETS = [1, 3, 5, 8, 10, 12] as const

/** The set that holds a rep max: the heaviest set done for at least N reps. */
export interface RepMax {
  /** As logged, for display (`fmtSetLoad`): the added kg when `bodyweightLoad`. */
  weightKg: number
  /** Effective load (src/lib/load.ts) the records are ranked by. */
  loadKg: number
  reps: number
  completedAt: number
  /** The set was bodyweight load (weightKg = added kg). */
  bodyweightLoad: boolean
}

/** Bucket N → its record. Buckets without a qualifying set are absent. */
export type RepMaxMap = Map<number, RepMax>

export type RepMaxSet = Pick<SetRow, 'weightKg' | 'reps' | 'isWarmup' | 'completedAt'> & {
  /** Effective load; absent = weightKg. */
  loadKg?: number
  bodyweightLoad?: boolean
}

/** Heavier load wins; then more reps; then the earliest (the first time it was done). */
function beats(a: RepMax, b: RepMax): boolean {
  if (a.loadKg !== b.loadKg) return a.loadKg > b.loadKg
  if (a.reps !== b.reps) return a.reps > b.reps
  return a.completedAt < b.completedAt
}

function offer(map: RepMaxMap, bucket: number, s: RepMax) {
  const cur = map.get(bucket)
  if (!cur || beats(s, cur)) map.set(bucket, s)
}

/**
 * Standard N-rep maxes: bucket N = the best load among working sets with
 * `reps ≥ N`, so the loads never increase from 1RM to 12RM. Warm-ups and
 * rows without load (cardio, bodyweight sets of older unstamped sessions) are ignored. `season` only counts sets
 * completed at or after `seasonStartMs`.
 */
export function computeRepMaxes(
  sets: RepMaxSet[],
  seasonStartMs: number,
): { allTime: RepMaxMap; season: RepMaxMap } {
  const allTime: RepMaxMap = new Map()
  const season: RepMaxMap = new Map()
  for (const s of sets) {
    const loadKg = s.loadKg ?? s.weightKg
    if (s.isWarmup || loadKg <= 0 || s.reps < 1) continue
    const rec: RepMax = {
      weightKg: s.weightKg,
      loadKg,
      reps: s.reps,
      completedAt: s.completedAt,
      bodyweightLoad: s.bodyweightLoad ?? false,
    }
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
  const ex = await db.exercises.get(exerciseId)
  const sessionIds = [...new Set(sets.map(s => s.sessionId))]
  const sessions = await db.sessions.bulkGet(sessionIds)
  const sessionsById = new Map<Id, Session>()
  sessions.forEach((row, i) => { if (row) sessionsById.set(sessionIds[i], row) })
  const exMap = new Map<Id, Exercise>(ex ? [[exerciseId, ex]] : [])
  const loaded = withLoads(sets, exMap, sessionsById).map(s => ({
    ...s,
    bodyweightLoad: usesBodyweightLoad(ex, sessionsById.get(s.sessionId)),
  }))
  return computeRepMaxes(loaded, seasonStartMs)
}
