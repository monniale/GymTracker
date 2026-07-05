import type { ExerciseBreakdown } from '../types'

/**
 * All scoring constants in one place.
 *
 * Scientific rationale:
 * - Volume load (sets x reps x weight) is the standard proxy for hypertrophy
 *   stimulus: meta-analyses show a graded dose-response between weekly volume
 *   and muscle growth.
 * - Intensity weighting via % of estimated 1RM: adaptation is load-specific and
 *   very light loads (<30% 1RM) not taken near failure produce minimal
 *   adaptation, so low-intensity volume is discounted instead of counted at
 *   face value. Epley is the standard e1RM estimator, reliable up to ~12 reps.
 * - Progressive-overload bonuses: beating a previous e1RM or session volume is
 *   the operational definition of overload, the mechanism of continued
 *   adaptation. Flat bonuses keep one big lift from dominating the score.
 * - Streak multiplier: adherence/consistency is the best-evidenced predictor of
 *   real-world outcomes, so it scales all points rather than adding a flat sum.
 * - Bodyweight normalization scores relative strength, keeping points
 *   comparable as bodyweight changes.
 * - Caps model the diminishing returns of junk volume and block point farming.
 */
export const SCORING = {
  epleyRepCap: 12,
  repCap: 20,
  sessionBaseCap: 150,
  maxSetsPerExercise: 6,
  maxSetsPerSession: 24,
  prE1rmBonus: 25,
  prE1rmMax: 3,
  prVolBonus: 10,
  prVolMax: 3,
  prBonusCap: 75,
  streakStep: 0.05,
  streakCap: 1.3,
  extraSessionFactor: 0.25,
  /** Input guard: weight above this multiple of bodyweight is treated as a typo. */
  maxWeightBwMult: 3.5,
} as const

/** Epley estimated 1RM; reps capped where the formula stays reliable. */
export function epley(weightKg: number, reps: number): number {
  if (weightKg <= 0 || reps <= 0) return 0
  return weightKg * (1 + Math.min(reps, SCORING.epleyRepCap) / 30)
}

export function intensityMult(relIntensity: number): number {
  if (relIntensity < 0.3) return 0.25
  if (relIntensity < 0.6) return 0.75
  if (relIntensity <= 0.85) return 1.0
  return 1.1
}

export interface ScoreSet {
  exerciseId: number
  weightKg: number
  reps: number
  isWarmup: boolean
}

export interface ScoreInput {
  sets: ScoreSet[]
  bodyweightKg: number
  /** Best e1RM per exercise this season, before this session. */
  priorBestE1rm: Map<number, number>
  /** Best single-session volume per exercise this season, before this session. */
  priorBestVolume: Map<number, number>
  /** Streak value to apply (weeks the weekly session target was met in a row). */
  streakWeeks: number
  isFirstSessionOfDay: boolean
  exerciseNames: Map<number, string>
}

export interface ScoreResult {
  basePoints: number
  prBonus: number
  streakMult: number
  dayFactor: number
  total: number
  breakdown: ExerciseBreakdown[]
}

export function scoreSession(input: ScoreInput): ScoreResult {
  const bw = Math.max(input.bodyweightKg, 30)
  const work = input.sets.filter(s => !s.isWarmup && s.weightKg > 0 && s.reps > 0)

  const byExercise = new Map<number, ScoreSet[]>()
  for (const s of work) {
    const list = byExercise.get(s.exerciseId) ?? []
    list.push(s)
    byExercise.set(s.exerciseId, list)
  }

  const breakdown: ExerciseBreakdown[] = []
  const countedSetPoints: number[] = []
  let e1rmPrs = 0
  let volumePrs = 0

  for (const [exerciseId, sets] of byExercise) {
    const sessionBestE1rm = Math.max(...sets.map(s => epley(s.weightKg, s.reps)))
    const prior = input.priorBestE1rm.get(exerciseId)
    const baseline = prior ?? sessionBestE1rm

    const pointsPerSet = sets
      .map(s => {
        const relInt = baseline > 0 ? s.weightKg / baseline : 0
        return (s.weightKg * Math.min(s.reps, SCORING.repCap) * intensityMult(relInt)) / bw
      })
      .sort((a, b) => b - a)

    const counted = pointsPerSet.slice(0, SCORING.maxSetsPerExercise)
    countedSetPoints.push(...counted)

    const e1rmPr = prior !== undefined && sessionBestE1rm > prior
    if (e1rmPr) e1rmPrs++

    const volume = sets.reduce((acc, s) => acc + s.weightKg * s.reps, 0)
    const priorVol = input.priorBestVolume.get(exerciseId)
    const volumePr = priorVol !== undefined && volume > priorVol
    if (volumePr) volumePrs++

    breakdown.push({
      exerciseId,
      exerciseName: input.exerciseNames.get(exerciseId) ?? 'Exercise',
      setPoints: round1(counted.reduce((a, b) => a + b, 0)),
      countedSets: counted.length,
      totalSets: sets.length,
      e1rmPr,
      volumePr,
      bestE1rm: round1(sessionBestE1rm),
    })
  }

  const topSetPoints = countedSetPoints
    .sort((a, b) => b - a)
    .slice(0, SCORING.maxSetsPerSession)
  const basePoints = round1(Math.min(
    topSetPoints.reduce((a, b) => a + b, 0),
    SCORING.sessionBaseCap,
  ))

  const prBonus = Math.min(
    SCORING.prE1rmBonus * Math.min(e1rmPrs, SCORING.prE1rmMax) +
      SCORING.prVolBonus * Math.min(volumePrs, SCORING.prVolMax),
    SCORING.prBonusCap,
  )

  const streakMult = Math.min(
    1 + SCORING.streakStep * Math.max(0, input.streakWeeks),
    SCORING.streakCap,
  )
  const dayFactor = input.isFirstSessionOfDay ? 1 : SCORING.extraSessionFactor

  const total = Math.round(basePoints * streakMult * dayFactor + prBonus)

  return { basePoints, prBonus, streakMult: round2(streakMult), dayFactor, total, breakdown }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
