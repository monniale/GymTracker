import { bindT, t, type Translator } from '../i18n'
import { getLang } from './uiStore'

export function localDateStr(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(s: string, n: number): string {
  const d = parseLocalDate(s)
  d.setDate(d.getDate() + n)
  return localDateStr(d)
}

/** Whole days from a to b (positive when b is later). */
export function daysBetween(a: string, b: string): number {
  return Math.round((parseLocalDate(b).getTime() - parseLocalDate(a).getTime()) / 86400000)
}

/** Monday of the week containing the given date (weeks start Monday). */
export function mondayOf(s: string): string {
  const d = parseLocalDate(s)
  const wd = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - wd)
  return localDateStr(d)
}

/* Day and month names come from the `lib.dates` dictionary of the UI language. The exported arrays
 * are built once at load (changing the language reloads the app); the functions below read the
 * language when called. Dates stay day-first in every language ("Thu 15 Oct" / "gio 15 ott"). */
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const
const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] as const

const dayShort = (tr: Translator, d: Date) => tr.t(`lib.dates.dayShort.${DAY_KEYS[d.getDay()]}`)
const monthShort = (tr: Translator, d: Date) => tr.t(`lib.dates.monthShort.${MONTH_KEYS[d.getMonth()]}`)

/** Short month names, January first ("Jan" / "gen"), in the UI language. */
export const MONTH_NAMES: string[] = MONTH_KEYS.map(k => t(`lib.dates.monthShort.${k}`))

/** Weekday headers for a Monday-first month grid (matches `mondayOf`), in the UI language. */
export const WEEKDAY_LABELS: string[] = WEEKDAY_KEYS.map(k => t(`lib.dates.weekdayHeader.${k}`))

/** First day of the month containing `s` (YYYY-MM-01). */
export function startOfMonth(s: string): string {
  const d = parseLocalDate(s)
  return localDateStr(new Date(d.getFullYear(), d.getMonth(), 1))
}

/** First day of the month `n` months from the month containing `s`. */
export function addMonths(s: string, n: number): string {
  const d = parseLocalDate(s)
  return localDateStr(new Date(d.getFullYear(), d.getMonth() + n, 1))
}

/** "July 2026" / "Luglio 2026" for the month containing `s` (a heading: first letter capitalized). */
export function monthLabel(s: string): string {
  const d = parseLocalDate(s)
  const month = t(`lib.dates.monthFull.${MONTH_KEYS[d.getMonth()]}`)
  const label = t('lib.dates.monthYear', { month, year: d.getFullYear() })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

/** True when `a` and `b` fall in the same calendar month. */
export function sameMonth(a: string, b: string): boolean {
  return a.slice(0, 7) === b.slice(0, 7)
}

/** 42 date strings (6 weeks, Monday-first) covering the month containing `s`,
 * including the trailing/leading days of adjacent months to fill the grid. */
export function monthGrid(s: string): string[] {
  const gridStart = mondayOf(startOfMonth(s))
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))
}

/** "Today" / "Yesterday" / "Tomorrow", else "Thu 15 Oct" ("gio 15 ott"). */
export function fmtDate(s: string): string {
  const tr = bindT(getLang())
  const today = localDateStr()
  if (s === today) return tr.t('common.today')
  if (s === addDays(today, -1)) return tr.t('common.yesterday')
  if (s === addDays(today, 1)) return tr.t('common.tomorrow')
  const d = parseLocalDate(s)
  return tr.t('lib.dates.dayMonth', { weekday: dayShort(tr, d), day: d.getDate(), month: monthShort(tr, d) })
}

/** "Thu 15 Oct 2026" ("gio 15 ott 2026"): an absolute date (never "Today"), for shared images. */
export function fmtLongDate(s: string): string {
  const tr = bindT(getLang())
  const d = parseLocalDate(s)
  return tr.t('lib.dates.dayMonthYear', {
    weekday: dayShort(tr, d), day: d.getDate(), month: monthShort(tr, d), year: d.getFullYear(),
  })
}

/** "Today, 14:05" / "Thu 15 Oct, 14:05" (24-hour clock in every language). */
export function fmtDateTime(ms: number): string {
  const d = new Date(ms)
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return t('lib.dates.dateTime', { date: fmtDate(localDateStr(d)), time })
}

export function fmtDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}
