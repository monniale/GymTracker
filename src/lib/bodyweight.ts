import { addDays, daysBetween, parseLocalDate, startOfMonth } from './dates'
import type { BodyLogEntry } from '../types'

/**
 * Pure helpers for the bodyweight history screen (Progress › Bodyweight): range
 * filtering, a trailing moving average, the recent weekly rate, and the "story"
 * — every weigh-in grouped by month with its change and milestone badges.
 * Entries are `db.bodyLog` rows (one per local day); inputs need not be sorted.
 */

export type WeightRange = '1m' | '3m' | '6m' | '1y' | 'all'

export const RANGE_DAYS: Record<Exclude<WeightRange, 'all'>, number> = {
  '1m': 30, '3m': 91, '6m': 182, '1y': 365,
}

const round1 = (v: number) => Math.round(v * 10) / 10

function sorted(entries: BodyLogEntry[]): BodyLogEntry[] {
  return [...entries].sort((a, b) => a.date.localeCompare(b.date))
}

/** Entries within the last `range` (inclusive of today), oldest first. */
export function inRange(entries: BodyLogEntry[], range: WeightRange, today: string): BodyLogEntry[] {
  const all = sorted(entries)
  if (range === 'all') return all
  const from = addDays(today, -(RANGE_DAYS[range] - 1))
  return all.filter(e => e.date >= from && e.date <= today)
}

/**
 * Trailing average per entry: the mean of every weigh-in in the `windowDays`
 * days ending on that entry's date. Smooths daily water swings into a trend.
 */
export function movingAverage(entries: BodyLogEntry[], windowDays = 7): { date: string; avg: number }[] {
  const all = sorted(entries)
  return all.map(e => {
    const from = addDays(e.date, -(windowDays - 1))
    const win = all.filter(x => x.date >= from && x.date <= e.date)
    return { date: e.date, avg: round1(win.reduce((s, x) => s + x.weightKg, 0) / win.length) }
  })
}

/**
 * Recent rate of change in kg/week: the least-squares slope over the weigh-ins
 * of the last `days` days. null when there are fewer than 3 of them or they span
 * under a week (too little to call a trend).
 */
export function weeklyRate(entries: BodyLogEntry[], today: string, days = 28): number | null {
  const from = addDays(today, -(days - 1))
  const pts = sorted(entries).filter(e => e.date >= from && e.date <= today)
  if (pts.length < 3 || daysBetween(pts[0].date, pts[pts.length - 1].date) < 7) return null
  const xs = pts.map(p => daysBetween(pts[0].date, p.date))
  const mx = xs.reduce((s, x) => s + x, 0) / xs.length
  const my = pts.reduce((s, p) => s + p.weightKg, 0) / pts.length
  let num = 0
  let den = 0
  pts.forEach((p, i) => {
    num += (xs[i] - mx) * (p.weightKg - my)
    den += (xs[i] - mx) ** 2
  })
  return den === 0 ? null : Math.round((num / den) * 7 * 100) / 100
}

export type WeightBadge =
  | { kind: 'start' }
  | { kind: 'low' }
  | { kind: 'high' }
  /** First time the change since the first weigh-in reached this many whole kg (signed). */
  | { kind: 'milestone'; kg: number }

export interface StoryEntry {
  date: string
  weightKg: number
  /** Change since the previous weigh-in; null for the first one. */
  delta: number | null
  /** Change since the first weigh-in. */
  sinceStart: number
  badges: WeightBadge[]
}

export interface StoryMonth {
  /** First day of the month, YYYY-MM-01. */
  month: string
  /** Newest first. */
  entries: StoryEntry[]
  /** Last weigh-in of the month minus the last one before it (or the month's first). */
  change: number
  avg: number
}

/** New lows/highs are only called once there is a history to beat. */
const MIN_HISTORY_FOR_RECORD = 3

/** Every weigh-in grouped by month (newest month first), with changes and badges. */
export function buildWeightStory(entries: BodyLogEntry[]): StoryMonth[] {
  const all = sorted(entries)
  if (all.length === 0) return []
  const start = all[0].weightKg
  let min = Infinity
  let max = -Infinity
  let bestLoss = 0
  let bestGain = 0
  const story: StoryEntry[] = all.map((e, i) => {
    const sinceStart = round1(e.weightKg - start)
    const badges: WeightBadge[] = []
    if (i === 0) {
      badges.push({ kind: 'start' })
    } else {
      // Whole kg away from the start, with a small tolerance for float noise.
      const lost = Math.floor(-sinceStart + 1e-9)
      const gained = Math.floor(sinceStart + 1e-9)
      if (lost >= 1 && lost > bestLoss) {
        bestLoss = lost
        badges.push({ kind: 'milestone', kg: -lost })
      } else if (gained >= 1 && gained > bestGain) {
        bestGain = gained
        badges.push({ kind: 'milestone', kg: gained })
      } else if (i >= MIN_HISTORY_FOR_RECORD && e.weightKg < min) {
        badges.push({ kind: 'low' })
      } else if (i >= MIN_HISTORY_FOR_RECORD && e.weightKg > max) {
        badges.push({ kind: 'high' })
      }
    }
    min = Math.min(min, e.weightKg)
    max = Math.max(max, e.weightKg)
    return {
      date: e.date,
      weightKg: e.weightKg,
      delta: i === 0 ? null : round1(e.weightKg - all[i - 1].weightKg),
      sinceStart,
      badges,
    }
  })

  const months: StoryMonth[] = []
  let prevMonthLast: number | null = null
  for (const e of story) {
    const month = startOfMonth(e.date)
    let m = months[months.length - 1]
    if (!m || m.month !== month) {
      if (m) prevMonthLast = m.entries[m.entries.length - 1].weightKg
      m = { month, entries: [], change: 0, avg: 0 }
      months.push(m)
    }
    m.entries.push(e)
    const base: number = prevMonthLast ?? m.entries[0].weightKg
    m.change = round1(e.weightKg - base)
  }
  for (const m of months) {
    m.avg = round1(m.entries.reduce((s, e) => s + e.weightKg, 0) / m.entries.length)
    m.entries.reverse()
  }
  return months.reverse()
}

/** Timestamp of a local date, for chart x positions. */
export function dateMs(date: string): number {
  return parseLocalDate(date).getTime()
}
