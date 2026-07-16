import { db } from '../db/db'
import { localDateStr, addDays, mondayOf, parseLocalDate } from './dates'
import type { Exercise, Id, MuscleGroup, SetRow } from '../types'

/** Evidence-backed weekly hard-set range per muscle for hypertrophy.
 * Single source of truth shared by the Progress chart and the AI coach. */
export const HYPERTROPHY_SET_BAND: [number, number] = [10, 20]

export interface MuscleVolumeRow {
  group: MuscleGroup
  /** This week's non-warmup working sets. */
  sets: number
  /** Trailing average sets/week over the prior 7 weeks (rounded to 0.1). */
  weeklyAvg: number
}

/**
 * This week's hard sets per muscle vs the trailing 8-week average, from an
 * already-fetched set list. Pure (no DB, no clock) so it is unit-testable.
 * Mirrors the original ProgressScreen computation exactly (warmups and cardio
 * excluded; `weeklyAvg` = prior-weeks set count / 7; sorted by this-week sets).
 */
export function computeWeeklyMuscleVolume(
  sets: SetRow[],
  exMap: Map<Id, Exercise>,
  today: string,
): MuscleVolumeRow[] {
  const thisMonday = mondayOf(today)
  const start8w = parseLocalDate(addDays(thisMonday, -49)).getTime()
  const weekStart = parseLocalDate(thisMonday).getTime()
  const thisWeek = new Map<MuscleGroup, number>()
  const past = new Map<MuscleGroup, number>()
  for (const s of sets) {
    if (s.isWarmup || s.completedAt < start8w) continue
    const mg = exMap.get(s.exerciseId)?.muscleGroup
    if (!mg || mg === 'cardio') continue
    if (s.completedAt >= weekStart) thisWeek.set(mg, (thisWeek.get(mg) ?? 0) + 1)
    else past.set(mg, (past.get(mg) ?? 0) + 1)
  }
  const groups = new Set<MuscleGroup>([...thisWeek.keys(), ...past.keys()])
  return [...groups]
    .map(g => ({
      group: g,
      sets: thisWeek.get(g) ?? 0,
      weeklyAvg: Math.round(((past.get(g) ?? 0) / 7) * 10) / 10,
    }))
    .sort((a, b) => b.sets - a.sets)
}

/** Fetch the last 8 weeks of sets and compute the weekly muscle volume. */
export async function gatherWeeklyMuscleVolume(
  exMap: Map<Id, Exercise>,
  today: string = localDateStr(),
): Promise<MuscleVolumeRow[]> {
  const start8w = parseLocalDate(addDays(mondayOf(today), -49)).getTime()
  const sets = await db.sets.filter(s => !s.isWarmup && s.completedAt >= start8w).toArray()
  return computeWeeklyMuscleVolume(sets, exMap, today)
}
