import { describe, it, expect } from 'vitest'
import { inRange, movingAverage, weeklyRate, buildWeightStory } from './bodyweight'
import type { BodyLogEntry } from '../types'

const e = (date: string, weightKg: number): BodyLogEntry => ({ date, weightKg })

describe('inRange', () => {
  const log = [e('2026-10-14', 80), e('2026-07-01', 84), e('2026-09-15', 82), e('2025-01-01', 90)]
  it('sorts and keeps the last N days, today included', () => {
    expect(inRange(log, '1m', '2026-10-14').map(x => x.date)).toEqual(['2026-09-15', '2026-10-14'])
    expect(inRange(log, '6m', '2026-10-14').map(x => x.date)).toEqual(['2026-07-01', '2026-09-15', '2026-10-14'])
    expect(inRange(log, 'all', '2026-10-14')).toHaveLength(4)
  })
})

describe('movingAverage', () => {
  it('averages the weigh-ins of the trailing 7 days per entry', () => {
    const avg = movingAverage([e('2026-10-01', 80), e('2026-10-03', 82), e('2026-10-10', 84)])
    expect(avg).toEqual([
      { date: '2026-10-01', avg: 80 },
      { date: '2026-10-03', avg: 81 },
      { date: '2026-10-10', avg: 84 }, // 10-01 and 10-03 are outside 10-04..10-10
    ])
  })
})

describe('weeklyRate', () => {
  it('is the regression slope in kg/week over the last 4 weeks', () => {
    // -0.1 kg/day, exactly linear.
    const log = [0, 7, 14, 21].map(d => e(`2026-10-${String(1 + d).padStart(2, '0')}`, 85 - d * 0.1))
    expect(weeklyRate(log, '2026-10-22')).toBe(-0.7)
  })
  it('needs 3 weigh-ins over at least a week', () => {
    expect(weeklyRate([e('2026-10-10', 80), e('2026-10-14', 79)], '2026-10-14')).toBeNull()
    expect(weeklyRate([e('2026-10-10', 80), e('2026-10-12', 79), e('2026-10-14', 79)], '2026-10-14')).toBeNull()
  })
  it('ignores weigh-ins older than the window', () => {
    const log = [e('2026-01-01', 100), e('2026-10-01', 80), e('2026-10-08', 80), e('2026-10-14', 80)]
    expect(weeklyRate(log, '2026-10-14')).toBe(0)
  })
})

describe('buildWeightStory', () => {
  const log = [
    e('2026-09-01', 85), e('2026-09-10', 85.5), e('2026-09-20', 84.6), e('2026-09-28', 84.9),
    e('2026-10-02', 84.4), e('2026-10-08', 83.9), e('2026-10-14', 82.8),
  ]
  const story = buildWeightStory(log)

  it('groups by month, newest month and newest entry first', () => {
    expect(story.map(m => m.month)).toEqual(['2026-10-01', '2026-09-01'])
    expect(story[0].entries.map(x => x.date)).toEqual(['2026-10-14', '2026-10-08', '2026-10-02'])
  })

  it('month change runs from the previous month’s last weigh-in', () => {
    expect(story[1].change).toBe(-0.1) // 85 → 84.9 (first month: from its first entry)
    expect(story[0].change).toBe(-2.1) // 84.9 → 82.8
    expect(story[0].avg).toBe(83.7)
  })

  it('marks the start, whole-kg milestones and new lows/highs once', () => {
    const byDate = new Map(story.flatMap(m => m.entries).map(x => [x.date, x]))
    expect(byDate.get('2026-09-01')!.badges).toEqual([{ kind: 'start' }])
    expect(byDate.get('2026-09-01')!.delta).toBeNull()
    expect(byDate.get('2026-09-10')!.badges).toEqual([]) // too little history for a record
    expect(byDate.get('2026-10-02')!.badges).toEqual([{ kind: 'low' }])
    expect(byDate.get('2026-10-08')!.badges).toEqual([{ kind: 'milestone', kg: -1 }])
    expect(byDate.get('2026-10-14')!.badges).toEqual([{ kind: 'milestone', kg: -2 }])
    expect(byDate.get('2026-10-14')!.delta).toBe(-1.1)
    expect(byDate.get('2026-10-14')!.sinceStart).toBe(-2.2)
  })

  it('is empty without weigh-ins', () => {
    expect(buildWeightStory([])).toEqual([])
  })
})
