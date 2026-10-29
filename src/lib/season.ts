import { db } from '../db/db'
import { localDateStr, daysBetween, mondayOf, addDays, parseLocalDate } from './dates'
import {
  SEASON_DAYS, DECAY_GRACE_DAYS, DECAY_PER_DAY, DECAY_MAX, SEASON_CARRYOVER,
  rankForPoints, rankLabelEn,
} from './ranks'
import { effectiveLoad } from './load'
import type { RankState, Season } from '../types'

/** The season that follows an archived one, when it is not simply "a new local season from today". */
export interface NextSeason {
  seasonId: number
  seasonStart: string
  /** The shared season's last day (`RankState.seasonEndsOn`). */
  seasonEndsOn: string
}

/**
 * Archives the running season (with recap stats) and starts the next one: `next` (the shared
 * season) or a new local season from today. Score events dated on or after the next season's
 * start move into it, so the points stay what `rankPointsFor` (the merge truth) recomputes:
 * carry-over of the archived season + this season's events.
 */
export async function archiveCurrentSeason(endDate: string, next?: NextSeason): Promise<void> {
  const state = await db.rankState.get(1)
  if (!state) return

  const nextStart = next?.seasonStart ?? localDateStr()
  const seasonStartMs = parseLocalDate(state.seasonStart).getTime()
  const nextStartMs = parseLocalDate(nextStart).getTime()
  const sessions = await db.sessions
    .where('startedAt').between(seasonStartMs, nextStartMs)
    .filter(s => s.endedAt !== undefined)
    .toArray()
  const byId = new Map(sessions.map(s => [s.id!, s]))
  const sets = (await db.sets.toArray()).filter(s => byId.has(s.sessionId) && !s.isWarmup)
  const exMap = new Map((await db.exercises.toArray()).map(e => [e.id!, e]))
  let recap: Season['recap'] = {
    sessions: sessions.length,
    // Effective load: bodyweight sets of a stamped session count the bodyweight moved.
    totalVolumeKg: Math.round(
      sets.reduce((a, s) => a + effectiveLoad(s, exMap.get(s.exerciseId), byId.get(s.sessionId)) * s.reps, 0),
    ),
  }
  const best = sets.reduce<typeof sets[number] | null>(
    (acc, s) => (acc === null || s.e1rm > acc.e1rm ? s : acc), null)
  if (best) {
    const ex = exMap.get(best.exerciseId)
    recap = { ...recap, bestLift: { exerciseName: ex?.name ?? 'Exercise', e1rm: Math.round(best.e1rm * 10) / 10 } }
  }

  const movedFrom = nextStart > state.seasonStart ? nextStart : state.seasonStart
  const moved = (await db.scoreEvents.where('date').aboveOrEqual(movedFrom).toArray())
    .reduce((a, e) => a + e.total, 0)
  const finalPoints = Math.max(0, Math.round(state.points - moved))

  // A key every device derives alike: two devices that archive the same season write one row.
  await db.seasons.put({
    id: `season-${state.seasonId}-${state.seasonStart}`,
    seasonId: state.seasonId,
    startDate: state.seasonStart,
    endDate,
    finalPoints,
    finalRank: rankLabelEn(rankForPoints(finalPoints).tier),
    recap,
  })
  state.seasonId = next?.seasonId ?? state.seasonId + 1
  state.seasonStart = nextStart
  if (next) {
    state.sharedSeason = true
    state.seasonEndsOn = next.seasonEndsOn
  }
  state.points = Math.round(finalPoints * SEASON_CARRYOVER) + moved
  state.streakWeeks = 0
  state.lastStreakWeek = ''
  state.idleDecayTaken = 0
  await db.rankState.put(state)
}

/**
 * Brings the rank state onto the shared season (`current_season`, 0003_social.sql); run after
 * each cloud pull, on the sync lock. Returns whether it wrote.
 * - Same season, or an older one (this device already rolled over offline): only the end day is
 *   taken from the server.
 * - A newer season, or the first time on the shared one: a running season that started before the
 *   shared one is archived and the shared one starts with the usual carry-over; one that started
 *   on or after it simply becomes it (renumbered, its points and start kept).
 */
export async function followGlobalSeason(g: { id: number; startedOn: string; endsOn: string }): Promise<boolean> {
  const state = await db.rankState.get(1)
  if (!state) return false
  if (state.sharedSeason && state.seasonId >= g.id) {
    if (state.seasonId !== g.id || state.seasonEndsOn === g.endsOn) return false
    state.seasonEndsOn = g.endsOn
    await db.rankState.put(state)
    return true
  }
  if (state.seasonStart >= g.startedOn) {
    state.seasonId = g.id
    state.sharedSeason = true
    state.seasonEndsOn = g.endsOn
    await db.rankState.put(state)
    return true
  }
  await archiveCurrentSeason(addDays(g.startedOn, -1), { seasonId: g.id, seasonStart: g.startedOn, seasonEndsOn: g.endsOn })
  return true
}

/** The running season's last day: the shared season's from the server, else 12 weeks from its start. */
export function seasonLastDay(state: Pick<RankState, 'seasonStart' | 'seasonEndsOn' | 'sharedSeason'>): string {
  return state.sharedSeason && state.seasonEndsOn ? state.seasonEndsOn : addDays(state.seasonStart, SEASON_DAYS - 1)
}

/**
 * Idempotent maintenance run on every app launch:
 * - rolls the season over after its last day (archives the old one),
 * - resets a broken weekly streak,
 * - applies idle decay (3%/day after 7 sessionless days, max 25% per idle streak).
 */
export async function runDailyChecks(): Promise<void> {
  const state = await db.rankState.get(1)
  if (!state) return
  const today = localDateStr()
  let changed = false

  const lastDay = seasonLastDay(state)
  if (today > lastDay) {
    // The shared season also rolls over every SEASON_DAYS on the server: follow it offline (the
    // next sync corrects an early end). A device-local season restarts today.
    let next: NextSeason | undefined
    if (state.sharedSeason && state.seasonEndsOn) {
      const skipped = Math.floor(daysBetween(addDays(lastDay, 1), today) / SEASON_DAYS)
      const seasonStart = addDays(lastDay, 1 + skipped * SEASON_DAYS)
      next = { seasonId: state.seasonId + 1 + skipped, seasonStart, seasonEndsOn: addDays(seasonStart, SEASON_DAYS - 1) }
    }
    await archiveCurrentSeason(lastDay, next)
    const rolled = await db.rankState.get(1)
    if (rolled) Object.assign(state, rolled)
    changed = true
  }

  // Streak broken: a full week passed since the last week the target was met.
  if (state.lastStreakWeek && state.streakWeeks > 0
    && daysBetween(state.lastStreakWeek, mondayOf(today)) > 7) {
    state.streakWeeks = 0
    changed = true
  }

  // Idle decay, computed idempotently against the whole current idle streak.
  const lastActive = state.lastSessionDate ?? state.seasonStart
  const idleDays = daysBetween(lastActive, today)
  if (idleDays > DECAY_GRACE_DAYS && state.points > 0) {
    const owedPct = Math.min((idleDays - DECAY_GRACE_DAYS) * DECAY_PER_DAY, DECAY_MAX)
    const pointsBeforeDecay = state.points + state.idleDecayTaken
    const owedPoints = Math.round(pointsBeforeDecay * owedPct)
    const delta = owedPoints - state.idleDecayTaken
    if (delta > 0) {
      state.points = Math.max(0, state.points - delta)
      state.idleDecayTaken = owedPoints
      changed = true
    }
  }

  // A bookkeeping-only write must not stamp the untouched seed row (updatedAt 0, seed.ts): it
  // would then win a sync merge against the real rank state of another device.
  if (changed || (state.lastDecayCheckDate !== today && state.updatedAt !== 0)) {
    state.lastDecayCheckDate = today
    await db.rankState.put(state)
  }
}

let dailyChecksInFlight: Promise<void> | null = null

/**
 * Single-flight `runDailyChecks`: callers that overlap (launch, Android resume, the midnight tick)
 * share one run instead of racing its non-transactional read-modify-write (a season rollover
 * twice would archive two `seasons` rows). Sequential calls still each run (it is idempotent).
 */
export function runDailyChecksOnce(): Promise<void> {
  if (!dailyChecksInFlight) {
    dailyChecksInFlight = runDailyChecks().finally(() => {
      dailyChecksInFlight = null
    })
  }
  return dailyChecksInFlight
}

/**
 * Called when a session is finished, BEFORE scoring. Marks activity (resets the
 * idle-decay window), updates the weekly streak if this session meets the
 * weekly target, and returns the streak value to score with.
 */
export async function registerSessionForStreak(nowMs: number): Promise<number> {
  const state = await db.rankState.get(1)
  const settings = await db.settings.get(1)
  if (!state || !settings) return 0

  const today = localDateStr(new Date(nowMs))
  const weekMonday = mondayOf(today)
  const weekStartMs = new Date(weekMonday + 'T00:00:00').getTime()

  // Sessions finished this week, plus the one being finished right now.
  const thisWeek = await db.sessions
    .where('startedAt').aboveOrEqual(weekStartMs)
    .filter(s => s.endedAt !== undefined)
    .count()
  const sessionsThisWeek = thisWeek + 1

  if (sessionsThisWeek >= settings.weeklySessionTarget && state.lastStreakWeek !== weekMonday) {
    state.streakWeeks = state.lastStreakWeek && daysBetween(state.lastStreakWeek, weekMonday) === 7
      ? state.streakWeeks + 1
      : 1
    state.lastStreakWeek = weekMonday
  }

  state.lastSessionDate = today
  state.idleDecayTaken = 0
  await db.rankState.put(state)
  return state.streakWeeks
}
