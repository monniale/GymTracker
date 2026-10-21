import { localDateStr, addDays, mondayOf, parseLocalDate, MONTH_NAMES } from './dates'
import type { Session } from '../types'

/** One day of the training heatmap. */
export interface HeatCell {
  date: string
  /** Finished workouts started that local day. */
  count: number
  /** After `today`: drawn as an empty dashed cell. */
  future: boolean
}

export interface HeatColumn {
  /** Monday of this column's week (weeks start Monday, as `mondayOf`). */
  monday: string
  /** Monday → Sunday. */
  days: HeatCell[]
}

export interface TrainingHeatmap {
  columns: HeatColumn[]
  /** Column index + short month name where a new month starts (labels never closer than 3 columns). */
  monthTicks: { col: number; label: string }[]
  /** Distinct training days in `today`'s calendar year, up to today. */
  daysThisYear: number
  /** Longest run of consecutive weeks with at least one workout, over all history. */
  longestRunWeeks: number
  /** Consecutive trained weeks ending this week (or last week, while this one has none yet). */
  currentRunWeeks: number
}

/** Columns closer than this drop the later month label (they would overlap). */
const MIN_TICK_GAP = 3

/**
 * GitHub-style consistency grid: one column per week, one row per weekday.
 * Only finished sessions count, bucketed by the local date they started on
 * (same rule as the Past workouts calendar). `from` starts the grid at that
 * date's week instead of `weeks` back from today.
 */
export function trainingHeatmap(
  sessions: Pick<Session, 'startedAt' | 'endedAt'>[],
  today: string,
  { weeks = 26, from }: { weeks?: number; from?: string } = {},
): TrainingHeatmap {
  const byDay = new Map<string, number>()
  for (const s of sessions) {
    if (s.endedAt === undefined) continue
    const key = localDateStr(new Date(s.startedAt))
    byDay.set(key, (byDay.get(key) ?? 0) + 1)
  }

  const thisMonday = mondayOf(today)
  let start = from ? mondayOf(from) : addDays(thisMonday, -(Math.max(1, weeks) - 1) * 7)
  if (start > thisMonday) start = thisMonday

  const columns: HeatColumn[] = []
  for (let monday = start; monday <= thisMonday; monday = addDays(monday, 7)) {
    const days = Array.from({ length: 7 }, (_, i) => {
      const date = addDays(monday, i)
      return { date, count: date > today ? 0 : (byDay.get(date) ?? 0), future: date > today }
    })
    columns.push({ monday, days })
  }

  const monthTicks: TrainingHeatmap['monthTicks'] = []
  columns.forEach((c, i) => {
    const month = parseLocalDate(c.monday).getMonth()
    const prev = i > 0 ? parseLocalDate(columns[i - 1].monday).getMonth() : -1
    if (month === prev) return
    const last = monthTicks[monthTicks.length - 1]
    if (last && i - last.col < MIN_TICK_GAP) {
      // The first column is usually a partial month: let the real month start win.
      if (last.col === 0) monthTicks.pop()
      else return
    }
    monthTicks.push({ col: i, label: MONTH_NAMES[month] })
  })

  const year = today.slice(0, 4)
  let daysThisYear = 0
  for (const day of byDay.keys()) if (day.startsWith(year) && day <= today) daysThisYear++

  const trainedWeeks = new Set<string>()
  for (const day of byDay.keys()) if (day <= today) trainedWeeks.add(mondayOf(day))
  const sorted = [...trainedWeeks].sort()
  let longestRunWeeks = 0
  let run = 0
  sorted.forEach((m, i) => {
    run = i > 0 && addDays(sorted[i - 1], 7) === m ? run + 1 : 1
    longestRunWeeks = Math.max(longestRunWeeks, run)
  })

  // The current week is still open: no workout yet doesn't break the run.
  let cursor = trainedWeeks.has(thisMonday) ? thisMonday : addDays(thisMonday, -7)
  let currentRunWeeks = 0
  while (trainedWeeks.has(cursor)) {
    currentRunWeeks++
    cursor = addDays(cursor, -7)
  }

  return { columns, monthTicks, daysThisYear, longestRunWeeks, currentRunWeeks }
}

/** Colour step for a day: 0 = none, 1, 2, 3 = three or more workouts. */
export function heatLevel(count: number): 0 | 1 | 2 | 3 {
  return count <= 0 ? 0 : count >= 3 ? 3 : (count as 1 | 2)
}
