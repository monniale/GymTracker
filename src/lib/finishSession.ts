import { db } from '../db/db'
import { scoreSession, SCORING } from './scoring'
import { registerSessionForStreak } from './season'
import { localDateStr } from './dates'
import { parseLocalDate } from './dates'
import { effectiveLoad, setE1rm, toScoreSets } from './load'
import { isCardioExercise } from './cardio'
import type { Exercise, Id, Session, SetRow } from '../types'

export interface SeasonPriorBests {
  /** Best e1RM per exercise this season, before the given session. */
  e1rm: Map<Id, number>
  /** Best single-session volume per exercise this season, before the session. */
  volume: Map<Id, number>
}

/**
 * Season-scoped prior bests per exercise, computed from all non-warmup sets in
 * the current season that belong to a session other than `sessionId`. Shared by
 * scoring (finishSession) and the AI coach briefing so both use identical logic.
 *
 * For a stamped session (`Session.bwScoring`) only rows with an e1RM above 0
 * count, for both maps: an unweighted row (an old 0-kg bodyweight set, a cardio
 * row, a 0-kg machine set) is no best to beat, so a first weighted or first
 * bodyweight-load session never fires a fake e1RM or volume PR. An unstamped
 * (older) session keeps the old rule (every working row counts, a 0-kg row as a
 * best of 0), so re-scoring it reproduces exactly the PRs it earned when it was
 * first scored.
 *
 * One basis for prior and current values: a row of a stamped session is read
 * live (`setE1rm` / `effectiveLoad` with the exercise as it is now and that
 * row's own session), the same way the session being scored is read
 * (`toScoreSets`). So a bodyweight-share or equipment change applies to both
 * sides at once and cannot fire a fake PR. Rows of unstamped sessions keep
 * their stored e1rm (load = `weightKg`), exactly as before this feature.
 *
 * Bodyweight exercises (equipment 'bodyweight'): a stamped session's load is
 * bodyweight × factor + added kg while an older session's is the added kg
 * only, so the two units never mix: only prior rows from sessions with the same
 * stamp as `sessionId` count. Older unstamped bodyweight rows (0 kg or added
 * kg) therefore add nothing to a stamped session's prior e1RM or volume, and
 * the first stamped session just sets the season's first best.
 */
export async function gatherSeasonPriorBests(
  sessionId: Id,
  sets: SetRow[],
): Promise<SeasonPriorBests> {
  const state = await db.rankState.get(1)
  const seasonStartMs = state ? parseLocalDate(state.seasonStart).getTime() : 0

  const exerciseIds = [...new Set(sets.map(s => s.exerciseId))]
  const e1rm = new Map<Id, number>()
  const volume = new Map<Id, number>()
  const session = await db.sessions.get(sessionId)
  const stamped = session?.bwScoring === true
  const exercises = await db.exercises.bulkGet(exerciseIds)
  const sessionsById = new Map<Id, Session>()

  for (const [i, exId] of exerciseIds.entries()) {
    const ex = exercises[i]
    let prior = await db.sets
      .where('[exerciseId+completedAt]')
      .between([exId, seasonStartMs], [exId, Infinity])
      .filter(s => s.sessionId !== sessionId && !s.isWarmup)
      .toArray()
    if (prior.length === 0) continue

    const missing = [...new Set(prior.map(s => s.sessionId))].filter(id => !sessionsById.has(id))
    if (missing.length > 0) {
      const rows = await db.sessions.bulkGet(missing)
      rows.forEach((row, j) => { if (row) sessionsById.set(missing[j], row) })
    }
    if (ex?.equipment === 'bodyweight' && !isCardioExercise(ex)) {
      prior = prior.filter(s => (sessionsById.get(s.sessionId)?.bwScoring === true) === stamped)
    }

    const rows = prior
      .map(s => {
        const own = sessionsById.get(s.sessionId)
        const live = own?.bwScoring === true
        return { s, own, e1rm: live ? setE1rm(s, ex, own) : s.e1rm }
      })
      .filter(r => !stamped || r.e1rm > 0)
    if (rows.length === 0) continue

    e1rm.set(exId, Math.max(...rows.map(r => r.e1rm)))
    const volBySession = new Map<Id, number>()
    for (const { s, own } of rows) {
      const load = effectiveLoad(s, ex, own)
      volBySession.set(s.sessionId, (volBySession.get(s.sessionId) ?? 0) + load * s.reps)
    }
    volume.set(exId, Math.max(...volBySession.values()))
  }
  return { e1rm, volume }
}

/**
 * Re-computes the stored e1rm of every set of `exercise` that belongs to a
 * stamped session, after its bodyweight share, equipment or kind changed
 * (NoteSheet). The e1rm then matches the live load that every reader computes
 * (PR wall, prior bests, rep maxes), on finished workouts too. Points already
 * earned are not re-scored here; an edited workout re-scores at the new load.
 * Unstamped sessions are left alone (their load is `weightKg` whatever the
 * exercise says). Call it inside a transaction over `db.sets` + `db.sessions`.
 * Returns how many rows changed.
 */
export async function refreshStampedE1rm(exercise: Exercise): Promise<number> {
  const rows = await db.sets.where('exerciseId').equals(exercise.id!).toArray()
  const ids = [...new Set(rows.map(r => r.sessionId))]
  const sessions = await db.sessions.bulkGet(ids)
  const byId = new Map<Id, Session>()
  sessions.forEach((row, i) => { if (row) byId.set(ids[i], row) })
  let changed = 0
  for (const r of rows) {
    const own = byId.get(r.sessionId)
    if (own?.bwScoring !== true) continue
    const e1rm = setE1rm(r, exercise, own)
    if (e1rm !== r.e1rm) {
      await db.sets.update(r.id!, { e1rm })
      changed++
    }
  }
  return changed
}

/** Exercises by id (for the set loads) and their stored English names (for the breakdown). */
function exerciseMaps(ids: Id[], rows: (Exercise | undefined)[]) {
  const exMap = new Map<Id, Exercise>()
  const exerciseNames = new Map<Id, string>()
  ids.forEach((id, i) => {
    const ex = rows[i]
    if (ex) exMap.set(id, ex)
    exerciseNames.set(id, ex?.name ?? 'Exercise')
  })
  return { exMap, exerciseNames }
}

/**
 * Closes a session: gathers season-scoped prior bests, scores it, records the
 * score event and updates rank points. Returns the scored total, or null when
 * the session had no sets (it is then deleted instead).
 */
export async function finishSession(sessionId: Id): Promise<number | null> {
  const session = await db.sessions.get(sessionId)
  if (!session) return null

  const sets = await db.sets.where('sessionId').equals(sessionId).toArray()
  if (sets.length === 0) {
    await db.sessions.delete(sessionId)
    return null
  }

  const { e1rm: priorBestE1rm, volume: priorBestVolume } = await gatherSeasonPriorBests(sessionId, sets)

  const exerciseIds = [...new Set(sets.map(s => s.exerciseId))]

  const dayStart = new Date(session.startedAt)
  dayStart.setHours(0, 0, 0, 0)
  const sameDayFinished = await db.sessions
    .where('startedAt').aboveOrEqual(dayStart.getTime())
    .filter(s => s.id !== sessionId && s.endedAt !== undefined
      && new Date(s.startedAt).toDateString() === dayStart.toDateString())
    .count()

  const now = Date.now()
  const streakWeeks = await registerSessionForStreak(now)

  const exercises = await db.exercises.bulkGet(exerciseIds)
  const { exMap, exerciseNames } = exerciseMaps(exerciseIds, exercises)

  const result = scoreSession({
    sets: toScoreSets(sets, exMap, session),
    bodyweightKg: session.bodyweightKg,
    priorBestE1rm,
    priorBestVolume,
    streakWeeks,
    isFirstSessionOfDay: sameDayFinished === 0,
    exerciseNames,
  })

  await db.transaction('rw', db.sessions, db.scoreEvents, db.rankState, async () => {
    await db.sessions.update(sessionId, { endedAt: now, points: result.total })
    await db.scoreEvents.add({
      sessionId,
      // Bucket the event by the day the workout STARTED (stable, and identical to
      // what rescoreSession uses) — not the finish instant, which can differ for
      // a session that spans local midnight.
      date: localDateStr(new Date(session.startedAt)),
      basePoints: result.basePoints,
      prBonus: result.prBonus,
      streakMult: result.streakMult,
      dayFactor: result.dayFactor,
      total: result.total,
      breakdown: result.breakdown,
    })
    const rs = await db.rankState.get(1)
    if (rs) {
      rs.points = Math.max(0, Math.round(rs.points + result.total))
      await db.rankState.put(rs)
    }
  })

  return result.total
}

/**
 * Re-score an ALREADY-finished session after its sets or details were edited.
 * Unlike finishSession this is idempotent and safe to re-run: it UPDATES the
 * existing score event (never adds a duplicate) and applies only the points
 * DELTA to the rank.
 *
 * streakMult AND dayFactor are HISTORICAL finish-context — they depend on when
 * the session happened relative to others, NOT on its (edited) set values — so
 * they are CARRIED from the stored event. Recomputing dayFactor here would be
 * wrong: at edit time every same-day session is already finished, so the "first
 * session of the day" test collapses the day's primary session to 0.25 and
 * silently craters the rank on any edit. Only basePoints/prBonus/breakdown
 * (which depend on set values) are recomputed.
 *
 * KNOWN LIMITATION (accepted): PR bonuses are season-relative and only THIS
 * session is re-evaluated, so editing an old session's e1RM/volume upward can
 * leave a later session's already-granted PR bonus in place (rank drifts above a
 * from-scratch recompute, bounded by prBonusCap). A full season-wide recompute
 * would be needed to close this; matches the app's existing "points kept" stance.
 */
export async function rescoreSession(sessionId: Id): Promise<number | null> {
  const session = await db.sessions.get(sessionId)
  if (!session || session.endedAt === undefined) return null

  const sets = await db.sets.where('sessionId').equals(sessionId).toArray()
  const event = await db.scoreEvents.where('sessionId').equals(sessionId).first()

  const { e1rm: priorBestE1rm, volume: priorBestVolume } = await gatherSeasonPriorBests(sessionId, sets)
  const exerciseIds = [...new Set(sets.map(s => s.exerciseId))]
  const exercises = await db.exercises.bulkGet(exerciseIds)
  const { exMap, exerciseNames } = exerciseMaps(exerciseIds, exercises)

  // Carry the streak + first-of-day context from the stored event so scoring
  // reproduces the same streakMult/dayFactor it originally earned.
  const carriedStreakWeeks = event ? Math.round((event.streakMult - 1) / SCORING.streakStep) : 0
  const carriedFirstOfDay = event ? event.dayFactor === 1 : true

  const result = scoreSession({
    sets: toScoreSets(sets, exMap, session),
    bodyweightKg: session.bodyweightKg,
    priorBestE1rm,
    priorBestVolume,
    streakWeeks: carriedStreakWeeks,
    isFirstSessionOfDay: carriedFirstOfDay,
    exerciseNames,
  })

  const eventDate = localDateStr(new Date(session.startedAt))

  await db.transaction('rw', db.sessions, db.scoreEvents, db.rankState, async () => {
    // Re-read the event INSIDE the txn so the rank delta stays atomic even if two
    // rescores overlap (the later one sees the earlier one's committed total).
    const ev = await db.scoreEvents.where('sessionId').equals(sessionId).first()
    const oldTotal = ev?.total ?? session.points ?? 0
    await db.sessions.update(sessionId, { points: result.total })
    const fields = {
      date: eventDate,
      basePoints: result.basePoints,
      prBonus: result.prBonus,
      streakMult: result.streakMult,
      dayFactor: result.dayFactor,
      total: result.total,
      breakdown: result.breakdown,
    }
    if (ev) await db.scoreEvents.update(ev.id!, fields)
    else await db.scoreEvents.add({ sessionId, ...fields })
    const rs = await db.rankState.get(1)
    // A workout from an earlier season (or imported history) never counted toward this season's
    // rank, so editing it must not move it either.
    if (rs && eventDate >= rs.seasonStart) {
      rs.points = Math.max(0, Math.round(rs.points + (result.total - oldTotal)))
      await db.rankState.put(rs)
    }
  })

  return result.total
}
