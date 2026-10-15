import { describe, it, expect } from 'vitest'
import { trainingHeatmap, heatLevel } from './heatmap'
import { parseLocalDate, addDays } from './dates'

/** A finished session started at `hour` local time on `date`. */
const at = (date: string, hour = 18, finished = true) => {
  const d = parseLocalDate(date)
  d.setHours(Math.floor(hour), Math.round((hour % 1) * 60))
  return { startedAt: d.getTime(), endedAt: finished ? d.getTime() + 3_600_000 : undefined }
}

const TODAY = '2026-10-15' // a Thursday

describe('trainingHeatmap', () => {
  it('lays out 26 Monday-first weeks ending with the current one', () => {
    const h = trainingHeatmap([], TODAY)
    expect(h.columns).toHaveLength(26)
    expect(h.columns[0].monday).toBe('2026-04-20')
    expect(h.columns[25].monday).toBe('2026-10-12')
    expect(h.columns.every(c => c.days.length === 7)).toBe(true)
    expect(h.columns[25].days.map(d => d.future)).toEqual([false, false, false, false, true, true, true])
  })

  it('counts finished sessions per local start day', () => {
    const h = trainingHeatmap(
      [at('2026-10-13', 7), at('2026-10-13', 19), at('2026-10-14', 23.5), at('2026-10-14', 10, false)],
      TODAY,
    )
    const week = h.columns[25].days
    expect(week[1]).toEqual({ date: '2026-10-13', count: 2, future: false })
    expect(week[2].count).toBe(1) // the unfinished one is ignored
    expect(week[0].count).toBe(0)
  })

  it('never shows a count on a future day', () => {
    const h = trainingHeatmap([at('2026-10-17')], TODAY)
    expect(h.columns[25].days[5]).toEqual({ date: '2026-10-17', count: 0, future: true })
  })

  it('labels the first column of each month, dropping a partial first month', () => {
    const h = trainingHeatmap([], TODAY)
    expect(h.monthTicks).toEqual([
      { col: 2, label: 'May' },
      { col: 6, label: 'Jun' },
      { col: 11, label: 'Jul' },
      { col: 15, label: 'Aug' },
      { col: 20, label: 'Sep' },
      { col: 24, label: 'Oct' },
    ])
  })

  it('counts distinct training days in the current year only', () => {
    const h = trainingHeatmap(
      [at('2025-12-31'), at('2026-01-02'), at('2026-01-02', 8), at('2026-10-15', 7)],
      TODAY,
    )
    expect(h.daysThisYear).toBe(2)
  })

  it('finds the longest and the current run of trained weeks', () => {
    const sessions = [
      at('2026-06-01'), at('2026-06-10'), at('2026-06-21'), // 3 weeks in a row (Sun 21 is still Jun 15's week)
      at('2026-07-06'),
      at('2026-09-30'), at('2026-10-05'),
    ]
    const h = trainingHeatmap(sessions, TODAY)
    expect(h.longestRunWeeks).toBe(3)
    // No workout this week yet: the run through last week still counts.
    expect(h.currentRunWeeks).toBe(2)
    expect(trainingHeatmap([...sessions, at('2026-10-13')], TODAY).currentRunWeeks).toBe(3)
  })

  it('drops the current run once a whole week is missed', () => {
    expect(trainingHeatmap([at('2026-09-30')], TODAY).currentRunWeeks).toBe(0)
    expect(trainingHeatmap([], TODAY).longestRunWeeks).toBe(0)
  })

  it('starts at the week of `from` and steps whole weeks across DST', () => {
    // Europe/Rome springs forward on 2026-03-29.
    const h = trainingHeatmap([at('2026-03-29', 0.5)], TODAY, { from: '2026-03-26' })
    expect(h.columns[0].monday).toBe('2026-03-23')
    expect(h.columns).toHaveLength(30)
    h.columns.forEach((c, i) => {
      expect(parseLocalDate(c.monday).getDay()).toBe(1)
      if (i > 0) expect(addDays(h.columns[i - 1].monday, 7)).toBe(c.monday)
    })
    expect(h.columns[0].days[6]).toEqual({ date: '2026-03-29', count: 1, future: false })
  })

  it('clamps a future `from` to the current week', () => {
    expect(trainingHeatmap([], TODAY, { from: '2026-12-01' }).columns.map(c => c.monday)).toEqual(['2026-10-12'])
  })
})

describe('heatLevel', () => {
  it('maps counts to four steps', () => {
    expect([0, 1, 2, 3, 7].map(heatLevel)).toEqual([0, 1, 2, 3, 3])
  })
})
