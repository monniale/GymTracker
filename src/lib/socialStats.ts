import { db } from '../db/db'
import { localDateStr, mondayOf, parseLocalDate } from './dates'
import { effectiveLoad } from './load'
import type { PublicStats } from './supabaseApi'
import type { Exercise, Id, RankState, Session, SetRow } from '../types'

/** How many exercises a published profile lists (the server accepts up to 60). */
export const MAX_SHARED_LIFTS = 40

/** Matches the same exercise across accounts: catalog names are stored in English (invariant 19). */
export function liftKey(ex: Pick<Exercise, 'name'>): string {
  return ex.name.trim().toLowerCase()
}

/**
 * The workout numbers friends see (0003_social.sql `public_stats`): season points and streak,
 * finished sessions and lifted volume this week / this season, best e1RM per exercise (all time).
 * Never food, water or body weight. Pure: `collectPublicStats` feeds it from Dexie.
 */
export function buildPublicStats(input: {
  rank: Pick<RankState, 'seasonId' | 'seasonStart' | 'points' | 'streakWeeks'>
  sessions: Session[]
  sets: SetRow[]
  exercises: Exercise[]
  today: string
}): PublicStats {
  const { rank, today } = input
  const weekStart = mondayOf(today)
  const weekStartMs = parseLocalDate(weekStart).getTime()
  const seasonStartMs = parseLocalDate(rank.seasonStart).getTime()
  const finished = new Map<Id, Session>(input.sessions.filter(s => s.endedAt !== undefined).map(s => [s.id!, s]))
  const exMap = new Map(input.exercises.map(e => [e.id!, e]))

  let sessionsWeek = 0
  let sessionsSeason = 0
  for (const s of finished.values()) {
    if (s.startedAt >= seasonStartMs) sessionsSeason++
    if (s.startedAt >= weekStartMs) sessionsWeek++
  }

  let volumeWeekKg = 0
  let volumeSeasonKg = 0
  const best = new Map<string, { key: string; name: string; e1rm: number }>()
  for (const set of input.sets) {
    const session = finished.get(set.sessionId)
    if (!session || set.isWarmup) continue
    const ex = exMap.get(set.exerciseId)
    const volume = effectiveLoad(set, ex, session) * set.reps
    if (session.startedAt >= seasonStartMs) volumeSeasonKg += volume
    if (session.startedAt >= weekStartMs) volumeWeekKg += volume
    if (!ex || !(set.e1rm > 0)) continue
    const key = liftKey(ex)
    const prev = best.get(key)
    if (!prev || set.e1rm > prev.e1rm) best.set(key, { key, name: ex.name, e1rm: set.e1rm })
  }

  return {
    seasonId: rank.seasonId,
    points: Math.round(rank.points),
    streakWeeks: rank.streakWeeks,
    weekStart,
    sessionsWeek,
    sessionsSeason,
    volumeWeekKg: Math.round(volumeWeekKg),
    volumeSeasonKg: Math.round(volumeSeasonKg),
    bestLifts: [...best.values()]
      .sort((a, b) => b.e1rm - a.e1rm || a.key.localeCompare(b.key))
      .slice(0, MAX_SHARED_LIFTS)
      .map(l => ({ ...l, e1rm: Math.round(l.e1rm * 10) / 10 })),
  }
}

export async function collectPublicStats(today = localDateStr()): Promise<PublicStats | null> {
  const rank = await db.rankState.get(1)
  if (!rank) return null
  const [sessions, sets, exercises] = await Promise.all([
    db.sessions.toArray(), db.sets.toArray(), db.exercises.toArray(),
  ])
  return buildPublicStats({ rank, sessions, sets, exercises, today })
}

/**
 * A published profile as of `today`: counters of an older week read 0, and season counters of
 * an older season read null (that account has not synced since the season changed).
 */
export function currentView(stats: PublicStats, seasonId: number, today = localDateStr()): {
  points: number | null
  sessionsSeason: number | null
  volumeSeasonKg: number | null
  sessionsWeek: number
  volumeWeekKg: number
  streakWeeks: number
} {
  const sameWeek = stats.weekStart === mondayOf(today)
  const sameSeason = stats.seasonId === seasonId
  return {
    points: sameSeason ? stats.points : null,
    sessionsSeason: sameSeason ? stats.sessionsSeason : null,
    volumeSeasonKg: sameSeason ? stats.volumeSeasonKg : null,
    sessionsWeek: sameWeek ? stats.sessionsWeek : 0,
    volumeWeekKg: sameWeek ? stats.volumeWeekKg : 0,
    streakWeeks: stats.streakWeeks,
  }
}

/** Exercises both accounts have a best lift for, heaviest (for me) first. */
export function commonLifts(
  mine: PublicStats['bestLifts'],
  theirs: PublicStats['bestLifts'],
): Array<{ key: string; name: string; mine: number; theirs: number }> {
  const other = new Map(theirs.map(l => [l.key, l]))
  return mine
    .filter(l => other.has(l.key))
    .map(l => ({ key: l.key, name: l.name, mine: l.e1rm, theirs: other.get(l.key)!.e1rm }))
    .sort((a, b) => b.mine - a.mine)
}
