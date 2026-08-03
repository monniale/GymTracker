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

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** Weekday headers for a Monday-first month grid (matches `mondayOf`). */
export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

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

/** "July 2026" for the month containing `s`. */
export function monthLabel(s: string): string {
  const d = parseLocalDate(s)
  return `${MONTH_FULL[d.getMonth()]} ${d.getFullYear()}`
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

export function fmtDate(s: string): string {
  const today = localDateStr()
  if (s === today) return 'Today'
  if (s === addDays(today, -1)) return 'Yesterday'
  if (s === addDays(today, 1)) return 'Tomorrow'
  const d = parseLocalDate(s)
  return `${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`
}

export function fmtDateTime(ms: number): string {
  const d = new Date(ms)
  return `${fmtDate(localDateStr(d))}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function fmtDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}
