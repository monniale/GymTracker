import { db } from '../db/db'
import { localDateStr, daysBetween, mondayOf, addDays } from './dates'
import {
  SEASON_DAYS, DECAY_GRACE_DAYS, DECAY_PER_DAY, DECAY_MAX, SEASON_CARRYOVER,
  rankForPoints, rankLabel,
} from './ranks'

/**
 * Idempotent maintenance run on every app launch:
 * - rolls the season over when 12 weeks have passed (archives the old one),
 * - resets a broken weekly streak,
 * - applies idle decay (3%/day after 7 sessionless days, max 25% per idle streak).
 */
export async function runDailyChecks(): Promise<void> {
  const state = await db.rankState.get(1)
  if (!state) return
  const today = localDateStr()
  let changed = false

  if (daysBetween(state.seasonStart, today) >= SEASON_DAYS) {
    const info = rankForPoints(state.points)
    await db.seasons.add({
      seasonId: state.seasonId,
      startDate: state.seasonStart,
      endDate: addDays(state.seasonStart, SEASON_DAYS - 1),
      finalPoints: Math.round(state.points),
      finalRank: rankLabel(info.tier),
    })
    state.seasonId += 1
    state.seasonStart = today
    state.points = Math.round(state.points * SEASON_CARRYOVER)
    state.streakWeeks = 0
    state.lastStreakWeek = ''
    state.idleDecayTaken = 0
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

  if (changed || state.lastDecayCheckDate !== today) {
    state.lastDecayCheckDate = today
    await db.rankState.put(state)
  }
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
