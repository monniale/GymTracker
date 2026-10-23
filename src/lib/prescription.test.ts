import { describe, it, expect } from 'vitest'
import {
  prescribedSets, applyOutcome, deriveTrainingMax, schemeLabel, currentWeek, cycleStartOf, amrapReps,
  lineForPrescription, type PrescriptionCtx,
} from './prescription'
import { epley } from './scoring'
import type { Exercise, PrescribedSet, ProgressionScheme, SetRow, TemplateItem } from '../types'

const squat: Exercise = {
  id: 1, name: 'Squat', nameLower: 'squat', muscleGroup: 'legs', equipment: 'barbell',
  defaultRestSec: 180, isCustom: false,
}
const pullUp: Exercise = {
  id: 2, name: 'Pull-Up', nameLower: 'pull-up', muscleGroup: 'back', equipment: 'bodyweight',
  defaultRestSec: 120, isCustom: false, bwFactor: 1,
}
const ctx: PrescriptionCtx = { week: 1, bodyweightKg: 80, barKg: 20, bodyweightLoad: false }
const bwCtx: PrescriptionCtx = { ...ctx, bodyweightLoad: true }

const item = (over: Partial<TemplateItem> = {}): TemplateItem => ({ exerciseId: 1, targetSets: 3, targetReps: 5, ...over })

/** Logged sets for `applyOutcome`: [weightKg, reps, setType?] in set order. */
function logged(rows: [number, number, SetRow['setType']?][], warmups: [number, number][] = []): SetRow[] {
  const w: SetRow[] = warmups.map(([weightKg, reps], i) => ({
    sessionId: 's', exerciseId: 1, setNumber: i + 1, weightKg, reps, isWarmup: true, completedAt: i, e1rm: epley(weightKg, reps),
  }))
  return [...w, ...rows.map(([weightKg, reps, setType], i) => ({
    sessionId: 's', exerciseId: 1, setNumber: warmups.length + i + 1, weightKg, reps, isWarmup: false,
    completedAt: 100 + i, e1rm: epley(weightKg, reps), ...(setType ? { setType } : {}),
  }))]
}
const oc = (sessionId = 's1', week = 1, cycleWeeks?: number, cycleStart?: string) => ({ sessionId, week, cycleWeeks, cycleStart })
/** A percent label as rendered: no-break spaces inside each set token, ' · ' the only break point. */
const nb = (label: string) => label.replace(/ % /g, '\u00a0%\u00a0')

const LINEAR: ProgressionScheme = { kind: 'linear', stepKg: 2.5, failsToDeload: 3, deloadPct: 0.1 }
const GZCLP_T1: ProgressionScheme = {
  kind: 'linear', stepKg: 5, failsToDeload: 1, deloadPct: 0.15,
  stages: [{ sets: 5, reps: 3, amrapLast: true }, { sets: 6, reps: 2, amrapLast: true }, { sets: 10, reps: 1, amrapLast: true }],
}
const P = (pct: number, reps: number, amrap = false): PrescribedSet => ({ pct, reps, ...(amrap ? { amrap } : {}) })
const W531: PrescribedSet[][] = [
  [P(0.65, 5), P(0.75, 5), P(0.85, 5, true)],
  [P(0.70, 3), P(0.80, 3), P(0.90, 3, true)],
  [P(0.75, 5), P(0.85, 3), P(0.95, 1, true)],
  [P(0.40, 5), P(0.50, 5), P(0.60, 5)],
]
const PCT_531: ProgressionScheme = { kind: 'percent', basis: 'tm', tmStepKg: 5 }
const NSUNS: ProgressionScheme = {
  kind: 'percent', basis: 'tm', tmStepKg: 0,
  tmBumpByReps: [{ minReps: 0, kg: 0 }, { minReps: 2, kg: 2.5 }, { minReps: 4, kg: 5 }],
}
// nSuns T1 bench: 1+ set at 95 % (index 2) and a final 65 % 8+ set.
const NSUNS_SETS: PrescribedSet[] = [P(0.75, 5), P(0.85, 3), P(0.95, 1, true), P(0.9, 3), P(0.85, 3), P(0.8, 3), P(0.75, 5), P(0.7, 5), P(0.65, 8, true)]

describe('prescribedSets: double progression', () => {
  it('is null for a plain double item (today’s history prefill applies)', () => {
    expect(prescribedSets(item(), squat, [{ weightKg: 100, reps: 5 }], ctx)).toBeNull()
    expect(prescribedSets(item({ scheme: { kind: 'double' } }), squat, [], ctx)).toBeNull()
    expect(prescribedSets(item({ targetRepsMax: 5 }), squat, [], ctx)).toBeNull()
  })

  it('rep range: reps climb to the top of the range, then the weight goes up and reps reset', () => {
    const it8 = item({ targetReps: 8, targetRepsMax: 12 })
    const mid = prescribedSets(it8, squat, [{ weightKg: 60, reps: 10 }, { weightKg: 60, reps: 9 }, { weightKg: 60, reps: 9 }], ctx)!
    expect(mid.sets).toEqual([{ weightKg: 60, reps: 10 }, { weightKg: 60, reps: 10 }, { weightKg: 60, reps: 10 }])
    expect(mid).toMatchObject({ label: '8–12 reps', fixed: false })

    // At 8 the plain rule would already add weight; the range keeps climbing.
    const atMin = prescribedSets(it8, squat, [{ weightKg: 60, reps: 8 }, { weightKg: 60, reps: 8 }], ctx)!
    expect(atMin.sets[0]).toEqual({ weightKg: 60, reps: 9 })

    const top = prescribedSets(it8, squat, [{ weightKg: 60, reps: 12 }, { weightKg: 60, reps: 12 }, { weightKg: 60, reps: 12 }], ctx)!
    expect(top.sets[0]).toEqual({ weightKg: 62.5, reps: 8 })
  })

  it('rep range without history: no weight known, the label still shows', () => {
    expect(prescribedSets(item({ targetReps: 8, targetRepsMax: 12 }), squat, [], ctx)).toEqual({ sets: [], label: '8–12 reps', fixed: false })
  })

  it('rep range on a bodyweight move: added kg starts at 0 and grows by at most 1.25 kg', () => {
    const x = item({ exerciseId: 2, targetReps: 6, targetRepsMax: 10 })
    expect(prescribedSets(x, pullUp, [], bwCtx)!.sets[0]).toEqual({ weightKg: 0, reps: 6 })
    const up = prescribedSets(x, pullUp, [{ weightKg: 0, reps: 10 }, { weightKg: 0, reps: 10 }, { weightKg: 0, reps: 10 }], bwCtx)!
    expect(up.sets[0]).toEqual({ weightKg: 1.25, reps: 6 })
  })
})

describe('prescribedSets: linear', () => {
  it('starts from progress.nextWeightKg, else the last top weight, with fixed sets', () => {
    const fromHistory = prescribedSets(item({ scheme: LINEAR }), squat, [{ weightKg: 100, reps: 5 }, { weightKg: 60, reps: 5, setType: 'drop' }], ctx)!
    expect(fromHistory).toMatchObject({ fixed: true, label: 'Linear +2.5 kg' })
    expect(fromHistory.sets).toEqual([{ weightKg: 100, reps: 5 }, { weightKg: 100, reps: 5 }, { weightKg: 100, reps: 5 }])

    const fromProgress = prescribedSets(item({ scheme: LINEAR, progress: { failStreak: 0, nextWeightKg: 102.5 } }), squat, [{ weightKg: 100, reps: 5 }], ctx)!
    expect(fromProgress.sets.map(s => s.weightKg)).toEqual([102.5, 102.5, 102.5])
  })

  it('no history and no progress: empty sets, label kept', () => {
    expect(prescribedSets(item({ scheme: LINEAR }), squat, [], ctx)).toEqual({ sets: [], label: 'Linear +2.5 kg', fixed: true })
  })

  it('explicit sets keep their reps and AMRAP flag (Reddit PPL 4×5, 1×5+)', () => {
    const sets = [{ reps: 5 }, { reps: 5 }, { reps: 5 }, { reps: 5 }, { reps: 5, amrap: true }]
    const plan = prescribedSets(item({ scheme: LINEAR, sets }), squat, [{ weightKg: 80, reps: 5 }], ctx)!
    expect(plan.sets).toHaveLength(5)
    expect(plan.sets[4]).toEqual({ weightKg: 80, reps: 5, amrap: true })
    expect(plan.sets[0].amrap).toBeUndefined()
  })

  it('stages: the current stage’s sets × reps with the last set AMRAP', () => {
    const s1 = prescribedSets(item({ scheme: GZCLP_T1, progress: { failStreak: 0, stage: 1, nextWeightKg: 100 } }), squat, [], ctx)!
    expect(s1.label).toBe('Stage 2/3 · 6×2+')
    expect(s1.sets).toHaveLength(6)
    expect(s1.sets.every(s => s.weightKg === 100 && s.reps === 2)).toBe(true)
    expect(s1.sets.map(s => !!s.amrap)).toEqual([false, false, false, false, false, true])
  })

  it('bodyweight move: added kg, 0 without history', () => {
    const plan = prescribedSets(item({ exerciseId: 2, scheme: LINEAR }), pullUp, [], bwCtx)!
    expect(plan.sets.map(s => s.weightKg)).toEqual([0, 0, 0])
  })
})

describe('applyOutcome: linear', () => {
  const lin = item({ scheme: LINEAR })

  it('pass: every work set reached its reps → +stepKg, warm-ups and drop sets ignored', () => {
    const r = applyOutcome(lin, squat, logged([[100, 5], [100, 5], [100, 6], [70, 3, 'drop']], [[20, 10], [60, 3]]), oc())
    expect(r).toEqual({ progress: { failStreak: 0, lastOutcome: 'pass', lastSessionId: 's1', nextWeightKg: 102.5 } })
  })

  it('fail: failStreak + 1 at the same weight; the third fail deloads by deloadPct', () => {
    const r1 = applyOutcome(lin, squat, logged([[100, 5], [100, 5], [100, 3]]), oc('a'))
    expect(r1.progress).toEqual({ failStreak: 1, lastOutcome: 'fail', lastSessionId: 'a', nextWeightKg: 100 })
    const r2 = applyOutcome({ ...lin, progress: r1.progress }, squat, logged([[100, 5], [100, 4]]), oc('b'))
    expect(r2.progress).toMatchObject({ failStreak: 2, lastOutcome: 'fail', nextWeightKg: 100 })
    const r3 = applyOutcome({ ...lin, progress: r2.progress }, squat, logged([[100, 4], [100, 4], [100, 4]]), oc('c'))
    expect(r3.progress).toEqual({ failStreak: 0, lastOutcome: 'deload', lastSessionId: 'c', nextWeightKg: 90 })
  })

  it('deload snaps to a loadable 2.5 kg', () => {
    const r = applyOutcome({ ...lin, progress: { failStreak: 2 } }, squat, logged([[102.5, 2]]), oc())
    expect(r.progress.nextWeightKg).toBe(92.5)
  })

  it('a pass resets the fail streak', () => {
    const r = applyOutcome({ ...lin, progress: { failStreak: 2, nextWeightKg: 100 } }, squat, logged([[100, 5], [100, 5], [100, 5]]), oc())
    expect(r.progress).toMatchObject({ failStreak: 0, lastOutcome: 'pass', nextWeightKg: 102.5 })
  })

  it('fewer work sets than prescribed is a fail', () => {
    expect(applyOutcome(lin, squat, logged([[100, 5], [100, 5]]), oc()).progress.lastOutcome).toBe('fail')
  })

  it('the same session twice, or no work set, leaves the progress untouched', () => {
    const progress = { failStreak: 1, lastSessionId: 's1', nextWeightKg: 100 }
    const same = applyOutcome({ ...lin, progress }, squat, logged([[100, 5], [100, 5], [100, 5]]), oc('s1'))
    expect(same.progress).toBe(progress)
    expect(same.trainingMaxKg).toBeUndefined()
    const none = applyOutcome({ ...lin, progress }, squat, logged([], [[60, 5]]), oc('s2'))
    expect(none.progress).toBe(progress)
    expect(applyOutcome(lin, squat, [], oc()).progress).toEqual({ failStreak: 0 })
  })

  it('bodyweight move: step capped at 1.25 kg, assisted kg deload adds assistance', () => {
    const x = item({ exerciseId: 2, scheme: LINEAR })
    expect(applyOutcome(x, pullUp, logged([[0, 5], [0, 5], [0, 5]]), oc()).progress.nextWeightKg).toBe(1.25)
    const assisted = applyOutcome({ ...x, progress: { failStreak: 2 } }, pullUp, logged([[-20, 3]]), oc())
    expect(assisted.progress).toMatchObject({ lastOutcome: 'deload', nextWeightKg: -22.5 })
  })
})

describe('applyOutcome: GZCLP T1 stages 5×3 → 6×2 → 10×1', () => {
  const t1 = (progress?: TemplateItem['progress']) => item({ scheme: GZCLP_T1, progress })

  it('pass at a stage adds the step and stays there', () => {
    const r = applyOutcome(t1({ failStreak: 0, stage: 0, nextWeightKg: 100 }), squat, logged([[100, 3], [100, 3], [100, 3], [100, 3], [100, 5]]), oc())
    expect(r.progress).toEqual({ failStreak: 0, lastOutcome: 'pass', lastSessionId: 's1', nextWeightKg: 105, stage: 0 })
  })

  it('fail moves to the next stage at the same weight, the last stage restarts at ×(1 − deloadPct)', () => {
    const f1 = applyOutcome(t1({ failStreak: 0, stage: 0, nextWeightKg: 100 }), squat, logged([[100, 3], [100, 3], [100, 3], [100, 2], [100, 2]]), oc('a'))
    expect(f1.progress).toMatchObject({ stage: 1, nextWeightKg: 100, lastOutcome: 'fail', failStreak: 0 })
    expect(schemeLabel(t1(f1.progress))).toBe('Stage 2/3 · 6×2+')

    const f2 = applyOutcome(t1(f1.progress), squat, logged([[100, 2], [100, 2], [100, 2], [100, 2], [100, 1], [100, 1]]), oc('b'))
    expect(f2.progress).toMatchObject({ stage: 2, nextWeightKg: 100, lastOutcome: 'fail' })
    expect(prescribedSets(t1(f2.progress), squat, [], ctx)!.sets).toHaveLength(10)

    const ten = Array.from({ length: 10 }, (_, i): [number, number] => [100, i < 7 ? 1 : 0])
    const f3 = applyOutcome(t1(f2.progress), squat, logged(ten.filter(r => r[1] > 0)), oc('c'))
    expect(f3.progress).toEqual({ failStreak: 0, lastOutcome: 'deload', lastSessionId: 'c', stage: 0, nextWeightKg: 85 })
    expect(schemeLabel(t1(f3.progress))).toBe('Stage 1/3 · 5×3+')
  })
})

describe('percent scheme (5/3/1, TM 100)', () => {
  const tmSquat: Exercise = { ...squat, trainingMaxKg: 100 }
  const main = item({ scheme: PCT_531, setsByWeek: W531 })
  const weights = (week: number) => prescribedSets(main, tmSquat, [], { ...ctx, week })!.sets.map(s => s.weightKg)

  it('weeks 1-4: 65/75/85, 70/80/90, 75/85/95, deload 40/50/60, then the cycle repeats', () => {
    expect(weights(1)).toEqual([65, 75, 85])
    expect(weights(2)).toEqual([70, 80, 90])
    expect(weights(3)).toEqual([75, 85, 95])
    expect(weights(4)).toEqual([40, 50, 60])
    expect(weights(5)).toEqual([65, 75, 85])
  })

  it('carries pct, reps and the AMRAP flag, fixed, with the week’s label', () => {
    const plan = prescribedSets(main, tmSquat, [], { ...ctx, week: 3 })!
    expect(plan.sets).toEqual([
      { weightKg: 75, reps: 5, pct: 0.75 },
      { weightKg: 85, reps: 3, pct: 0.85 },
      { weightKg: 95, reps: 1, pct: 0.95, amrap: true },
    ])
    expect(plan.fixed).toBe(true)
    expect(plan.label).toBe(nb('75 % ×5 · 85 % ×3 · 95 % ×1+'))
    // A line can only wrap between set tokens, never inside one.
    expect(plan.label.split(' ')).toEqual(['75\u00a0%\u00a0×5', '·', '85\u00a0%\u00a0×3', '·', '95\u00a0%\u00a0×1+'])
    expect(schemeLabel(main)).toBe(nb('65 % ×5 · 75 % ×5 · 85 % ×5+'))
  })

  it('rounds to a loadable 2.5 kg and never below the bar', () => {
    const odd = { ...squat, trainingMaxKg: 117.5 }
    expect(prescribedSets(main, odd, [], ctx)!.sets.map(s => s.weightKg)).toEqual([77.5, 87.5, 100])
    const light = { ...squat, trainingMaxKg: 30 }
    expect(prescribedSets(main, light, [], { ...ctx, week: 4 })!.sets.map(s => s.weightKg)).toEqual([20, 20, 20])
  })

  it('BBB constant sets: 5×10 at 50 %, label folded', () => {
    const bbb = item({ scheme: { ...PCT_531, tmStepKg: 0 }, sets: Array.from({ length: 5 }, () => P(0.5, 10)) })
    const plan = prescribedSets(bbb, tmSquat, [], { ...ctx, week: 3 })!
    expect(plan.sets.map(s => s.weightKg)).toEqual([50, 50, 50, 50, 50])
    expect(plan.label).toBe(nb('50 % 5×10'))
  })

  it('no training max: empty sets with a label telling to set one', () => {
    expect(prescribedSets(main, squat, [{ weightKg: 100, reps: 5 }], ctx)).toEqual({ sets: [], label: 'Set a training max', fixed: true })
  })

  it('no sets at all: null', () => {
    expect(prescribedSets(item({ scheme: PCT_531 }), tmSquat, [], ctx)).toBeNull()
  })

  it('fixed TM bump after the last week of the cycle only', () => {
    const sets = logged([[65, 5], [75, 5], [85, 8]])
    expect(applyOutcome(main, tmSquat, sets, oc('w1', 1, 4))).toEqual({
      progress: { failStreak: 0, lastOutcome: 'pass', lastSessionId: 'w1' },
    })
    expect(applyOutcome(main, tmSquat, sets, oc('w3', 3, 4)).trainingMaxKg).toBeUndefined()
    const w4 = applyOutcome(main, tmSquat, logged([[40, 5], [50, 5], [60, 5]]), oc('w4', 4, 4))
    expect(w4.trainingMaxKg).toBe(105)
    expect(applyOutcome(main, squat, sets, oc('x', 4, 4)).trainingMaxKg).toBeUndefined()
  })

  it('a missed set is a fail', () => {
    expect(applyOutcome(main, tmSquat, logged([[65, 5], [75, 4], [85, 5]]), oc()).progress).toMatchObject({ lastOutcome: 'fail', failStreak: 1 })
  })

  it('the fixed bump needs every set done', () => {
    const missed = applyOutcome(main, tmSquat, logged([[40, 5], [50, 5], [60, 3]]), oc('w4', 4, 4))
    expect(missed.trainingMaxKg).toBeUndefined()
    expect(missed.progress.lastOutcome).toBe('fail')
    // nSuns T2: a one-week cycle, so the bump is weekly, but never on a failed session.
    const t2 = item({ scheme: { ...PCT_531, tmStepKg: 2.5 }, sets: [P(0.5, 6), P(0.6, 5)] })
    expect(applyOutcome(t2, tmSquat, logged([[50, 1]]), oc('a', 1, 1)).trainingMaxKg).toBeUndefined()
    expect(applyOutcome(t2, tmSquat, logged([[50, 6], [60, 5]]), oc('b', 1, 1)).trainingMaxKg).toBe(102.5)
  })

  it('bumps at most once per cycle: a second week-4 workout keeps the TM', () => {
    const deload = logged([[40, 5], [50, 5], [60, 5]])
    const first = applyOutcome(main, tmSquat, deload, oc('w4a', 4, 4, '2026-09-28'))
    expect(first).toMatchObject({ trainingMaxKg: 105, progress: { tmCycle: '2026-09-28', lastSessionId: 'w4a' } })
    const again = applyOutcome({ ...main, progress: first.progress }, { ...tmSquat, trainingMaxKg: 105 }, deload, oc('w4b', 4, 4, '2026-09-28'))
    expect(again.trainingMaxKg).toBeUndefined()
    expect(again.progress).toMatchObject({ lastSessionId: 'w4b', tmCycle: '2026-09-28' })
    // The next cycle's week 1 carries the key; its week 4 bumps again.
    const w1 = applyOutcome({ ...main, progress: again.progress }, tmSquat, logged([[65, 5], [75, 5], [85, 6]]), oc('n1', 1, 4, '2026-10-26'))
    expect(w1.progress.tmCycle).toBe('2026-09-28')
    expect(applyOutcome({ ...main, progress: w1.progress }, tmSquat, deload, oc('n4', 4, 4, '2026-10-26')).trainingMaxKg).toBe(105)
  })

  it('bodyweight move: TM is the full load, the plan is added kg', () => {
    const tmPull: Exercise = { ...pullUp, trainingMaxKg: 120 }
    const plan = prescribedSets(item({ exerciseId: 2, scheme: PCT_531, setsByWeek: W531 }), tmPull, [], { ...bwCtx, week: 3 })!
    // 0.75/0.85/0.95 × 120 = 90/102/114 load − 80 kg bodyweight → 10, 22 (rounded to 1.25: 22.5), 34 (33.75)
    expect(plan.sets.map(s => s.weightKg)).toEqual([10, 22.5, 33.75])
    const assisted = prescribedSets(item({ exerciseId: 2, scheme: PCT_531, setsByWeek: W531 }), { ...pullUp, trainingMaxKg: 80 }, [], { ...bwCtx, week: 4 })!
    expect(assisted.sets.map(s => s.weightKg)).toEqual([-47.5, -40, -32.5])
  })
})

describe('percent scheme: nSuns TM bump by AMRAP reps', () => {
  const tmBench: Exercise = { ...squat, id: 3, name: 'Bench Press', nameLower: 'bench press', trainingMaxKg: 100 }
  const t1 = item({ exerciseId: 3, scheme: NSUNS, sets: NSUNS_SETS })
  const rows = (amrapReps1: number, typed = false): SetRow[] => logged(NSUNS_SETS.map((p, i): [number, number, SetRow['setType']?] => [
    Math.round(p.pct! * 100),
    i === 2 ? amrapReps1 : i === 8 ? 12 : p.reps,
    typed && p.amrap ? 'amrap' : undefined,
  ]))

  it.each([[1, undefined], [2, 102.5], [3, 102.5], [4, 105], [6, 105]])('%i reps on the 1+ set → TM %s', (reps, tm) => {
    expect(applyOutcome(t1, tmBench, rows(reps), oc()).trainingMaxKg).toBe(tm)
  })

  it('records pass when the TM grows, fail when it does not', () => {
    expect(applyOutcome(t1, tmBench, rows(4), oc()).progress.lastOutcome).toBe('pass')
    expect(applyOutcome(t1, tmBench, rows(1), oc()).progress.lastOutcome).toBe('fail')
  })

  it('positional: the prescribed AMRAP with the highest % (the 1+ set, not the last 8+ set)', () => {
    const work = rows(3)
    expect(amrapReps(work.filter(s => !s.isWarmup), NSUNS_SETS)).toBe(3)
  })

  it('setType amrap wins over the position', () => {
    // The 1+ set was logged as the 4th set: the position would read 3 reps (the 90 % set).
    const plan: PrescribedSet[] = [P(0.75, 5), P(0.85, 3), P(0.95, 1, true), P(0.9, 3)]
    const x = item({ exerciseId: 3, scheme: NSUNS, sets: plan })
    const typed = logged([[75, 5], [85, 3], [90, 3], [95, 5, 'amrap']])
    expect(applyOutcome(x, tmBench, typed, oc()).trainingMaxKg).toBe(105)
    const untyped = logged([[75, 5], [85, 3], [90, 3], [95, 5]])
    expect(applyOutcome(x, tmBench, untyped, oc()).trainingMaxKg).toBe(102.5)
    expect(applyOutcome(t1, tmBench, rows(4, true), oc()).trainingMaxKg).toBe(105)
  })

  it('no TM: outcome recorded, no TM written', () => {
    expect(applyOutcome(t1, { ...tmBench, trainingMaxKg: undefined }, rows(5), oc()).trainingMaxKg).toBeUndefined()
  })
})

describe('applyOutcome: double', () => {
  it('records a pass only when every top set reached the top of the range', () => {
    const r = item({ targetReps: 8, targetRepsMax: 12 })
    expect(applyOutcome(r, squat, logged([[60, 12], [60, 12]]), oc()).progress).toEqual({ failStreak: 0, lastOutcome: 'pass', lastSessionId: 's1' })
    expect(applyOutcome(r, squat, logged([[60, 12], [60, 10]]), oc()).progress).toEqual({ failStreak: 0, lastSessionId: 's1' })
    expect(applyOutcome(r, squat, logged([[60, 12]]), oc()).trainingMaxKg).toBeUndefined()
  })
})

describe('deriveTrainingMax', () => {
  it('90 % of the best working e1RM, snapped to 2.5 kg; warm-ups and cardio ignored', () => {
    const sets = logged([[100, 5], [90, 8]], [[140, 5]])
    // best working e1rm = epley(100, 5) ≈ 116.7 → 105
    expect(deriveTrainingMax(sets)).toBe(Math.round((epley(100, 5) * 0.9) / 2.5) * 2.5)
    expect(deriveTrainingMax(sets)).toBe(105)
    const cardio: SetRow = { sessionId: 's', exerciseId: 9, setNumber: 1, weightKg: 0, reps: 0, isWarmup: false, completedAt: 0, e1rm: 0, durationSec: 600 }
    expect(deriveTrainingMax([cardio])).toBeUndefined()
    expect(deriveTrainingMax([])).toBeUndefined()
  })
})

describe('schemeLabel', () => {
  it('labels each scheme', () => {
    expect(schemeLabel(item({ targetReps: 8, targetRepsMax: 12 }))).toBe('8–12 reps')
    expect(schemeLabel(item())).toBe('')
    expect(schemeLabel(item({ scheme: LINEAR }))).toBe('Linear +2.5 kg')
    expect(schemeLabel(item({ scheme: { kind: 'linear', stepKg: 5, failsToDeload: 3, deloadPct: 0.1, stages: [{ sets: 3, reps: 10 }, { sets: 3, reps: 8 }] }, progress: { failStreak: 0, stage: 1 } }))).toBe('Stage 2/2 · 3×8')
    expect(schemeLabel(item({ scheme: PCT_531, setsByWeek: W531 }), 2)).toBe(nb('70 % ×3 · 80 % ×3 · 90 % ×3+'))
    expect(schemeLabel(item({ scheme: { kind: 'rpe' } }))).toBe('')
  })
})

describe('currentWeek', () => {
  const prog = { name: 'x', templateIds: [], cycleStartDate: '2026-10-05', cycleWeeks: 4 }
  it('counts whole weeks from the start Monday, modulo the cycle', () => {
    expect(currentWeek(prog, '2026-10-05')).toBe(1)
    expect(currentWeek(prog, '2026-10-11')).toBe(1)
    expect(currentWeek(prog, '2026-10-12')).toBe(2)
    expect(currentWeek(prog, '2026-10-26')).toBe(4)
    expect(currentWeek(prog, '2026-11-02')).toBe(1)
    expect(currentWeek(prog, '2026-11-09')).toBe(2)
  })
  it('a start date mid-week counts from its Monday; before the start or without one is week 1', () => {
    expect(currentWeek({ ...prog, cycleStartDate: '2026-10-08' }, '2026-10-12')).toBe(2)
    expect(currentWeek(prog, '2026-09-30')).toBe(1)
    expect(currentWeek({ name: 'x', templateIds: [] }, '2026-10-12')).toBe(1)
    expect(currentWeek({ ...prog, cycleWeeks: undefined }, '2026-11-09')).toBe(6)
  })
  it('crosses the DST change (Rome, last Sunday of October)', () => {
    expect(currentWeek({ ...prog, cycleStartDate: '2026-10-19' }, '2026-10-26')).toBe(2)
  })
})

describe('cycleStartOf', () => {
  const prog = { name: 'x', templateIds: [], cycleStartDate: '2026-10-05', cycleWeeks: 4 }
  it('the Monday of week 1 of the current cycle', () => {
    expect(cycleStartOf(prog, '2026-10-05')).toBe('2026-10-05')
    expect(cycleStartOf(prog, '2026-10-30')).toBe('2026-10-05')
    expect(cycleStartOf(prog, '2026-11-02')).toBe('2026-11-02')
    expect(cycleStartOf({ ...prog, cycleWeeks: 1 }, '2026-10-22')).toBe('2026-10-19')
  })
  it('"Set week N" (a rewritten start date) keeps the same cycle', () => {
    // Started 2026-09-07: 2026-10-26 is week 4 of the second cycle. "Set week 4" that day writes
    // the start 2026-10-05: same week, same cycle key.
    const older = { ...prog, cycleStartDate: '2026-09-07' }
    expect(currentWeek(older, '2026-10-26')).toBe(4)
    expect(cycleStartOf(older, '2026-10-26')).toBe('2026-10-05')
    expect(cycleStartOf(prog, '2026-10-26')).toBe('2026-10-05')
  })
  it('undefined without a start date or cycle length', () => {
    expect(cycleStartOf({ ...prog, cycleStartDate: undefined }, '2026-10-26')).toBeUndefined()
    expect(cycleStartOf({ ...prog, cycleWeeks: undefined }, '2026-10-26')).toBeUndefined()
  })
})

describe('lineForPrescription', () => {
  it('a swapped-in exercise does not inherit the carried weight, the stage stays', () => {
    const benchLine = item({ scheme: LINEAR, progress: { failStreak: 1, nextWeightKg: 80, lastSessionId: 'x' } })
    expect(lineForPrescription(benchLine)).toBe(benchLine)
    const swapped = lineForPrescription({ ...benchLine, exerciseId: 9, swappedFrom: 1 })
    expect(swapped.progress).toBeUndefined()
    // The new exercise's own history drives the weight.
    expect(prescribedSets(swapped, squat, [{ weightKg: 30, reps: 5 }], ctx)!.sets[0].weightKg).toBe(30)
    const staged = lineForPrescription({ ...item({ scheme: GZCLP_T1, progress: { failStreak: 0, stage: 1, nextWeightKg: 100 } }), swappedFrom: 1 })
    expect(staged.progress).toEqual({ failStreak: 0, stage: 1 })
  })
})
