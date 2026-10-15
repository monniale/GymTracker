import { fmtDuration } from './dates'
import type { Exercise, SetRow } from '../types'

/**
 * Cardio sets: time (+ optional distance) instead of weight × reps. A cardio row
 * is a normal SetRow with `durationSec > 0` and `weightKg: 0, reps: 0, e1rm: 0`,
 * so every strength path (points, PRs, PR wall, progression, achievements,
 * quests, muscle volume) already skips it. Cardio earns no rank points (see
 * `cardioBonusPoints`) but a cardio-only workout still counts as a session for
 * the streak and the weekly target.
 */

/** Cardio by the explicit `kind`, else by muscle group (the seeded cardio machines). */
export function isCardioExercise(ex: Pick<Exercise, 'kind' | 'muscleGroup'> | undefined): boolean {
  if (!ex) return false
  return ex.kind ? ex.kind === 'cardio' : ex.muscleGroup === 'cardio'
}

export function isCardioSet(s: Pick<SetRow, 'durationSec'>): boolean {
  return (s.durationSec ?? 0) > 0
}

export interface CardioDraft {
  durationSec: number
  /** Metres; 0 = no distance. */
  distanceM: number
}

/** Prefill for a cardio row: the same position last time, else this session's last row, else the target minutes. */
export function cardioDraft(
  previous: Pick<SetRow, 'durationSec' | 'distanceM'> | undefined,
  targetMin: number,
): CardioDraft {
  if (previous && isCardioSet(previous)) {
    return { durationSec: previous.durationSec!, distanceM: previous.distanceM ?? 0 }
  }
  return { durationSec: Math.max(1, Math.round(targetMin)) * 60, distanceM: 0 }
}

/** The fields of a cardio SetRow (zeroed strength fields keep it out of every strength path). */
export function cardioFields(d: CardioDraft): Pick<SetRow, 'weightKg' | 'reps' | 'e1rm' | 'isWarmup' | 'durationSec' | 'distanceM'> {
  return {
    weightKg: 0,
    reps: 0,
    e1rm: 0,
    isWarmup: false,
    durationSec: Math.max(0, Math.round(d.durationSec)),
    ...(d.distanceM > 0 ? { distanceM: Math.round(d.distanceM) } : { distanceM: undefined }),
  }
}

/** "3.2 km", "800 m". */
export function fmtDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`
  return `${(Math.round(m / 100) / 10).toFixed(1)} km`
}

/** "12:30 · 3.2 km" (the distance only when logged). */
export function fmtCardioSet(s: Partial<Pick<SetRow, 'durationSec' | 'distanceM'>>): string {
  const time = fmtDuration((s.durationSec ?? 0) * 1000)
  return s.distanceM && s.distanceM > 0 ? `${time} · ${fmtDistance(s.distanceM)}` : time
}

/** Seconds per kilometre, or null without a distance. */
export function paceSecPerKm(durationSec: number, distanceM: number | undefined): number | null {
  if (!distanceM || distanceM <= 0 || durationSec <= 0) return null
  return durationSec / (distanceM / 1000)
}

/** "5:12 /km". */
export function fmtPace(secPerKm: number): string {
  return `${fmtDuration(Math.round(secPerKm) * 1000)} /km`
}

/** Total cardio of a workout. */
export function cardioSessionTotals(sets: Pick<SetRow, 'durationSec' | 'distanceM'>[]): {
  sets: number
  durationSec: number
  distanceM: number
} {
  let n = 0
  let durationSec = 0
  let distanceM = 0
  for (const s of sets) {
    if (!isCardioSet(s)) continue
    n++
    durationSec += s.durationSec!
    distanceM += s.distanceM ?? 0
  }
  return { sets: n, durationSec, distanceM }
}

/** Whole minutes for display ("25 min"), at least 1 for any cardio. */
export function cardioMinutes(durationSec: number): number {
  return durationSec > 0 ? Math.max(1, Math.round(durationSec / 60)) : 0
}
