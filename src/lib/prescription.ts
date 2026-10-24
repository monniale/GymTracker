import { t, fmtNum } from '../i18n'
import { suggestNext, BODYWEIGHT_STEP_KG, type PrevSet } from './progression'
import { bwFactorOf } from './load'
import { isCardioExercise, isCardioSet } from './cardio'
import { DEFAULT_BAR_KG, DEFAULT_PLATES } from './plates'
import { addDays, daysBetween, mondayOf } from './dates'
import type {
  Exercise, Id, ItemProgress, PlannedSet, PrescribedSet, Program, ProgressionScheme, SetRow, TemplateItem,
} from '../types'

/**
 * Prescription engine for program templates (pure, no Dexie).
 *
 * A template item's `scheme` (absent = `double`) decides the work sets of the next workout
 * (`prescribedSets`) and how a finished workout moves the item on (`applyOutcome`). Progression
 * state lives only in `TemplateItem.progress` and `Exercise.trainingMaxKg`; it is written once per
 * workout by finishSession (src/lib/programs.ts `applySessionProgression`), never by rescoreSession.
 *
 * Bodyweight-load exercises (src/lib/load.ts): weights are ADDED kg (negative = assisted), the step
 * is at most `BODYWEIGHT_STEP_KG`, and a percent scheme's training max is the full load
 * (bodyweight × share + added kg), so the prescribed added kg is that load minus the bodyweight share.
 */

/** A prescribed work set: a `PlannedSet` (the shape the AI plan uses) with its AMRAP flag and % of TM. */
export type PrescribedPlanSet = PlannedSet & { amrap?: boolean; pct?: number }

export interface PrescribedPlan {
  /** Work sets in order. Empty when no weight is known yet (no history, or no training max): the
   * caller keeps its own prefill and only shows `label`. */
  sets: PrescribedPlanSet[]
  /** Scheme label for the chip ("Linear +2.5 kg", "65 % ×5 · 75 % ×5 · 85 % ×5+", "8–12 reps"). */
  label: string
  /** True when the program fixes the sets (linear, percent): the AI weight plan must not replace them. */
  fixed: boolean
}

export interface PrescriptionCtx {
  /** Program week, 1-based (`currentWeek`); 1 outside a program. */
  week: number
  bodyweightKg: number
  barKg: number
  /** The exercise's sets are bodyweight load (`usesBodyweightLoad`): weights are added kg. */
  bodyweightLoad: boolean
}

export interface OutcomeCtx {
  week: number
  cycleWeeks?: number
  /** Monday (YYYY-MM-DD) of week 1 of the cycle the workout falls in (`cycleStartOf`); with it a
   * percent item changes the training max at most once per cycle. */
  cycleStart?: string
  sessionId: Id
}

/** Smallest loadable change on a bar: a pair of the smallest default plates (2.5 kg). */
const LOAD_STEP_KG = 2 * Math.min(...DEFAULT_PLATES)

const r2 = (n: number) => Math.round(n * 100) / 100 + 0

function roundTo(kg: number, step: number): number {
  return r2(Math.round(kg / step) * step)
}

function schemeOf(item: TemplateItem): ProgressionScheme {
  return item.scheme ?? { kind: 'double' }
}

function isBodyweightExercise(ex: Exercise): boolean {
  return ex.equipment === 'bodyweight' && !isCardioExercise(ex)
}

/** Step in kg for a weight change: capped for bodyweight-load moves, like double progression. */
function stepFor(stepKg: number, bodyweight: boolean): number {
  return bodyweight ? Math.min(stepKg, BODYWEIGHT_STEP_KG) : stepKg
}

/** Heaviest non-drop work set of the last session (drop sets only: the heaviest of those), or undefined. */
function topWeightOf(sets: PrevSet[], bodyweight: boolean): number | undefined {
  const work = sets.filter(s => (bodyweight || s.weightKg > 0) && s.reps > 0)
  if (work.length === 0) return undefined
  const straight = work.filter(s => s.setType !== 'drop')
  const pool = straight.length > 0 ? straight : work
  return Math.max(...pool.map(s => s.weightKg))
}

/** The prescribed sets of a linear item: the current stage, else `item.sets`, else targetSets × targetReps. */
function linearSets(item: TemplateItem, scheme: Extract<ProgressionScheme, { kind: 'linear' }>): PrescribedSet[] {
  const stages = scheme.stages ?? []
  if (stages.length > 0) {
    const st = stages[stageIndex(item, stages.length)]
    return Array.from({ length: Math.max(1, st.sets) }, (_, i) => ({
      reps: st.reps,
      ...(st.amrapLast && i === st.sets - 1 ? { amrap: true } : {}),
    }))
  }
  if (item.sets && item.sets.length > 0) return item.sets
  return Array.from({ length: Math.max(1, item.targetSets) }, () => ({ reps: item.targetReps }))
}

function stageIndex(item: TemplateItem, count: number): number {
  const s = item.progress?.stage ?? 0
  return Math.min(Math.max(0, Math.floor(s)), Math.max(0, count - 1))
}

/** The percent sets of a week: `setsByWeek[(week − 1) % length]`, else `sets`. */
function percentSets(item: TemplateItem, week: number): PrescribedSet[] {
  const byWeek = item.setsByWeek?.filter(w => w.length > 0) ?? []
  if (byWeek.length > 0) {
    const w = Math.max(1, Math.floor(week || 1))
    return byWeek[(w - 1) % byWeek.length]
  }
  return item.sets ?? []
}

/** The sets the item's scheme prescribes this week (no weights): what `applyOutcome` checks reps against. */
function prescribedReps(item: TemplateItem, week: number): PrescribedSet[] {
  const scheme = schemeOf(item)
  if (scheme.kind === 'linear') return linearSets(item, scheme)
  if (scheme.kind === 'percent') return percentSets(item, week)
  if (item.sets && item.sets.length > 0) return item.sets
  return Array.from({ length: Math.max(1, item.targetSets) }, () => ({ reps: item.targetReps }))
}

/** Load in kg for `pct` of the training max, as a loadable weight (or added kg for bodyweight load). */
function percentWeight(pct: number, tm: number, ex: Exercise, ctx: PrescriptionCtx): number {
  const load = pct * tm
  if (ctx.bodyweightLoad) {
    const added = load - ctx.bodyweightKg * bwFactorOf(ex)
    return Math.max(-Math.floor(ctx.bodyweightKg), roundTo(added, BODYWEIGHT_STEP_KG))
  }
  const w = Math.max(0, roundTo(load, LOAD_STEP_KG))
  const bar = ctx.barKg > 0 ? ctx.barKg : DEFAULT_BAR_KG
  return ex.equipment === 'barbell' && load > 0 ? Math.max(bar, w) : w
}

const fmtPct = (pct: number) => fmtNum(Math.round(pct * 1000) / 10)

/**
 * The work sets for an item's next workout, or null when the item has no program scheme (a plain
 * `double` item without a rep range or explicit sets: today's history-based prefill applies).
 * `prevSets` are the item's work sets from the last session of the exercise (warm-ups left out).
 */
export function prescribedSets(
  item: TemplateItem,
  exercise: Exercise,
  prevSets: PrevSet[],
  ctx: PrescriptionCtx,
): PrescribedPlan | null {
  const scheme = schemeOf(item)
  const bw = ctx.bodyweightLoad

  if (scheme.kind === 'percent') {
    const plan = percentSets(item, ctx.week)
    if (plan.length === 0) return null
    const tm = exercise.trainingMaxKg
    if (tm === undefined || !Number.isFinite(tm) || tm <= 0) {
      return { sets: [], label: t('schemes.needTm'), fixed: true }
    }
    const top = topWeightOf(prevSets, bw)
    const sets = plan.map(p => ({
      weightKg: p.pct !== undefined ? percentWeight(p.pct, tm, exercise, ctx) : (top ?? 0),
      reps: p.reps,
      ...(p.amrap ? { amrap: true } : {}),
      ...(p.pct !== undefined ? { pct: p.pct } : {}),
    }))
    return { sets, label: schemeLabel(item, ctx.week), fixed: true }
  }

  if (scheme.kind === 'linear') {
    const plan = linearSets(item, scheme)
    // `progress` is shared by the program's lines of this lift with the same scheme
    // (applySessionProgression), so it is never older than the lift's last program workout.
    const weight = item.progress?.nextWeightKg ?? topWeightOf(prevSets, bw) ?? (bw ? 0 : undefined)
    const sets = weight === undefined ? [] : plan.map(p => ({
      weightKg: weight,
      reps: p.reps,
      ...(p.amrap ? { amrap: true } : {}),
    }))
    return { sets, label: schemeLabel(item), fixed: true }
  }

  // double (and the reserved rpe kind): today's rule, with a rep range and/or explicit sets.
  const hasRange = item.targetRepsMax !== undefined && item.targetRepsMax > item.targetReps
  const explicit = item.sets && item.sets.length > 0 ? item.sets : undefined
  if (!hasRange && !explicit) return null

  const step = exercise.progressionStepKg ?? 2.5
  const minReps = explicit ? Math.min(...explicit.map(s => s.reps)) : item.targetReps
  const sug = suggestNext(prevSets, minReps, step, {
    bodyweight: bw,
    targetRepsMax: hasRange ? item.targetRepsMax : undefined,
  })
  const label = schemeLabel(item)
  if (explicit) {
    const top = topWeightOf(prevSets, bw)
    const weight = sug?.reason === 'weight-up' ? sug.weightKg : (top ?? (bw ? 0 : undefined))
    const sets = weight === undefined ? [] : explicit.map(p => ({
      weightKg: weight,
      reps: p.reps,
      ...(p.amrap ? { amrap: true } : {}),
    }))
    return { sets, label, fixed: false }
  }
  const one = sug ? { weightKg: sug.weightKg, reps: sug.reps } : bw ? { weightKg: 0, reps: item.targetReps } : undefined
  const sets = one ? Array.from({ length: Math.max(1, item.targetSets) }, () => ({ ...one })) : []
  return { sets, label, fixed: false }
}

/** Logged work sets of the item in set order: no warm-ups, cardio or drop sets, reps > 0. */
function workSetsOf(logged: SetRow[], bodyweight: boolean): SetRow[] {
  return logged
    .filter(s => !s.isWarmup && !isCardioSet(s) && s.reps > 0 && s.setType !== 'drop'
      && (bodyweight || s.weightKg > 0))
    .sort((a, b) => a.setNumber - b.setNumber || a.completedAt - b.completedAt)
}

/** Every prescribed set has a logged work set at its position with at least its reps. */
function allRepsHit(work: SetRow[], plan: PrescribedSet[]): boolean {
  return work.length >= plan.length && plan.every((p, i) => work[i].reps >= p.reps)
}

/** Weight after a deload: `deloadPct` less load (more assistance for an assisted bodyweight set). */
function deloaded(weight: number, deloadPct: number, bodyweight: boolean): number {
  const pct = Math.min(1, Math.max(0, deloadPct))
  if (bodyweight) return roundTo(weight - Math.abs(weight) * pct, BODYWEIGHT_STEP_KG)
  return Math.max(0, roundTo(weight * (1 - pct), LOAD_STEP_KG))
}

/**
 * Reps of the AMRAP set the TM bump reads: a logged set with `setType` 'amrap' when there is one
 * (the heaviest of them), else positional (the work set at the index of the prescribed AMRAP set
 * with the highest %). Undefined when there is none.
 */
export function amrapReps(work: SetRow[], plan: PrescribedSet[]): number | undefined {
  const typed = work.filter(s => s.setType === 'amrap')
  if (typed.length > 0) {
    const heaviest = Math.max(...typed.map(s => s.weightKg))
    return typed.find(s => s.weightKg === heaviest)!.reps
  }
  let idx = -1
  plan.forEach((p, i) => {
    if (p.amrap && (idx < 0 || (p.pct ?? 0) > (plan[idx].pct ?? 0))) idx = i
  })
  return idx >= 0 && idx < work.length ? work[idx].reps : undefined
}

/**
 * The item's progression after a finished workout. `loggedSets` are the sets logged for THIS item in
 * that workout (an exercise twice in a template: split per item). Returns the new `ItemProgress` and,
 * for a percent scheme, the new `Exercise.trainingMaxKg` when it changes. The same session applied
 * twice (`progress.lastSessionId`), or an item with no logged work set, returns `item.progress`
 * unchanged (the same object when it exists) and no training max.
 */
export function applyOutcome(
  item: TemplateItem,
  exercise: Exercise,
  loggedSets: SetRow[],
  ctx: OutcomeCtx,
): { progress: ItemProgress; trainingMaxKg?: number } {
  const prev = item.progress
  const unchanged = { progress: prev ?? { failStreak: 0 } }
  if (prev?.lastSessionId !== undefined && String(prev.lastSessionId) === String(ctx.sessionId)) return unchanged

  const bw = isBodyweightExercise(exercise)
  const work = workSetsOf(loggedSets, bw)
  if (work.length === 0) return unchanged

  const scheme = schemeOf(item)
  const plan = prescribedReps(item, ctx.week)
  const pass = allRepsHit(work, plan)
  const failStreak = prev?.failStreak ?? 0
  const base = { lastSessionId: ctx.sessionId }

  if (scheme.kind === 'linear') {
    const weight = Math.max(...work.map(s => s.weightKg))
    const step = stepFor(scheme.stepKg, bw)
    const stages = scheme.stages ?? []
    if (pass) {
      return {
        progress: {
          ...base, failStreak: 0, lastOutcome: 'pass', nextWeightKg: r2(weight + step),
          ...(stages.length > 0 ? { stage: stageIndex(item, stages.length) } : {}),
        },
      }
    }
    if (stages.length > 0) {
      const stage = stageIndex(item, stages.length)
      if (stage < stages.length - 1) {
        return { progress: { ...base, failStreak: 0, lastOutcome: 'fail', stage: stage + 1, nextWeightKg: weight } }
      }
      return {
        progress: { ...base, failStreak: 0, lastOutcome: 'deload', stage: 0, nextWeightKg: deloaded(weight, scheme.deloadPct, bw) },
      }
    }
    const fails = failStreak + 1
    if (fails >= Math.max(1, scheme.failsToDeload)) {
      return { progress: { ...base, failStreak: 0, lastOutcome: 'deload', nextWeightKg: deloaded(weight, scheme.deloadPct, bw) } }
    }
    return { progress: { ...base, failStreak: fails, lastOutcome: 'fail', nextWeightKg: weight } }
  }

  if (scheme.kind === 'percent') {
    const progress: ItemProgress = {
      ...base, failStreak: pass ? 0 : failStreak + 1, lastOutcome: pass ? 'pass' : 'fail',
      ...(prev?.tmCycle !== undefined ? { tmCycle: prev.tmCycle } : {}),
    }
    const tm = exercise.trainingMaxKg
    if (tm === undefined || !Number.isFinite(tm) || tm <= 0) return { progress }
    let bump = 0
    const table = scheme.tmBumpByReps ?? []
    if (table.length > 0) {
      const reps = amrapReps(work, plan)
      if (reps !== undefined) {
        const row = [...table].sort((a, b) => b.minReps - a.minReps).find(r => reps >= r.minReps)
        bump = row?.kg ?? 0
        progress.lastOutcome = bump > 0 ? 'pass' : 'fail'
      }
    } else if (pass && scheme.tmStepKg > 0 && ctx.cycleWeeks !== undefined && ctx.cycleWeeks > 0
      && ctx.week >= ctx.cycleWeeks) {
      // The fixed bump (5/3/1 after the cycle, an nSuns T2 lift every week) needs every set done.
      bump = scheme.tmStepKg
    }
    if (bump === 0) return { progress }
    // Once per cycle: a repeated workout in the same cycle keeps the training max.
    if (ctx.cycleStart !== undefined) {
      if (prev?.tmCycle === ctx.cycleStart) return { progress }
      progress.tmCycle = ctx.cycleStart
    }
    return { progress, trainingMaxKg: r2(tm + bump) }
  }

  // double (and rpe): history drives the next weight; record whether the weight step was earned.
  const top = Math.max(...work.map(s => s.weightKg))
  const maxReps = Math.max(item.targetReps, item.targetRepsMax ?? item.targetReps)
  const earned = work.filter(s => s.weightKg === top).every(s => s.reps >= maxReps)
  return { progress: { ...base, failStreak: 0, ...(earned ? { lastOutcome: 'pass' as const } : {}) } }
}

/** Training max from logged sets: 90 % of the best working e1RM, to the nearest 2.5 kg. */
export function deriveTrainingMax(sets: SetRow[]): number | undefined {
  const best = sets
    .filter(s => !s.isWarmup && !isCardioSet(s) && s.reps > 0 && s.e1rm > 0)
    .reduce((m, s) => Math.max(m, s.e1rm), 0)
  if (best <= 0) return undefined
  const tm = roundTo(best * 0.9, 2.5)
  return tm > 0 ? tm : undefined
}

/** Equal consecutive percent sets folded into one group. */
function groupSets(sets: PrescribedSet[]): { set: PrescribedSet; count: number }[] {
  const out: { set: PrescribedSet; count: number }[] = []
  for (const s of sets) {
    const last = out[out.length - 1]
    if (last && last.set.pct === s.pct && last.set.reps === s.reps && !!last.set.amrap === !!s.amrap) last.count++
    else out.push({ set: s, count: 1 })
  }
  return out
}

/**
 * The scheme chip label in the UI language: "8–12 reps", "Linear +2.5 kg", "Stage 2/3 · 6×2",
 * "65 % ×5 · 75 % ×5 · 85 % ×5+" (percent: the sets of `week`, default 1). '' for a plain
 * double-progression item without a rep range.
 */
export function schemeLabel(item: TemplateItem, week = 1): string {
  const scheme = schemeOf(item)
  if (scheme.kind === 'linear') {
    const stages = scheme.stages ?? []
    if (stages.length > 0) {
      const i = stageIndex(item, stages.length)
      const st = stages[i]
      const vars = { n: i + 1, total: stages.length, sets: st.sets, reps: st.reps }
      return t(st.amrapLast ? 'schemes.stageAmrap' : 'schemes.stage', vars)
    }
    return t('schemes.linear', { kg: fmtNum(scheme.stepKg) })
  }
  if (scheme.kind === 'percent') {
    return groupSets(percentSets(item, week)).map(({ set, count }) => {
      const pct = set.pct !== undefined ? fmtPct(set.pct) : '–'
      if (count > 1) return t(set.amrap ? 'schemes.pctGroupAmrap' : 'schemes.pctGroup', { pct, sets: count, reps: set.reps })
      return t(set.amrap ? 'schemes.pctSetAmrap' : 'schemes.pctSet', { pct, reps: set.reps })
    }).join(' · ')
  }
  if (item.targetRepsMax !== undefined && item.targetRepsMax > item.targetReps) {
    return t('schemes.repRange', { min: item.targetReps, max: item.targetRepsMax })
  }
  return ''
}

/**
 * The program week on `today` (YYYY-MM-DD), 1-based: whole weeks since the Monday of
 * `cycleStartDate`, modulo `cycleWeeks` when set. 1 without a start date or before it.
 */
export function currentWeek(program: Program, today: string): number {
  if (!program.cycleStartDate) return 1
  const weeks = Math.floor(daysBetween(mondayOf(program.cycleStartDate), mondayOf(today)) / 7)
  if (weeks < 0) return 1
  const len = program.cycleWeeks
  return len !== undefined && len > 0 ? (weeks % len) + 1 : weeks + 1
}

/**
 * Monday (YYYY-MM-DD) of week 1 of the cycle `today` falls in, or undefined for a program without
 * a start date or `cycleWeeks`. "Set week N" rewrites `cycleStartDate` so that today is week N, so
 * the same calendar cycle keeps the same key.
 */
export function cycleStartOf(program: Program, today: string): string | undefined {
  const len = program.cycleWeeks
  if (!program.cycleStartDate || len === undefined || len <= 0) return undefined
  const start = mondayOf(program.cycleStartDate)
  const weeks = Math.floor(daysBetween(start, mondayOf(today)) / 7)
  if (weeks < 0) return start
  return addDays(start, (weeks - (weeks % len)) * 7)
}

/**
 * The template line as the prescription should read it. A line swapped in this session for
 * another exercise (`swappedFrom`) keeps its scheme and stage but not the original exercise's
 * carried work weight or fail streak: the new exercise starts from its own history.
 */
export function lineForPrescription(item: TemplateItem & { swappedFrom?: Id }): TemplateItem {
  if (item.swappedFrom === undefined || !item.progress) return item
  const { progress, ...rest } = item
  return progress.stage !== undefined ? { ...rest, progress: { failStreak: 0, stage: progress.stage } } : rest
}
