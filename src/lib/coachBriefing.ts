import { db } from '../db/db'
import { gatherSeasonPriorBests } from './finishSession'
import { gatherWeeklyMuscleVolume, HYPERTROPHY_SET_BAND, type MuscleVolumeRow } from './muscleVolume'
import { standardFor, levelFor } from './standards'
import { suggestNext, type ProgressionSuggestion } from './progression'
import { DEFAULT_BAR_KG } from './plates'
import { localDateStr, mondayOf, parseLocalDate } from './dates'
import { isCardioExercise, isCardioSet, cardioSessionTotals, cardioMinutes, fmtDistance, paceSecPerKm, fmtPace } from './cardio'
import { sessionItems } from './sessionItems'
import { bwFactorOf, effectiveLoad, setE1rm, usesBodyweightLoad } from './load'
import { briefingTag, SET_NOTATION_LEGEND } from './setTypes'
import type { Exercise, Id, Session, SetRow } from '../types'

/** A logged set as briefings carry it: RPE and set type only when recorded (absent = working). */
export interface BriefingSet {
  weightKg: number
  reps: number
  rpe?: number
  setType?: SetRow['setType']
}

/** The set's RPE and type, only the fields it has (so a plain set stays `{ weightKg, reps }`). */
function effortFields(s: Pick<SetRow, 'rpe' | 'setType'>): Pick<BriefingSet, 'rpe' | 'setType'> {
  return {
    ...(s.rpe !== undefined ? { rpe: s.rpe } : {}),
    ...(s.setType !== undefined && s.setType !== 'working' ? { setType: s.setType } : {}),
  }
}

/**
 * A compact, pre-computed summary of one finished workout. This is what the AI
 * coach reasons over — NOT the raw tables. Every metric here already exists in
 * the app (scoring breakdown, prior bests, standards, progression, muscle
 * balance); the briefing only assembles them.
 */
export interface BriefingExercise {
  name: string
  muscleGroup: string
  /** `weightKg` as logged (added kg when `bodyweightFactor` is set), `loadKg` the effective load. */
  sets: (BriefingSet & { loadKg: number })[]
  /** Fraction of bodyweight moved, set only for a bodyweight exercise of a stamped session. */
  bodyweightFactor?: number
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
  /** Cardio done in the session (no points; context only). */
  cardio: { name: string; minutes: number; distanceM: number; pace: string | null }[]
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
  // Template lines only (after this session's swaps, so a swapped-in exercise keeps its line's
  // reps), deliberately without the added exercises: an exercise added mid-session falls back to
  // 8 reps below, even a cardio one (whose session line would say 20 minutes).
  const targetRepsById = new Map<Id, number>()
  for (const item of sessionItems(template, { extraExerciseIds: [], swaps: session.swaps }, exMap)) {
    targetRepsById.set(item.exerciseId, item.targetReps)
  }

  const exercises: BriefingExercise[] = event.breakdown.map(b => {
    const ex = exMap.get(b.exerciseId)
    const bodyweightLoad = usesBodyweightLoad(ex, session)
    const exSets = sets
      .filter(s => s.exerciseId === b.exerciseId && !s.isWarmup)
      .sort((a, z) => a.setNumber - z.setNumber)
      .map(s => ({ weightKg: s.weightKg, reps: s.reps, loadKg: effectiveLoad(s, ex, session), ...effortFields(s) }))
    const prior = priorBests.e1rm.get(b.exerciseId) ?? null

    const std = ex ? standardFor(ex.nameLower) : null
    // The pull-up standard rates the bodyweight load: not an unstamped session's added kg.
    const rated = std && (std.key !== 'pullup' || bodyweightLoad)
    const strengthLevel =
      std && rated && session.bodyweightKg > 0 ? levelFor(b.bestE1rm, session.bodyweightKg, std).level : null

    const targetReps = targetRepsById.get(b.exerciseId) ?? 8
    const sug = suggestNext(exSets, targetReps, ex?.progressionStepKg ?? 2.5, { bodyweight: bodyweightLoad })
    const sugKg = sug ? (bodyweightLoad ? bwKg(sug.weightKg) : `${sug.weightKg} kg`) : ''
    const nextSuggestion = sug
      ? sug.reason === 'weight-up'
        ? `${sugKg} for ${sug.reps} reps`
        : sug.reason === 'hold'
          ? `hold ${sugKg} for ${sug.reps} reps (this session ended near the limit)`
          : `${sug.reps} reps at ${sugKg}`
      : null

    return {
      name: b.exerciseName,
      muscleGroup: ex?.muscleGroup ?? 'other',
      sets: exSets,
      ...(bodyweightLoad && ex ? { bodyweightFactor: bwFactorOf(ex) } : {}),
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

  const cardioIds = [...new Set(sets.filter(isCardioSet).map(s => s.exerciseId))]
  const cardio = cardioIds.map(id => {
    const t = cardioSessionTotals(sets.filter(s => s.exerciseId === id))
    const pace = paceSecPerKm(t.durationSec, t.distanceM)
    return { name: exMap.get(id)?.name ?? 'Cardio', minutes: cardioMinutes(t.durationSec), distanceM: t.distanceM, pace: pace ? fmtPace(pace) : null }
  })

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
    cardio,
    weeklyMuscle,
  }
}

/** Added kg on bodyweight: "BW", "BW+10kg", "BW-20kg" (assisted). */
function bwKg(addedKg: number): string {
  return addedKg === 0 ? 'BW' : `BW${addedKg > 0 ? '+' : '-'}${Math.abs(addedKg)}kg`
}

/** "80kg×8"; on a bodyweight exercise the weight is added kg: "BW×12", "BW+10kg×8", "BW-20kg×6".
 * Then the RPE and set type (`briefingTag`): "80kg×8@8", "60kg×12 D", "BW+10kg×8@9 F". */
function briefingSet(s: BriefingSet, bodyweightLoad: boolean): string {
  return `${bodyweightLoad ? bwKg(s.weightKg) : `${s.weightKg}kg`}×${s.reps}${briefingTag(s)}`
}

/** True when any set prints an RPE or a set-type tag, so the briefing needs the legend. */
function usesSetNotation(sets: BriefingSet[]): boolean {
  return sets.some(s => briefingTag(s) !== '')
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
  if (b.exercises.some(e => e.bodyweightFactor !== undefined)) {
    lines.push('(BW = bodyweight; on bodyweight exercises the kg are added to it, ×factor = share of bodyweight moved, e1RM counts it)')
  }
  if (usesSetNotation(b.exercises.flatMap(e => e.sets))) lines.push(SET_NOTATION_LEGEND)
  for (const e of b.exercises) {
    const bw = e.bodyweightFactor !== undefined
    const setsStr = e.sets.length ? e.sets.map(s => briefingSet(s, bw)).join(', ') : 'no work sets'
    const tags: string[] = []
    if (bw) tags.push(`bodyweight ×${e.bodyweightFactor}`)
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
  if (b.cardio.length > 0) {
    lines.push('')
    lines.push('Cardio (tracked, earns no points):')
    for (const c of b.cardio) {
      const dist = c.distanceM > 0 ? `, ${fmtDistance(c.distanceM)}` : ''
      lines.push(`- ${c.name}: ${c.minutes} min${dist}${c.pace ? `, pace ${c.pace}` : ''}`)
    }
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
  /** Weights are ADDED kg on top of bodyweight (negative = assisted): `usesBodyweightLoad`. */
  bodyweightLoad?: boolean
  targetSets: number
  targetReps: number
  stepKg: number
  lastSets: BriefingSet[]
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

/** Best live e1RM of the bodyweight-load rows (stamped sessions) among `rows`, null when none. */
async function stampedBestE1rm(rows: SetRow[], ex: Exercise | undefined): Promise<number | null> {
  const ids = [...new Set(rows.map(r => r.sessionId))]
  const sessions = await db.sessions.bulkGet(ids)
  const byId = new Map<Id, Session>()
  sessions.forEach((row, i) => { if (row) byId.set(ids[i], row) })
  let best: number | null = null
  for (const r of rows) {
    const own = byId.get(r.sessionId)
    if (!usesBodyweightLoad(ex, own)) continue
    const e1rm = setE1rm(r, ex, own)
    if (e1rm > 0 && (best === null || e1rm > best)) best = e1rm
  }
  return best === null ? null : Math.round(best)
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

  // Template exercises first, then anything added mid-session (the same lines ActiveSession shows).
  // An added cardio exercise gets its 1 × 20 min default there, but every cardio item is dropped
  // just below with the same `isCardioExercise` test, so the plan is unchanged by it.
  const items = sessionItems(template, session, exMap)
  // Cardio has no weights to plan.
  const strengthItems = items.filter(it => !isCardioExercise(exMap.get(it.exerciseId)))
  if (strengthItems.length === 0) return null

  const exercises: PlanExercise[] = await Promise.all(
    strengthItems.map(async item => {
      const ex = exMap.get(item.exerciseId)
      // Last completed session's work sets for this exercise (exclude this session + warm-ups).
      const all = await db.sets
        .where('exerciseId')
        .equals(item.exerciseId)
        .filter(s => s.sessionId !== sessionId && !s.isWarmup)
        .sortBy('completedAt')
      let lastSets: BriefingSet[] = []
      if (all.length > 0) {
        const lastSessionId = all[all.length - 1].sessionId
        lastSets = all
          .filter(s => s.sessionId === lastSessionId)
          .sort((a, b) => a.setNumber - b.setNumber)
          .map(s => ({ weightKg: s.weightKg, reps: s.reps, ...effortFields(s) }))
      }
      const recentBestE1rm = all.length ? Math.round(Math.max(...all.map(s => s.e1rm))) : null
      const stepKg = ex?.progressionStepKg ?? 2.5
      // The session being planned is new, so stamped: a bodyweight move progresses on added kg.
      const bodyweightLoad = usesBodyweightLoad(ex, session)
      const baseline = suggestNext(lastSets, item.targetReps, stepKg, { bodyweight: bodyweightLoad })
      const std = ex ? standardFor(ex.nameLower) : null
      // The pull-up standard rates the bodyweight load only (invariant 6): the best of the rows
      // from stamped sessions, read live, never an unstamped session's added kg.
      const ratedE1rm = std?.key === 'pullup' ? await stampedBestE1rm(all, ex) : recentBestE1rm
      const strengthLevel =
        std && session.bodyweightKg > 0 && ratedE1rm !== null
          ? levelFor(ratedE1rm, session.bodyweightKg, std).level
          : null
      return {
        ref: String(item.exerciseId),
        exerciseId: item.exerciseId,
        name: ex?.name ?? 'Exercise',
        muscleGroup: ex?.muscleGroup ?? 'other',
        equipment: ex?.equipment,
        ...(bodyweightLoad ? { bodyweightLoad: true } : {}),
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

const BASELINE_NOTE: Record<ProgressionSuggestion['reason'], string> = {
  'weight-up': 'add weight',
  'reps-up': 'add a rep',
  hold: 'hold, last session was near the limit',
}

/** Serialize a pre-workout plan briefing into a grounded prompt. Pure. */
export function formatWorkoutPlanBriefing(b: WorkoutPlanBriefing): string {
  const lines: string[] = []
  lines.push(`Session: ${b.sessionName}`)
  lines.push(`Bodyweight: ${b.bodyweightKg} kg; barbell ${b.barKg} kg; round weights to 2.5 kg increments.`)
  lines.push('')
  if (b.exercises.some(e => e.equipment === 'bodyweight')) {
    lines.push('Weights for bodyweight exercises are ADDED kg on top of bodyweight (0 = plain bodyweight, negative = assisted by a machine or band).')
  }
  if (usesSetNotation(b.exercises.flatMap(e => e.lastSets))) lines.push(SET_NOTATION_LEGEND)
  lines.push('Exercises (plan opening sets for each, keyed by ref):')
  for (const e of b.exercises) {
    const last = e.lastSets.length
      ? e.lastSets.map(s => `${s.weightKg}kg×${s.reps}${briefingTag(s)}`).join(', ')
      : 'no history'
    const base = e.baseline
      ? `${e.baseline.weightKg}kg×${e.baseline.reps} (${BASELINE_NOTE[e.baseline.reason]})`
      : 'none (repeat last, or start light if new)'
    const lvl = e.strengthLevel ? `, level ${e.strengthLevel}` : ''
    const eq = e.equipment ? `, ${e.equipment}` : ''
    lines.push(
      `- ${e.ref}) ${e.name} (${e.muscleGroup}${eq}${lvl}): target ${e.targetSets}×${e.targetReps}, step ${e.stepKg}kg. Last: ${last}. Baseline: ${base}.`,
    )
  }
  return lines.join('\n')
}
