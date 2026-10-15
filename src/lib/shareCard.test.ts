import { describe, it, expect } from 'vitest'
import { sessionCardModel, cardStats, cardFileName } from './shareCard'
import { fmtLongDate } from './dates'
import { useUiStore } from './uiStore'
import type { ExerciseBreakdown, ScoreEvent, Session, SetRow } from '../types'

const START = new Date(2026, 9, 15, 18, 0).getTime()
const session: Session = {
  id: 's1', name: 'Push Day', startedAt: START, endedAt: START + 3_725_000, bodyweightKg: 80, extraExerciseIds: [],
}
const b = (exerciseId: number, setPoints: number, e1rmPr = false, volumePr = false): ExerciseBreakdown => ({
  exerciseId, exerciseName: `Ex ${exerciseId}`, setPoints, countedSets: 3, totalSets: 3, e1rmPr, volumePr, bestE1rm: 0,
})
const set = (exerciseId: number, weightKg: number, reps: number, isWarmup = false): SetRow => ({
  sessionId: 's1', exerciseId, setNumber: 1, weightKg, reps, isWarmup, completedAt: START, e1rm: weightKg * (1 + reps / 30),
})
const event = (total: number, breakdown: ExerciseBreakdown[]): ScoreEvent => ({
  sessionId: 's1', date: '2026-10-15', basePoints: total, prBonus: 0, streakMult: 1, dayFactor: 1, total, breakdown,
})

describe('sessionCardModel', () => {
  const sets = [set(1, 40, 10, true), set(1, 100, 5), set(1, 90, 8), set(2, 30, 12), set(3, 20, 10), set(4, 10, 10), set(5, 5, 10)]
  const ev = event(120, [b(1, 50, true), b(2, 20, false, true), b(3, 30), b(4, 10), b(5, 5)])

  it('keeps the top 4 exercises by points with their best working set', () => {
    const m = sessionCardModel(session, ev, sets, 2000, { fresh: true, streakWeeks: 3 })
    expect(m.exercises.map(e => e.name)).toEqual(['Ex 1', 'Ex 3', 'Ex 2', 'Ex 4'])
    expect(m.exercises[0]).toEqual({ name: 'Ex 1', sets: 2, best: { weightKg: 100, reps: 5 }, e1rmPr: true, volumePr: false })
    expect(m.moreExercises).toBe(1)
    expect(m.prCount).toBe(2)
  })

  it('totals working sets and volume without warm-ups', () => {
    const m = sessionCardModel(session, ev, sets, 2000, { fresh: true, streakWeeks: 3 })
    expect(m.sets).toBe(6)
    expect(m.volumeKg).toBe(500 + 720 + 360 + 200 + 100 + 50)
    expect(m.durationMs).toBe(3_725_000)
    expect(m.title).toBe('Push Day')
    expect(m.date).toBe('Thu 15 Oct 2026')
    expect(m.points).toBe(120)
  })

  it('flags a rank-up only on the fresh summary', () => {
    // 1300 = Silver III; 1300 - 120 = 1180 was Bronze I.
    const fresh = sessionCardModel(session, ev, sets, 1300, { fresh: true, streakWeeks: 2 })
    expect(fresh.rankLabel).toBe('Silver III')
    expect(fresh.rankedUp).toBe(true)
    expect(fresh.streakWeeks).toBe(2)
    const report = sessionCardModel(session, ev, sets, 1300, { fresh: false, streakWeeks: 2 })
    expect(report.rankedUp).toBe(false)
    expect(report.streakWeeks).toBe(0) // today's streak says nothing about an old workout
  })

  it('shows the streak stat only when there is one', () => {
    const m = sessionCardModel(session, ev, sets, 2000, { fresh: true, streakWeeks: 3 })
    expect(cardStats(m).map(s => s.label)).toEqual(['sets', 'volume', 'time', 'streak'])
    expect(cardStats(m)[1].value).toBe('1,930 kg')
    expect(cardStats({ ...m, streakWeeks: 0 }).map(s => s.label)).toEqual(['sets', 'volume', 'time'])
  })

  it('draws its stats in Italian when the UI is Italian', () => {
    const m = sessionCardModel(session, ev, sets, 2000, { fresh: true, streakWeeks: 3 })
    useUiStore.setState({ language: 'it' })
    try {
      expect(cardStats({ ...m, volumeKg: 12_345 }).map(s => s.label)).toEqual(['serie', 'volume', 'tempo', 'striscia'])
      expect(cardStats({ ...m, volumeKg: 12_345 })[1].value).toBe('12.345 kg')
      expect(cardStats(m)[3].value).toBe('3 sett.')
    } finally {
      useUiStore.setState({ language: 'en' })
    }
  })
})

describe('cardFileName', () => {
  it('slugs the title', () => {
    const m = sessionCardModel(session, event(1, []), [], 0, { fresh: false, streakWeeks: 0 })
    expect(cardFileName(m, '2026-10-15')).toBe('gymtracker-push-day-2026-10-15.png')
    expect(cardFileName({ ...m, title: '💪' }, '2026-10-15')).toBe('gymtracker-2026-10-15.png')
  })
})

describe('fmtLongDate', () => {
  it('never says Today', () => {
    expect(fmtLongDate('2026-01-01')).toBe('Thu 1 Jan 2026')
  })
})
