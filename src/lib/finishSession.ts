import { db } from '../db/db'
import { scoreSession, SCORING } from './scoring'
import { registerSessionForStreak } from './season'
import { localDateStr } from './dates'
import { parseLocalDate } from './dates'
import type { Id, SetRow } from '../types'

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

  for (const exId of exerciseIds) {
    const prior = await db.sets
      .where('[exerciseId+completedAt]')
      .between([exId, seasonStartMs], [exId, Infinity])
      .filter(s => s.sessionId !== sessionId && !s.isWarmup)
      .toArray()
    if (prior.length === 0) continue
    e1rm.set(exId, Math.max(...prior.map(s => s.e1rm)))
    const volBySession = new Map<Id, number>()
    for (const s of prior) {
      volBySession.set(s.sessionId, (volBySession.get(s.sessionId) ?? 0) + s.weightKg * s.reps)
    }
    volume.set(exId, Math.max(...volBySession.values()))
  }
  return { e1rm, volume }
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
  const exerciseNames = new Map<Id, string>()
  exerciseIds.forEach((id, i) => exerciseNames.set(id, exercises[i]?.name ?? 'Exercise'))

  const result = scoreSession({
    sets,
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
  const exerciseNames = new Map<Id, string>()
  exerciseIds.forEach((id, i) => exerciseNames.set(id, exercises[i]?.name ?? 'Exercise'))

  // Carry the streak + first-of-day context from the stored event so scoring
  // reproduces the same streakMult/dayFactor it originally earned.
  const carriedStreakWeeks = event ? Math.round((event.streakMult - 1) / SCORING.streakStep) : 0
  const carriedFirstOfDay = event ? event.dayFactor === 1 : true

  const result = scoreSession({
    sets,
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
    if (rs) {
      rs.points = Math.max(0, Math.round(rs.points + (result.total - oldTotal)))
      await db.rankState.put(rs)
    }
  })

  return result.total
}
