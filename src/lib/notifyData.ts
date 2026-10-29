import { db, type GymDB } from '../db/db'
import { addDays, localDateStr, mondayOf, weekdayOf } from './dates'
import { atLocal, nextRecapDate, recapWeekMonday, WINDOW_DAYS } from './notifyPlanner'
import type { PlannerData } from './notifyPlanner'
import { isAdjustment } from './pointsAdjust'
import type { NotifyPrefs } from './notifyPrefs'
import { sortSupplements } from './supplements'
import type { Id, MealType } from '../types'

const MEALS: MealType[] = ['breakfast', 'lunch', 'snack', 'dinner']

/**
 * Reads everything the reminder planner needs, in ONE read-only Dexie transaction (consistent
 * snapshot; never writes, so it never marks the device sync-dirty — and never calls
 * `evaluateQuests()`, which does). No Capacitor: unit-tested with fake-indexeddb.
 * `database` is injectable for tests; the app always uses the shared `db`.
 */
export async function gatherPlannerData(
  now: number,
  prefs: NotifyPrefs,
  activeSessionId: Id | null,
  database: GymDB = db,
): Promise<PlannerData> {
  const today = localDateStr(new Date(now))
  const windowDates = Array.from({ length: WINDOW_DAYS }, (_, k) => addDays(today, k))
  const weekStartMs = atLocal(mondayOf(today), '00:00')
  const recapWeek = prefs.recap.enabled ? recapWeekMonday(nextRecapDate(now, prefs.recap), prefs.recap.when) : null

  return database.transaction(
    'r',
    [database.sessions, database.dayTypes, database.foodLogs, database.waterLogs, database.settings,
      database.rankState, database.scoreEvents, database.bodyLog, database.templates,
      database.supplements, database.supplementLogs],
    async () => {
      const [around, weekDone, active, dayTypes, mealCounts, water, settings, rank, bodyRows, recap, templates,
        supplements, takenToday] = await Promise.all([
        database.sessions
          .where('startedAt').between(atLocal(addDays(today, -7), '00:00'), atLocal(addDays(today, 8), '00:00'))
          .toArray(),
        // Same query as registerSessionForStreak (season.ts), so the streak maths match.
        database.sessions.where('startedAt').aboveOrEqual(weekStartMs).filter(s => s.endedAt !== undefined).count(),
        activeSessionId !== null ? database.sessions.get(activeSessionId) : Promise.resolve(undefined),
        database.dayTypes.bulkGet(windowDates),
        Promise.all(MEALS.map(m => database.foodLogs.where('[date+meal]').equals([today, m]).count())),
        database.waterLogs.where('date').equals(today).toArray(),
        database.settings.get(1),
        database.rankState.get(1),
        database.bodyLog.bulkGet(windowDates),
        recapWeek === null
          ? Promise.resolve(null)
          : (async () => {
              const days = Array.from({ length: 7 }, (_, i) => addDays(recapWeek, i))
              const [sessions, events] = await Promise.all([
                database.sessions
                  .where('startedAt').between(atLocal(recapWeek, '00:00'), atLocal(addDays(recapWeek, 7), '00:00'))
                  .filter(s => s.endedAt !== undefined)
                  .count(),
                database.scoreEvents.where('date').anyOf(days).toArray(),
              ])
              return { weekMonday: recapWeek, sessions, points: events.filter(e => !isAdjustment(e)).reduce((a, e) => a + (e.total || 0), 0) }
            })(),
        database.templates.orderBy('position').toArray(),
        database.supplements.toArray(),
        database.supplementLogs.where('date').equals(today).toArray(),
      ])

      // Template schedule: each window date → the template scheduled that weekday (lowest position).
      const scheduledDays: Record<string, string> = {}
      for (const d of windowDates) {
        const wd = weekdayOf(d)
        const tpl = templates.find(x => x.weekdays?.includes(wd))
        if (tpl) scheduledDays[d] = tpl.name
      }

      const dayTypeOverrides: PlannerData['dayTypeOverrides'] = {}
      for (const d of dayTypes) if (d) dayTypeOverrides[d.date] = d.type

      let lastWaterAt: number | null = null
      for (const w of water) {
        if (typeof w.updatedAt === 'number' && (lastWaterAt === null || w.updatedAt > lastWaterAt)) lastWaterAt = w.updatedAt
      }

      return {
        today,
        activeSession: activeSessionId !== null,
        activeSessionStartedAt: active && active.endedAt === undefined ? active.startedAt : null,
        sessionDays: [...new Set(around.map(s => localDateStr(new Date(s.startedAt))))].sort(),
        weekSessionsDone: weekDone,
        weeklyTarget: settings?.weeklySessionTarget ?? 3,
        dayTypeOverrides,
        mealsLoggedToday: MEALS.filter((_, i) => mealCounts[i] > 0),
        waterTodayMl: water.reduce((a, w) => a + (w.ml || 0), 0),
        waterTargetMl: settings?.waterTargetMl ?? 2500,
        lastWaterAt,
        bodyLogDates: bodyRows.filter(b => b !== undefined).map(b => b!.date),
        scheduledDays,
        rank: rank
          ? {
              points: rank.points,
              seasonStart: rank.seasonStart,
              lastSessionDate: rank.lastSessionDate,
              streakWeeks: rank.streakWeeks,
              lastStreakWeek: rank.lastStreakWeek,
            }
          : null,
        recap,
        supplements: sortSupplements(supplements).map(s => ({ id: String(s.id), name: s.name, time: s.time })),
        supplementsTakenToday: takenToday.map(l => String(l.supplementId)),
      }
    },
  )
}
