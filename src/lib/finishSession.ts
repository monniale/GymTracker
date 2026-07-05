import { db } from '../db/db'
import { scoreSession } from './scoring'
import { registerSessionForStreak } from './season'
import { localDateStr } from './dates'
import { parseLocalDate } from './dates'

/**
 * Closes a session: gathers season-scoped prior bests, scores it, records the
 * score event and updates rank points. Returns the scored total, or null when
 * the session had no sets (it is then deleted instead).
 */
export async function finishSession(sessionId: number): Promise<number | null> {
  const session = await db.sessions.get(sessionId)
  if (!session) return null

  const sets = await db.sets.where('sessionId').equals(sessionId).toArray()
  if (sets.length === 0) {
    await db.sessions.delete(sessionId)
    return null
  }

  const state = await db.rankState.get(1)
  const seasonStartMs = state ? parseLocalDate(state.seasonStart).getTime() : 0

  const exerciseIds = [...new Set(sets.map(s => s.exerciseId))]
  const priorBestE1rm = new Map<number, number>()
  const priorBestVolume = new Map<number, number>()

  for (const exId of exerciseIds) {
    const prior = await db.sets
      .where('[exerciseId+completedAt]')
      .between([exId, seasonStartMs], [exId, Infinity])
      .filter(s => s.sessionId !== sessionId && !s.isWarmup)
      .toArray()
    if (prior.length === 0) continue
    priorBestE1rm.set(exId, Math.max(...prior.map(s => s.e1rm)))
    const volBySession = new Map<number, number>()
    for (const s of prior) {
      volBySession.set(s.sessionId, (volBySession.get(s.sessionId) ?? 0) + s.weightKg * s.reps)
    }
    priorBestVolume.set(exId, Math.max(...volBySession.values()))
  }

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
  const exerciseNames = new Map<number, string>()
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
