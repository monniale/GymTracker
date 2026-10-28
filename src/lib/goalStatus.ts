import {
  GOAL_REACHED_KG, ageFrom, bmrMifflin, effectiveRateKgPerWeek, goalEta, listedRate, plannedRateKgPerWeek,
  tdee as tdeeOf,
} from './tdee'
import { weeklyRate } from './bodyweight'
import type { BodyLogEntry, Settings } from '../types'

/**
 * The goal-weight stat on Progress › Bodyweight (pure: no db, no i18n).
 *
 * The ETA uses the observed 4-week rate (`weeklyRate`) whenever it moves toward
 * the goal (a trend too slow to get there within two years is `far`, never
 * swapped for the planned rate), else the planned rate from
 * `settings.goalRatePctPerWeek`. The planned rate's direction always follows
 * goal vs current weight and its magnitude is the picked rate when it is one of
 * the choices for that direction (`listedRate`, the same rule the goal sheet
 * highlights), else none: a stored sign gone stale after the weight crossed the
 * goal never reads as "not on track" on its own. With the calculator profile
 * saved (sex, birth year, height, activity) the planned rate is the one the kcal
 * targets can deliver (`effectiveRateKgPerWeek`: the deficit floor or surplus cap
 * can slow it). "Reached" uses the shared `GOAL_REACHED_KG` from tdee.ts.
 */

export type GoalStatus =
  | { kind: 'none' }
  | { kind: 'reached'; goalKg: number }
  | { kind: 'eta'; goalKg: number; weeks: number; rateKgPerWeek: number; source: 'observed' | 'planned' }
  | { kind: 'offTrack'; goalKg: number }
  /** Heading there, but more than two years away at the rate used. */
  | { kind: 'far'; goalKg: number }

export function goalStatus(
  entries: BodyLogEntry[],
  settings: Pick<Settings, 'bodyweightKg' | 'goalWeightKg' | 'goalRatePctPerWeek'>
    & Partial<Pick<Settings, 'sex' | 'birthYear' | 'heightCm' | 'activity'>>,
  today: string,
): GoalStatus {
  const goalKg = settings.goalWeightKg
  if (goalKg === undefined || !Number.isFinite(goalKg)) return { kind: 'none' }
  const newest = entries.reduce<BodyLogEntry | undefined>((m, e) => (!m || e.date > m.date ? e : m), undefined)
  const current = newest?.weightKg ?? settings.bodyweightKg
  const diff = goalKg - current
  if (Math.abs(diff) < GOAL_REACHED_KG) return { kind: 'reached', goalKg }
  const dir = Math.sign(diff)

  const observed = weeklyRate(entries, today)
  if (observed !== null && observed !== 0 && Math.sign(observed) === dir) {
    const weeks = goalEta(current, goalKg, observed)
    return weeks === null
      ? { kind: 'far', goalKg }
      : { kind: 'eta', goalKg, weeks, rateKgPerWeek: observed, source: 'observed' }
  }
  const pct = listedRate(dir < 0 ? 'lose' : 'gain', settings.goalRatePctPerWeek) ?? 0
  const planned = plannedRate(current, pct * dir, settings, today)
  if (planned === 0) return { kind: 'offTrack', goalKg }
  const weeks = goalEta(current, goalKg, planned)
  return weeks === null
    ? { kind: 'far', goalKg }
    : { kind: 'eta', goalKg, weeks, rateKgPerWeek: planned, source: 'planned' }
}

/** Planned kg/week at `pct`: what the kcal targets deliver when the profile is saved, else the plain rate. */
function plannedRate(
  weightKg: number,
  pct: number,
  s: Partial<Pick<Settings, 'sex' | 'birthYear' | 'heightCm' | 'activity'>>,
  today: string,
): number {
  if (pct === 0 || !s.sex || !s.birthYear || !s.heightCm || !s.activity) return plannedRateKgPerWeek(weightKg, pct)
  const bmr = bmrMifflin({ sex: s.sex, ageYears: ageFrom(s.birthYear, today), heightCm: s.heightCm, weightKg })
  return effectiveRateKgPerWeek({ tdee: tdeeOf(bmr, s.activity), bmr, weightKg, goalRatePctPerWeek: pct })
}
