import { describe, it, expect } from 'vitest'
import { startOfMonth, addMonths, monthLabel, sameMonth, monthGrid, WEEKDAY_LABELS } from './dates'

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
