/**
 * Strength standards as bodyweight multipliers of e1RM, approximating commonly
 * published strength-level norms (strengthlevel.com-style) for adult males.
 * Thresholds: [Novice, Intermediate, Advanced, Elite] — below Novice is
 * "Untrained". Rough by nature; used for motivation, not diagnosis.
 */

export const LEVELS = ['Untrained', 'Novice', 'Intermediate', 'Advanced', 'Elite'] as const

interface LiftStandard {
  key: string
  /** exact nameLower matches from the exercise library */
  names: string[]
  thresholds: [number, number, number, number]
}

export const LIFT_STANDARDS: LiftStandard[] = [
  { key: 'bench', names: ['bench press'], thresholds: [0.75, 1.0, 1.5, 2.0] },
  { key: 'squat', names: ['squat'], thresholds: [1.0, 1.25, 1.75, 2.25] },
  { key: 'deadlift', names: ['deadlift'], thresholds: [1.25, 1.5, 2.0, 2.5] },
  { key: 'ohp', names: ['overhead press'], thresholds: [0.5, 0.7, 0.9, 1.15] },
  { key: 'row', names: ['barbell row'], thresholds: [0.65, 0.9, 1.2, 1.5] },
]

export function standardFor(nameLower: string): LiftStandard | null {
  return LIFT_STANDARDS.find(s => s.names.includes(nameLower)) ?? null
}

export interface LevelInfo {
  level: (typeof LEVELS)[number]
  index: number
  ratio: number
  /** 0..1 progress from current level threshold to the next (1 at Elite). */
  progress: number
  next: (typeof LEVELS)[number] | null
}

export function levelFor(e1rm: number, bodyweightKg: number, std: LiftStandard): LevelInfo {
  const ratio = bodyweightKg > 0 ? e1rm / bodyweightKg : 0
  let index = 0
  for (let i = 0; i < std.thresholds.length; i++) {
    if (ratio >= std.thresholds[i]) index = i + 1
  }
  const lower = index === 0 ? 0 : std.thresholds[index - 1]
  const upper = index < std.thresholds.length ? std.thresholds[index] : null
  return {
    level: LEVELS[index],
    index,
    ratio: Math.round(ratio * 100) / 100,
    progress: upper === null ? 1 : Math.min(1, (ratio - lower) / (upper - lower)),
    next: index < LEVELS.length - 1 ? LEVELS[index + 1] : null,
  }
}
