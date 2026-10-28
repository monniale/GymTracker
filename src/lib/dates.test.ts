import { describe, it, expect, afterEach } from 'vitest'
import {
  startOfMonth, addMonths, monthLabel, sameMonth, monthGrid, WEEKDAY_LABELS,
  addDays, fmtDate, fmtDateTime, fmtLongDate, localDateStr, weekdayOf,
} from './dates'
import { useUiStore } from './uiStore'

describe('weekdayOf', () => {
  it('maps a local date to JS getDay (Sunday 0)', () => {
    expect(weekdayOf('2026-10-25')).toBe(0) // Sunday
    expect(weekdayOf('2026-10-26')).toBe(1) // Monday
    expect(weekdayOf('2026-10-31')).toBe(6) // Saturday
  })

  it('gives the right weekday on Rome DST change days (29 Mar and 25 Oct 2026)', () => {
    expect(weekdayOf('2026-03-29')).toBe(0)
    expect(weekdayOf('2026-03-30')).toBe(1)
    expect(weekdayOf('2026-10-24')).toBe(6)
  })

  it('reads the date in local time west of UTC too (UTC parsing would give the day before)', () => {
    // npm test pins Europe/Rome, where parsing the string as UTC midnight still lands on the same
    // day; New York catches `new Date(date).getDay()`.
    const saved = process.env.TZ
    process.env.TZ = 'America/New_York'
    try {
      expect(new Date('2026-10-25').getDay()).toBe(6) // the zone switch took effect
      expect(weekdayOf('2026-10-25')).toBe(0)
      expect(weekdayOf('2026-03-08')).toBe(0) // US DST start
      expect(weekdayOf('2026-11-01')).toBe(0) // US DST end
      expect(weekdayOf('2026-10-26')).toBe(1)
    } finally {
      if (saved === undefined) delete process.env.TZ
      else process.env.TZ = saved
    }
  })
})

describe('month calendar helpers', () => {
  it('startOfMonth returns the first day of the month', () => {
    expect(startOfMonth('2026-07-22')).toBe('2026-07-01')
    expect(startOfMonth('2026-07-01')).toBe('2026-07-01')
  })

  it('addMonths moves to the first of the target month and wraps years', () => {
    expect(addMonths('2026-07-22', 1)).toBe('2026-08-01')
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-01')
    expect(addMonths('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('monthLabel is human readable', () => {
    expect(monthLabel('2026-07-22')).toBe('July 2026')
    expect(monthLabel('2026-12-01')).toBe('December 2026')
  })

  it('sameMonth compares year+month only', () => {
    expect(sameMonth('2026-07-01', '2026-07-31')).toBe(true)
    expect(sameMonth('2026-07-31', '2026-08-01')).toBe(false)
    expect(sameMonth('2025-07-01', '2026-07-01')).toBe(false)
  })

  it('monthGrid is 42 days, Monday-first, covering the month', () => {
    const grid = monthGrid('2026-07-15') // July 2026: 1st is a Wednesday
    expect(grid).toHaveLength(42)
    expect(WEEKDAY_LABELS[0]).toBe('Mon')
    // Grid starts on a Monday.
    const first = new Date(grid[0] + 'T00:00:00')
    expect(first.getDay()).toBe(1) // Monday
    // The month's 1st and last day are inside the grid.
    expect(grid).toContain('2026-07-01')
    expect(grid).toContain('2026-07-31')
    // Leading days belong to the previous month (June), Monday-aligned.
    expect(grid[0]).toBe('2026-06-29')
  })

  it('monthGrid leading/trailing fill spans adjacent months', () => {
    const grid = monthGrid('2026-02-10') // Feb 2026 (28 days), 1st is a Sunday
    expect(grid).toHaveLength(42)
    expect(grid).toContain('2026-02-01')
    expect(grid).toContain('2026-02-28')
    expect(grid[0]).toBe('2026-01-26') // Monday before Feb 1 (Sun)
  })
})

describe('date labels follow the UI language', () => {
  afterEach(() => useUiStore.setState({ language: 'en' }))

  it('English: "Today", "Mon 13 Oct", "Thu 15 Oct 2026"', () => {
    expect(fmtDate(localDateStr())).toBe('Today')
    expect(fmtDate(addDays(localDateStr(), -1))).toBe('Yesterday')
    expect(fmtDate('2025-10-13')).toBe('Mon 13 Oct')
    expect(fmtLongDate('2026-10-15')).toBe('Thu 15 Oct 2026')
    expect(fmtDateTime(new Date(2025, 9, 13, 14, 5).getTime())).toBe('Mon 13 Oct, 14:05')
  })

  it('Italian: day first, lowercase names in running text, capitalized month heading', () => {
    useUiStore.setState({ language: 'it' })
    expect(fmtDate(localDateStr())).toBe('Oggi')
    expect(fmtDate(addDays(localDateStr(), 1))).toBe('Domani')
    expect(fmtDate('2025-10-13')).toBe('lun 13 ott')
    expect(fmtLongDate('2026-10-15')).toBe('gio 15 ott 2026')
    expect(fmtDateTime(new Date(2025, 9, 13, 14, 5).getTime())).toBe('lun 13 ott, 14:05')
    expect(monthLabel('2026-10-01')).toBe('Ottobre 2026')
    expect(monthLabel('2026-01-31')).toBe('Gennaio 2026')
  })
})
