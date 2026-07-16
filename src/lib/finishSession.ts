import { db } from '../db/db'
import { scoreSession } from './scoring'
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
      date: localDateStr(new Date(now)),
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
