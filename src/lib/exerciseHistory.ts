import { db } from '../db/db'
import { epley } from './scoring'
import { isCardioSet } from './cardio'
import { parseLocalDate } from './dates'
import { usesBodyweightLoad, withLoads } from './load'
import { computeRepMaxes, REP_BUCKETS, type RepMaxMap } from './repMax'
import type { Exercise, Id, Session, SetRow } from '../types'

/**
 * One exercise's history (Progress › exercise): every finished workout that has it, newest
 * first, with each set's effective load (src/lib/load.ts), headline stats and the rep maxes
 * that mark all-time records. Sets of unfinished sessions (the live workout, an abandoned one)
 * are left out of the list and the stats.
 */

/** A logged set with its effective load (bodyweight sets of stamped sessions count the bodyweight). */
export type HistorySet = SetRow & { loadKg: number }

export interface HistorySession {
  session: Session
  /** In the order they were done (set number, then time). */
  sets: HistorySet[]
}

/** A record-holding set and its value. */
export interface StatSet {
  set: HistorySet
  /** Epley e1RM of the set's effective load. */
  e1rm: number
}

export interface ExerciseStats {
  /** Best estimated 1RM (strength sets with a load). */
  bestE1rm?: StatSet
  /** Heaviest effective load; more reps break a tie. */
  heaviest?: StatSet
  /** Every set that is not a warm-up (drop / failure / AMRAP and cardio rows included). */
  workingSets: number
  /** Workouts with at least one set. */
  sessionCount: number
  /** completedAt of the newest set. */
  lastDone?: number
  /** Cardio rows (warm-ups excluded): total time and distance, in place of the e1RM. */
  cardio?: { totalSec: number; totalM: number }
}

export interface ExerciseHistory {
  exercise: Exercise
  /** Finished workouts, newest first. */
  sessions: HistorySession[]
  stats: ExerciseStats
  /**
   * Rep maxes of the listed sets (finished workouts only, so the stars agree with the stats),
   * by the Progress rep-max table's rules (`computeRepMaxes`, season from the rank state).
   */
  repMaxes: { allTime: RepMaxMap; season: RepMaxMap }
}

/**
 * Sets grouped by workout: only finished sessions that exist, newest first by start time;
 * sets inside a workout by set number, then time.
 */
export function groupBySession<S extends SetRow>(
  sets: S[],
  sessionsById: Map<Id, Session>,
): { session: Session; sets: S[] }[] {
  const groups = new Map<Id, { session: Session; sets: S[] }>()
  for (const s of sets) {
    const session = sessionsById.get(s.sessionId)
    if (!session || session.endedAt === undefined) continue
    const g = groups.get(s.sessionId)
    if (g) g.sets.push(s)
    else groups.set(s.sessionId, { session, sets: [s] })
  }
  const out = [...groups.values()]
  for (const g of out) g.sets.sort((a, b) => a.setNumber - b.setNumber || a.completedAt - b.completedAt)
  return out.sort((a, b) => b.session.startedAt - a.session.startedAt)
}

/** Earlier wins a tie: the first time a record was done. */
function better(a: StatSet, b: StatSet | undefined, key: (s: StatSet) => number[]): boolean {
  if (!b) return true
  const ka = key(a)
  const kb = key(b)
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] > kb[i]
  return a.set.completedAt < b.set.completedAt
}

/** Headline numbers of one exercise's sets (pass the sets of finished sessions only). */
export function exerciseStats(sets: HistorySet[]): ExerciseStats {
  let bestE1rm: StatSet | undefined
  let heaviest: StatSet | undefined
  let workingSets = 0
  let lastDone: number | undefined
  let cardio: ExerciseStats['cardio']
  const sessions = new Set<Id>()
  for (const s of sets) {
    sessions.add(s.sessionId)
    if (lastDone === undefined || s.completedAt > lastDone) lastDone = s.completedAt
    if (s.isWarmup) continue
    workingSets++
    if (isCardioSet(s)) {
      cardio ??= { totalSec: 0, totalM: 0 }
      cardio.totalSec += s.durationSec ?? 0
      cardio.totalM += s.distanceM ?? 0
      continue
    }
    // Rows without load (old unstamped 0-kg bodyweight sets) hold no strength record.
    if (s.loadKg <= 0 || s.reps < 1) continue
    const cand: StatSet = { set: s, e1rm: epley(s.loadKg, s.reps) }
    if (better(cand, bestE1rm, c => [c.e1rm])) bestE1rm = cand
    if (better(cand, heaviest, c => [c.set.loadKg, c.set.reps])) heaviest = cand
  }
  return { bestE1rm, heaviest, workingSets, sessionCount: sessions.size, lastDone, cardio }
}

/**
 * The rep-max buckets (1RM, 3RM, …) this set still holds all-time: the record is this very set
 * (same time, load and reps). Empty for warm-ups and sets that hold none.
 */
export function heldRepMaxes(
  set: Pick<HistorySet, 'completedAt' | 'loadKg' | 'reps' | 'isWarmup'>,
  allTime: RepMaxMap,
): number[] {
  if (set.isWarmup) return []
  return REP_BUCKETS.filter(n => {
    const rec = allTime.get(n)
    return !!rec && rec.completedAt === set.completedAt && rec.loadKg === set.loadKg && rec.reps === set.reps
  })
}

/** Everything the exercise history screen shows; null when the exercise does not exist. */
export async function gatherExerciseHistory(exerciseId: Id): Promise<ExerciseHistory | null> {
  const exercise = await db.exercises.get(exerciseId)
  if (!exercise) return null
  const [sets, rankState] = await Promise.all([
    db.sets
      .where('[exerciseId+completedAt]')
      .between([exerciseId, -Infinity], [exerciseId, Infinity], true, true)
      .reverse()
      .toArray(),
    db.rankState.get(1),
  ])
  const sessionIds = [...new Set(sets.map(s => s.sessionId))]
  const rows = await db.sessions.bulkGet(sessionIds)
  const sessionsById = new Map<Id, Session>()
  rows.forEach((row, i) => { if (row) sessionsById.set(sessionIds[i], row) })
  const loaded = withLoads(sets, new Map<Id, Exercise>([[exerciseId, exercise]]), sessionsById)
  const sessions = groupBySession(loaded, sessionsById)
  const listed = sessions.flatMap(g => g.sets)
  const seasonStartMs = rankState ? parseLocalDate(rankState.seasonStart).getTime() : 0
  const repMaxes = computeRepMaxes(
    listed.map(s => ({ ...s, bodyweightLoad: usesBodyweightLoad(exercise, sessionsById.get(s.sessionId)) })),
    seasonStartMs,
  )
  return { exercise, sessions, stats: exerciseStats(listed), repMaxes }
}
