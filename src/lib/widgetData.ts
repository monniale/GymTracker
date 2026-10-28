import { db, type GymDB } from '../db/db'
import { rankForPoints, rankLabel } from './ranks'
import { addDays, localDateStr, mondayOf, parseLocalDate, weekdayOf } from './dates'
import { nextTemplate, templatesDoneOn, type NextTemplate } from './nextTemplate'
import { nextProgramTemplate } from './programs'
import type { Program, Session, WorkoutTemplate } from '../types'

/**
 * The workout to do next, for WorkoutHome and the widget. A template scheduled for today
 * (`nextTemplate` reason 'today', any template) wins; otherwise, while a program is running, its
 * own rotation (`nextProgramTemplate`, from the last finished session of one of its templates);
 * otherwise the plain rotation of all templates. So with a schedule and a program both set, the
 * schedule wins on its days and the program fills the others.
 */
export function pickNextWorkout<T extends Pick<WorkoutTemplate, 'id' | 'position' | 'weekdays'>>(
  templates: T[],
  lastFinished: Pick<Session, 'templateId' | 'startedAt'> | undefined,
  today: string,
  doneToday: ReadonlySet<string> | undefined,
  program?: { program: Pick<Program, 'templateIds'>; lastSession: Pick<Session, 'templateId' | 'startedAt'> | undefined },
): NextTemplate<T> | null {
  const plain = nextTemplate(templates, lastFinished, today, doneToday)
  if (!program || plain?.reason === 'today') return plain
  return nextProgramTemplate(program.program, templates, program.lastSession, today, doneToday) ?? plain
}

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
  /** Next template (`pickNextWorkout`: today's scheduled one, else the running program's rotation,
   * else the rotation of all templates), '' when there is none. */
  nextWorkout: string
  /**
   * Next local midnight: past it, the widget shows the pick of the current weekday from
   * `nextWorkoutByDay` without waiting for the app (the pick depends on the weekday schedule).
   */
  nextWorkoutUntil: number
  /** Tomorrow's pick if nothing else is finished today, '' when there is none. */
  nextWorkoutTomorrow: string
  /**
   * The pick of each later day if nothing else is finished before it, indexed by `Date.getDay()`
   * (0 = Sunday); today's index holds the pick a week from now. Nothing finished means the same
   * last session, so the pick repeats every week and these 7 names cover any number of days
   * with the app closed.
   */
  nextWorkoutByDay: string[]
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
  const tables = [database.rankState, database.settings, database.sessions, database.templates, database.programs]
  return database.transaction('r', tables, async () => {
    const [rank, settings, weekDone, templates, last, startedToday, programs] = await Promise.all([
      database.rankState.get(1),
      database.settings.get(1),
      // Same query as registerSessionForStreak / notifyData, so the numbers match the app.
      database.sessions.where('startedAt').aboveOrEqual(weekStartMs).filter(s => s.endedAt !== undefined).count(),
      database.templates.orderBy('position').toArray(),
      database.sessions.orderBy('startedAt').reverse().filter(s => s.endedAt !== undefined).first(),
      database.sessions.where('startedAt').aboveOrEqual(parseLocalDate(today).getTime()).toArray(),
      database.programs.toArray(),
    ])
    // The running program (same rule as programs.activeProgram: started, not stopped, newest).
    const active = programs
      .filter(p => !!p.cycleStartDate && p.endedAt === undefined)
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || (b.cycleStartDate ?? '').localeCompare(a.cycleStartDate ?? ''))[0]
    let program: Parameters<typeof pickNextWorkout>[4]
    if (active) {
      const ids = new Set(active.templateIds.map(String))
      const lastSession = await database.sessions.orderBy('startedAt').reverse()
        .filter(s => s.endedAt !== undefined && s.templateId !== undefined && ids.has(String(s.templateId)))
        .first()
      program = { program: active, lastSession }
    }
    const later = (date: string) => pickNextWorkout(templates, last, date, new Set(), program)?.template.name ?? ''
    const nextWorkoutByDay: string[] = Array(7).fill('')
    for (let k = 1; k <= 7; k++) {
      const date = addDays(today, k)
      nextWorkoutByDay[weekdayOf(date)] = later(date)
    }
    const points = Math.round(rank?.points ?? 0)
    const { tier } = rankForPoints(points)
    return {
      points,
      tier: rankLabel(tier),
      tierColor: tier.color,
      streakWeeks: rank?.streakWeeks ?? 0,
      weekDone,
      weekTarget: settings?.weeklySessionTarget ?? 3,
      nextWorkout: pickNextWorkout(templates, last, today, templatesDoneOn(startedToday, today), program)?.template.name ?? '',
      nextWorkoutUntil: parseLocalDate(tomorrow).getTime(),
      nextWorkoutTomorrow: later(tomorrow),
      nextWorkoutByDay,
      weekEndsAt,
      updatedAt: now,
    }
  })
}
