import { t, fmtNum } from '../i18n'
import type { SetRow } from '../types'

/**
 * Set types and effort (RPE/RIR). A set's kind is metadata only: drop, failure and AMRAP sets
 * count for points, volume, hard sets, PRs and rep maxes exactly like working sets. Only the
 * progression engine and the AI coach read it. `isWarmup` stays the warm-up source of truth.
 */
export const SET_TYPES = ['working', 'drop', 'failure', 'amrap'] as const

export type SetKind = 'warmup' | 'working' | 'drop' | 'failure' | 'amrap'

/** The kind of a set: warm-up first, then the stored type; absent (or unknown) = working. */
export function setKind(set: Pick<SetRow, 'isWarmup' | 'setType'>): SetKind {
  if (set.isWarmup) return 'warmup'
  const st = set.setType
  return st === 'drop' || st === 'failure' || st === 'amrap' ? st : 'working'
}

export const RPE_MIN = 6
export const RPE_MAX = 10

/** A valid RPE: a finite number clamped to 6–10 and rounded to the nearest 0.5; anything else is undefined. */
export function normalizeRpe(n: unknown): number | undefined {
  if (typeof n !== 'number' || !Number.isFinite(n)) return undefined
  const clamped = Math.min(RPE_MAX, Math.max(RPE_MIN, n))
  return Math.round(clamped * 2) / 2
}

/** Reps in reserve for an RPE (RPE 8 = 2 reps left). */
export function rirOf(rpe: number): number {
  return RPE_MAX - rpe
}

/** Effort label in the chosen scale: "@8" (RPE) or "RIR 2"; '' when not recorded. */
export function fmtEffort(rpe: number | undefined, scale: 'rpe' | 'rir'): string {
  if (rpe === undefined) return ''
  return scale === 'rir' ? `${t('workout.pending.rir')} ${fmtNum(rirOf(rpe))}` : `@${fmtNum(rpe)}`
}

/** The kind's name in the UI language. */
export function setTypeLabel(kind: SetKind): string {
  return t(`workout.setType.${kind}`)
}

/** Short badge for a logged row ("D" / "F" / "A", translated); '' for warm-up and working sets. */
export function setTypeBadge(kind: SetKind): string {
  if (kind === 'drop' || kind === 'failure' || kind === 'amrap') return t(`workout.setType.badge.${kind}`)
  return ''
}

const BRIEFING_BADGE = { drop: 'D', failure: 'F', amrap: 'A' } as const

/** The legend `briefingTag` needs; AI briefings print it once, only when a set carries a tag. */
export const SET_NOTATION_LEGEND = 'Set notation: @n = RPE, D = drop set, F = to failure, A = AMRAP'

/**
 * A set's suffix for AI briefings, always English (stored-data rule, ROUTEMAP invariant 19):
 * "@8" for an RPE, " D" / " F" / " A" for a drop / failure / AMRAP set, both as "@9 F"; '' otherwise.
 */
export function briefingTag(set: Pick<SetRow, 'rpe' | 'setType'> & Partial<Pick<SetRow, 'isWarmup'>>): string {
  const rpe = normalizeRpe(set.rpe)
  const kind = setKind({ isWarmup: set.isWarmup ?? false, setType: set.setType })
  const badge = kind === 'drop' || kind === 'failure' || kind === 'amrap' ? ` ${BRIEFING_BADGE[kind]}` : ''
  return `${rpe !== undefined ? `@${rpe}` : ''}${badge}`
}
