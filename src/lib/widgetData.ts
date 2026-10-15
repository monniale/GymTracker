import { db, type GymDB } from '../db/db'
import { rankForPoints, rankLabel } from './ranks'
import { localDateStr, mondayOf, parseLocalDate } from './dates'
import { nextTemplate } from './nextTemplate'

/** What the Android home-screen widget shows (pushed to native by src/native/widget.ts). */
export interface WidgetState {
  points: number
  /** "Gold II". */
  tier: string
  /** "#E8B93B". */
  tierColor: string
  streakWeeks: number
  /** Finished sessions this week (Monday on), as the streak counts them. */
  weekDone: number
  weekTarget: number
  /** Next template in the rotation, '' when there is none. */
  nextWorkout: string
  updatedAt: number
}

/** Reads everything in one read-only transaction. */
export async function gatherWidgetState(now = Date.now(), database: GymDB = db): Promise<WidgetState> {
  const weekStartMs = parseLocalDate(mondayOf(localDateStr(new Date(now)))).getTime()
  return database.transaction('r', [database.rankState, database.settings, database.sessions, database.templates], async () => {
    const [rank, settings, weekDone, templates, last] = await Promise.all([
      database.rankState.get(1),
      database.settings.get(1),
      // Same query as registerSessionForStreak / notifyData, so the numbers match the app.
      database.sessions.where('startedAt').aboveOrEqual(weekStartMs).filter(s => s.endedAt !== undefined).count(),
      database.templates.orderBy('position').toArray(),
      database.sessions.orderBy('startedAt').reverse().filter(s => s.endedAt !== undefined).first(),
    ])
    const points = Math.round(rank?.points ?? 0)
    const { tier } = rankForPoints(points)
    return {
      points,
      tier: rankLabel(tier),
      tierColor: tier.color,
      streakWeeks: rank?.streakWeeks ?? 0,
      weekDone,
      weekTarget: settings?.weeklySessionTarget ?? 3,
      nextWorkout: nextTemplate(templates, last)?.name ?? '',
      updatedAt: now,
    }
  })
}
