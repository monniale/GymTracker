import { epley, type ScoreSet } from './scoring'
import { isCardioExercise, isCardioSet } from './cardio'
import { t, fmtNum } from '../i18n'
import type { Exercise, Id, Session, SetRow } from '../types'

/**
 * Load of a set: the kg that scoring, PRs, rep maxes and volume read.
 *
 * Forward-only, stamped: on a session with `bwScoring` (created by a build with
 * this module), a bodyweight exercise's load is
 * `bodyweightKg × bwFactor + weightKg`, where `weightKg` is the ADDED kg
 * (negative = assisted). Every other set, and every set of an older unstamped
 * session, keeps load = `weightKg`, so re-scoring an old workout reproduces its
 * old numbers. Cardio rows are never weighted.
 */

/** Seed catalog names (nameLower) → fraction of bodyweight moved. */
const SEED_BW_FACTORS: Record<string, number> = {
  'pull-up': 1.0,
  'chin-up': 1.0,
  'dips': 1.0,
  'inverted row': 1.0,
  'push-up': 0.64,
  'back extension': 0.3,
  'plank': 0.3,
  'crunch': 0.3,
  'hanging leg raise': 0.3,
  'russian twist': 0.3,
  'ab wheel rollout': 0.3,
}

/** Fallback by name for custom and library exercises (English stems, plus common Italian ones). */
const BW_FACTOR_RULES: [RegExp, number][] = [
  [/\b(pull|chin|row|dip|trazion|parallele)/, 1.0],
  [/\b(push|flession|piegament)/, 0.64],
  [/\b(squat|lunge|step|pistol|affond)/, 0.85],
  [/\b(crunch|sit|raise|twist|plank|extension|rollout|addominal)/, 0.3],
]

/** Default fraction of bodyweight a bodyweight move lifts, by name (1.0 when nothing matches). */
export function defaultBwFactor(ex: Pick<Exercise, 'nameLower' | 'equipment'>): number {
  const name = ex.nameLower.trim()
  const seeded = SEED_BW_FACTORS[name]
  if (seeded !== undefined) return seeded
  for (const [re, factor] of BW_FACTOR_RULES) if (re.test(name)) return factor
  return 1.0
}

/** The exercise's own factor when set (finite, > 0), else the default by name. */
export function bwFactorOf(ex: Pick<Exercise, 'nameLower' | 'equipment' | 'bwFactor'>): number {
  const f = ex.bwFactor
  return f !== undefined && Number.isFinite(f) && f > 0 ? f : defaultBwFactor(ex)
}

/** True when this exercise's sets in this session are bodyweight load (weightKg = added kg). */
export function usesBodyweightLoad(
  ex: Exercise | undefined,
  session: Pick<Session, 'bwScoring'> | undefined,
): boolean {
  return session?.bwScoring === true && ex?.equipment === 'bodyweight' && !isCardioExercise(ex)
}

/**
 * The set's load in kg: `weightKg`, or for a bodyweight exercise on a stamped
 * session `bodyweightKg × factor + weightKg`, rounded to 0.1. Never below 0 on
 * either path: an assisted row (negative added kg) whose exercise later stopped
 * being a bodyweight move must not subtract kg from a volume sum. Rows from
 * older builds are never negative, so their loads are unchanged.
 */
export function effectiveLoad(
  set: Pick<SetRow, 'weightKg' | 'durationSec'>,
  ex: Exercise | undefined,
  session: Pick<Session, 'bodyweightKg' | 'bwScoring'> | undefined,
): number {
  if (!ex || !session || !usesBodyweightLoad(ex, session) || isCardioSet(set)) return Math.max(0, set.weightKg)
  const load = session.bodyweightKg * bwFactorOf(ex) + set.weightKg
  return Math.max(0, Math.round(load * 10) / 10)
}

/** Epley e1RM of the set's load: the value stored in `SetRow.e1rm`. */
export function setE1rm(
  set: Pick<SetRow, 'weightKg' | 'reps' | 'durationSec'>,
  ex: Exercise | undefined,
  session: Pick<Session, 'bodyweightKg' | 'bwScoring'> | undefined,
): number {
  return epley(effectiveLoad(set, ex, session), set.reps)
}

/** A session's sets as scoring input, with `loadKg` filled from `effectiveLoad`. */
export function toScoreSets(
  sets: SetRow[],
  exMap: Map<Id, Exercise>,
  session: Pick<Session, 'bodyweightKg' | 'bwScoring'>,
): ScoreSet[] {
  return sets.map(s => ({
    exerciseId: s.exerciseId,
    weightKg: s.weightKg,
    reps: s.reps,
    isWarmup: s.isWarmup,
    durationSec: s.durationSec,
    loadKg: effectiveLoad(s, exMap.get(s.exerciseId), session),
  }))
}

/**
 * A logged strength set for display: "80 kg × 8", or with bodyweight load
 * "BW × 12" / "BW+10 kg × 8" / "BW−20 kg × 6" (weightKg = added kg).
 */
export function fmtSetLoad(set: Pick<SetRow, 'weightKg' | 'reps'>, bodyweightLoad: boolean): string {
  const w = set.weightKg
  if (!bodyweightLoad) return `${fmtNum(w)} kg × ${set.reps}`
  const load = w > 0
    ? t('workout.shared.bwPlus', { kg: fmtNum(w) })
    : w < 0
      ? t('workout.shared.bwMinus', { kg: fmtNum(-w) })
      : t('workout.shared.bw')
  return `${load} × ${set.reps}`
}

/** Sets from several sessions with their `loadKg` (each set reads its own session). */
export function withLoads<S extends SetRow>(
  sets: S[],
  exMap: Map<Id, Exercise>,
  sessionsById: Map<Id, Session>,
): (S & { loadKg: number })[] {
  return sets.map(s => ({
    ...s,
    loadKg: effectiveLoad(s, exMap.get(s.exerciseId), sessionsById.get(s.sessionId)),
  }))
}
