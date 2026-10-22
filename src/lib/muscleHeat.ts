import { db } from '../db/db'
import { addDays, localDateStr, mondayOf, parseLocalDate } from './dates'
import { isCardioExercise, isCardioSet } from './cardio'
import { libraryIdOf, type ExerciseLibrary } from './exerciseLibrary'
import { involvement, type BodyTarget } from './muscleMap'
import type { Exercise, Id, SetRow } from '../types'

/** Weeks shown in the Progress muscle heatmap (this week included). */
export const MUSCLE_HEAT_WEEKS = 8

/** Rows of the weeks grid, head to toe (the minor muscles show on the body figure only). */
export const HEAT_ROWS: BodyTarget[] = [
  'pectorals', 'delts', 'traps', 'upper back', 'lats', 'spine', 'biceps', 'triceps', 'forearms',
  'abs', 'glutes', 'quads', 'hamstrings', 'calves',
]

export interface MuscleWeek {
  /** Monday of the week (local date). */
  monday: string
  /** Hard sets per body region: 1 per set for the target muscle, ½ for each secondary one. */
  regions: Partial<Record<BodyTarget, number>>
  /** Hard (working, non-cardio) sets logged that week. */
  sets: number
}

/**
 * Hard sets per body region for each of the last `weeks` weeks, oldest first. An exercise counts
 * for its library entry's target (1) and secondary muscles (½ each), or for its muscle group when it
 * has no entry (or the library isn't loaded). Warm-ups and cardio are left out, like the weekly
 * muscle-volume bars. Pure: no DB, no clock.
 */
export function computeMuscleHeat(
  sets: SetRow[],
  exMap: Map<Id, Exercise>,
  library: Pick<ExerciseLibrary, 'byId'> | null,
  today: string,
  weeks = MUSCLE_HEAT_WEEKS,
): MuscleWeek[] {
  const thisMonday = mondayOf(today)
  const result: MuscleWeek[] = Array.from({ length: weeks }, (_, i) => ({
    monday: addDays(thisMonday, -7 * (weeks - 1 - i)),
    regions: {},
    sets: 0,
  }))
  const byMonday = new Map(result.map(w => [w.monday, w]))
  for (const s of sets) {
    if (s.isWarmup || isCardioSet(s)) continue
    const ex = exMap.get(s.exerciseId)
    if (!ex || isCardioExercise(ex)) continue
    const week = byMonday.get(mondayOf(localDateStr(new Date(s.completedAt))))
    if (!week) continue
    const libId = libraryIdOf(ex)
    const inv = involvement(libId ? library?.byId.get(libId) : undefined, ex.muscleGroup)
    week.sets++
    for (const r of inv.primary) week.regions[r] = (week.regions[r] ?? 0) + 1
    for (const r of inv.secondary) week.regions[r] = (week.regions[r] ?? 0) + 0.5
  }
  return result
}

/** Heat level 0–4 for a region's weekly sets (10+ = the hypertrophy band's floor = hottest). */
export function regionHeatLevel(sets: number | undefined): 0 | 1 | 2 | 3 | 4 {
  const n = sets ?? 0
  if (n <= 0) return 0
  if (n < 3) return 1
  if (n < 6) return 2
  if (n < 10) return 3
  return 4
}

/** Working sets of the last `weeks` weeks (this one included). */
export async function gatherMuscleHeatSets(today: string = localDateStr(), weeks = MUSCLE_HEAT_WEEKS): Promise<SetRow[]> {
  const start = parseLocalDate(addDays(mondayOf(today), -7 * (weeks - 1))).getTime()
  return db.sets.filter(s => !s.isWarmup && s.completedAt >= start).toArray()
}
