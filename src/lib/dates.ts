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
