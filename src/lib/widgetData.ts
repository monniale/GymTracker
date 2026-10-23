import { db, type GymDB } from '../db/db'
import { rankForPoints, rankLabel } from './ranks'
import { addDays, localDateStr, mondayOf, parseLocalDate } from './dates'
import { nextTemplate, templatesDoneOn } from './nextTemplate'

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
  /** Next template (today's scheduled one, else the rotation; `nextTemplate`), '' when there is none. */
  nextWorkout: string
  /**
   * Next local midnight: past it, the widget shows `nextWorkoutTomorrow` without waiting for the
   * app (the pick depends on the weekday schedule). Later days stay on that name until the app
   * pushes again.
   */
  nextWorkoutUntil: number
  /** Tomorrow's pick if nothing else is finished today, '' when there is none. */
  nextWorkoutTomorrow: string
  /** Next Monday 00:00 local: past it, the widget shows 0 for this week without waiting for the app. */
  weekEndsAt: number
  updatedAt: number
}

/** Reads everything in one read-only transaction. */
export async function gatherWidgetState(now = Date.now(), database: GymDB = db): Promise<WidgetState> {
  const today = localDateStr(new Date(now))
  const monday = mondayOf(today)
  const weekStartMs = parseLocalDate(monday).getTime()
  const weekEndsAt = parseLocalDate(addDays(monday, 7)).getTime()
  const tomorrow = addDays(today, 1)
  return database.transaction('r', [database.rankState, database.settings, database.sessions, database.templates], async () => {
    const [rank, settings, weekDone, templates, last, startedToday] = await Promise.all([
      database.rankState.get(1),
      database.settings.get(1),
      // Same query as registerSessionForStreak / notifyData, so the numbers match the app.
      database.sessions.where('startedAt').aboveOrEqual(weekStartMs).filter(s => s.endedAt !== undefined).count(),
      database.templates.orderBy('position').toArray(),
      database.sessions.orderBy('startedAt').reverse().filter(s => s.endedAt !== undefined).first(),
      database.sessions.where('startedAt').aboveOrEqual(parseLocalDate(today).getTime()).toArray(),
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
      nextWorkout: nextTemplate(templates, last, today, templatesDoneOn(startedToday, today))?.template.name ?? '',
      nextWorkoutUntil: parseLocalDate(tomorrow).getTime(),
      nextWorkoutTomorrow: nextTemplate(templates, last, tomorrow, new Set())?.template.name ?? '',
      weekEndsAt,
      updatedAt: now,
    }
  })
}
