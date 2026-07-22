import { db } from '../db/db'
import { gatherSeasonPriorBests } from './finishSession'
import { gatherWeeklyMuscleVolume, HYPERTROPHY_SET_BAND, type MuscleVolumeRow } from './muscleVolume'
import { standardFor, levelFor } from './standards'
import { suggestNext, type ProgressionSuggestion } from './progression'
import { DEFAULT_BAR_KG } from './plates'
import { localDateStr, mondayOf, parseLocalDate } from './dates'
import type { Id, TemplateItem } from '../types'

/**
 * A compact, pre-computed summary of one finished workout. This is what the AI
 * coach reasons over — NOT the raw tables. Every metric here already exists in
 * the app (scoring breakdown, prior bests, standards, progression, muscle
 * balance); the briefing only assembles them.
 */
export interface BriefingExercise {
  name: string
  muscleGroup: string
  sets: { weightKg: number; reps: number }[]
  bestE1rm: number
  priorBestE1rm: number | null
  e1rmPr: boolean
  volumePr: boolean
  strengthLevel: string | null
  nextSuggestion: string | null
}

export interface WorkoutBriefing {
  sessionName: string
  durationMin: number | null
  totalPoints: number
  recentAvgPoints: number | null
  bodyweightKg: number
  streakWeeks: number
  sessionsThisWeek: number
  weeklyTarget: number
  exercises: BriefingExercise[]
  weeklyMuscle: MuscleVolumeRow[]
}

/** Assemble the briefing for a finished, scored session. Returns null if the
 * session or its score event is missing. */
export async function gatherWorkoutBriefing(sessionId: Id): Promise<WorkoutBriefing | null> {
  const [session, event] = await Promise.all([
    db.sessions.get(sessionId),
    db.scoreEvents.where('sessionId').equals(sessionId).first(),
  ])
  if (!session || !event) return null

  const sets = await db.sets.where('sessionId').equals(sessionId).toArray()
  const [priorBests, allExercises, template, rank, settings] = await Promise.all([
    gatherSeasonPriorBests(sessionId, sets),
    db.exercises.toArray(),
    session.templateId != null ? db.templates.get(session.templateId) : Promise.resolve(undefined),
    db.rankState.get(1),
    db.settings.get(1),
  ])

  const exMap = new Map(allExercises.map(e => [e.id!, e]))
  const targetRepsById = new Map<Id, number>()
  for (const item of template?.items ?? []) targetRepsById.set(item.exerciseId, item.targetReps)

  const exercises: BriefingExercise[] = event.breakdown.map(b => {
    const ex = exMap.get(b.exerciseId)
    const exSets = sets
      .filter(s => s.exerciseId === b.exerciseId && !s.isWarmup)
      .sort((a, z) => a.setNumber - z.setNumber)
      .map(s => ({ weightKg: s.weightKg, reps: s.reps }))
    const prior = priorBests.e1rm.get(b.exerciseId) ?? null

    const std = ex ? standardFor(ex.nameLower) : null
    const strengthLevel =
      std && session.bodyweightKg > 0 ? levelFor(b.bestE1rm, session.bodyweightKg, std).level : null

    const targetReps = targetRepsById.get(b.exerciseId) ?? 8
    const sug = suggestNext(exSets, targetReps, ex?.progressionStepKg ?? 2.5)
    const nextSuggestion = sug
      ? sug.reason === 'weight-up'
        ? `${sug.weightKg} kg for ${sug.reps} reps`
        : `${sug.reps} reps at ${sug.weightKg} kg`
      : null

    return {
      name: b.exerciseName,
      muscleGroup: ex?.muscleGroup ?? 'other',
      sets: exSets,
      bestE1rm: Math.round(b.bestE1rm),
      priorBestE1rm: prior !== null ? Math.round(prior) : null,
      e1rmPr: b.e1rmPr,
      volumePr: b.volumePr,
      strengthLevel,
      nextSuggestion,
    }
  })

  // Recent average of prior SESSION scores (indexed by date; exclude quest
  // bonuses (sessionId undefined) and this session). Not orderBy('id') —
  // UUID string ids do not sort chronologically.
  const recentEvents = await db.scoreEvents
    .orderBy('date')
    .reverse()
    .filter(e => e.sessionId !== undefined && e.sessionId !== sessionId)
    .limit(5)
    .toArray()
  const recentAvgPoints =
    recentEvents.length > 0
      ? Math.round(recentEvents.reduce((a, e) => a + e.total, 0) / recentEvents.length)
      : null

  const today = localDateStr()
  const weekStartMs = parseLocalDate(mondayOf(today)).getTime()
  const sessionsThisWeek = await db.sessions
    .where('startedAt')
    .aboveOrEqual(weekStartMs)
    .filter(s => s.endedAt !== undefined)
    .count()

  const weeklyMuscle = await gatherWeeklyMuscleVolume(exMap, today)

  return {
    sessionName: session.name,
    durationMin: session.endedAt ? Math.round((session.endedAt - session.startedAt) / 60000) : null,
    totalPoints: event.total,
    recentAvgPoints,
    bodyweightKg: session.bodyweightKg,
    streakWeeks: rank?.streakWeeks ?? 0,
    sessionsThisWeek,
    weeklyTarget: settings?.weeklySessionTarget ?? 3,
    exercises,
    weeklyMuscle,
  }
}

/** Serialize a briefing into a compact, grounded prompt for Gemini. Pure. */
export function formatBriefing(b: WorkoutBriefing): string {
  const lines: string[] = []
  lines.push(`Session: ${b.sessionName}`)
  if (b.durationMin !== null) lines.push(`Duration: ${b.durationMin} min`)
  lines.push(
    `Score: ${b.totalPoints} pts` +
      (b.recentAvgPoints !== null
        ? ` (recent avg ${b.recentAvgPoints})`
        : ' (first tracked session)'),
  )
  lines.push(`Bodyweight: ${b.bodyweightKg} kg`)
  lines.push(
    `Consistency: ${b.sessionsThisWeek}/${b.weeklyTarget} sessions this week, ${b.streakWeeks}-week streak`,
  )
  lines.push('')
  lines.push('Exercises:')
  for (const e of b.exercises) {
    const setsStr = e.sets.length ? e.sets.map(s => `${s.weightKg}kg×${s.reps}`).join(', ') : 'no work sets'
    const tags: string[] = []
    if (e.e1rmPr) tags.push('NEW e1RM PR')
    if (e.volumePr) tags.push('volume PR')
    if (e.strengthLevel) tags.push(`level ${e.strengthLevel}`)
    const priorStr =
      e.priorBestE1rm !== null ? `prior best e1RM ${e.priorBestE1rm}kg` : 'first time this season'
    const suffix = tags.length ? ` [${tags.join(', ')}]` : ''
    const suggestion = e.nextSuggestion ? ` Suggested next: ${e.nextSuggestion}.` : ''
    lines.push(
      `- ${e.name} (${e.muscleGroup}): ${setsStr}. Best e1RM ${e.bestE1rm}kg, ${priorStr}.${suffix}${suggestion}`,
    )
  }
  lines.push('')
  lines.push(
    `Weekly hard sets per muscle (evidence band ${HYPERTROPHY_SET_BAND[0]}-${HYPERTROPHY_SET_BAND[1]} sets/week):`,
  )
  if (b.weeklyMuscle.length === 0) {
    lines.push('- (no sets logged in the last 8 weeks)')
  } else {
    for (const m of b.weeklyMuscle) {
      lines.push(`- ${m.group}: ${m.sets} sets this week (prior 8-week avg ${m.weeklyAvg}/wk)`)
    }
  }
  return lines.join('\n')
}

/* ---------- F2: pre-workout weight/rep plan briefing ---------- */

/** One planned exercise's grounding: last performance + the offline baseline the
 * model should anchor on. `ref` is String(exerciseId) so the model echoes it back. */
export interface PlanExercise {
  ref: string
  /** The real exerciseId this ref maps to (not serialized into the prompt). */
  exerciseId: Id
  name: string
  muscleGroup: string
  equipment?: string
  targetSets: number
  targetReps: number
  stepKg: number
  lastSets: { weightKg: number; reps: number }[]
  baseline: ProgressionSuggestion | null
  strengthLevel: string | null
  recentBestE1rm: number | null
}

export interface WorkoutPlanBriefing {
  sessionName: string
  bodyweightKg: number
  barKg: number
  exercises: PlanExercise[]
}

/** Assemble a PRE-workout briefing for a just-started session: the planned
 * exercise list (template + mid-session adds) with each exercise's last-session
 * work sets and the deterministic progression baseline. Null if no session or no
 * exercises to plan. */
export async function gatherWorkoutPlanBriefing(sessionId: Id): Promise<WorkoutPlanBriefing | null> {
  const session = await db.sessions.get(sessionId)
  if (!session) return null

  const [template, allExercises, settings] = await Promise.all([
    session.templateId != null ? db.templates.get(session.templateId) : Promise.resolve(undefined),
    db.exercises.toArray(),
    db.settings.get(1),
  ])
  const exMap = new Map(allExercises.map(e => [e.id!, e]))

  // Template exercises first, then anything added mid-session (mirror ActiveSession).
  const items: TemplateItem[] = [...(template?.items ?? [])]
  const itemIds = new Set(items.map(i => i.exerciseId))
  for (const exId of session.extraExerciseIds) {
    if (!itemIds.has(exId)) {
      const ex = exMap.get(exId)
      items.push({ exerciseId: exId, targetSets: 3, targetReps: 8, restSec: ex?.defaultRestSec })
      itemIds.add(exId)
    }
  }
  if (items.length === 0) return null

  const exercises: PlanExercise[] = await Promise.all(
    items.map(async item => {
      const ex = exMap.get(item.exerciseId)
      // Last completed session's work sets for this exercise (exclude this session + warm-ups).
      const all = await db.sets
        .where('exerciseId')
        .equals(item.exerciseId)
        .filter(s => s.sessionId !== sessionId && !s.isWarmup)
        .sortBy('completedAt')
      let lastSets: { weightKg: number; reps: number }[] = []
      if (all.length > 0) {
        const lastSessionId = all[all.length - 1].sessionId
        lastSets = all
          .filter(s => s.sessionId === lastSessionId)
          .sort((a, b) => a.setNumber - b.setNumber)
          .map(s => ({ weightKg: s.weightKg, reps: s.reps }))
      }
      const recentBestE1rm = all.length ? Math.round(Math.max(...all.map(s => s.e1rm))) : null
      const stepKg = ex?.progressionStepKg ?? 2.5
      const baseline = suggestNext(lastSets, item.targetReps, stepKg)
      const std = ex ? standardFor(ex.nameLower) : null
      const strengthLevel =
        std && session.bodyweightKg > 0 && recentBestE1rm !== null
          ? levelFor(recentBestE1rm, session.bodyweightKg, std).level
          : null
      return {
        ref: String(item.exerciseId),
        exerciseId: item.exerciseId,
        name: ex?.name ?? 'Exercise',
        muscleGroup: ex?.muscleGroup ?? 'other',
        equipment: ex?.equipment,
        targetSets: item.targetSets,
        targetReps: item.targetReps,
        stepKg,
        lastSets,
        baseline,
        strengthLevel,
        recentBestE1rm,
      }
    }),
  )

  return {
    sessionName: session.name,
    bodyweightKg: session.bodyweightKg,
    barKg: settings?.barWeightKg ?? DEFAULT_BAR_KG,
    exercises,
  }
}

/** Serialize a pre-workout plan briefing into a grounded prompt. Pure. */
export function formatWorkoutPlanBriefing(b: WorkoutPlanBriefing): string {
  const lines: string[] = []
  lines.push(`Session: ${b.sessionName}`)
  lines.push(`Bodyweight: ${b.bodyweightKg} kg; barbell ${b.barKg} kg; round weights to 2.5 kg increments.`)
  lines.push('')
  lines.push('Exercises (plan opening sets for each, keyed by ref):')
  for (const e of b.exercises) {
    const last = e.lastSets.length
      ? e.lastSets.map(s => `${s.weightKg}kg×${s.reps}`).join(', ')
      : 'no history'
    const base = e.baseline
      ? e.baseline.reason === 'weight-up'
        ? `${e.baseline.weightKg}kg×${e.baseline.reps} (add weight)`
        : `${e.baseline.weightKg}kg×${e.baseline.reps} (add a rep)`
      : 'none (repeat last, or start light if new)'
    const lvl = e.strengthLevel ? `, level ${e.strengthLevel}` : ''
    const eq = e.equipment ? `, ${e.equipment}` : ''
    lines.push(
      `- ${e.ref}) ${e.name} (${e.muscleGroup}${eq}${lvl}): target ${e.targetSets}×${e.targetReps}, step ${e.stepKg}kg. Last: ${last}. Baseline: ${base}.`,
    )
  }
  return lines.join('\n')
}
