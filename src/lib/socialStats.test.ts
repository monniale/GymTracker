import { describe, it, expect } from 'vitest'
import { buildPublicStats, commonLifts, currentView } from './socialStats'
import { normalizeFriendCode, inviteLink } from './social'
import type { Exercise, Session, SetRow } from '../types'

const T = (y: number, m: number, d: number, h = 10) => new Date(y, m - 1, d, h).getTime()

const ex = (id: string, name: string, equipment: Exercise['equipment'] = 'barbell') =>
  ({ id, name, nameLower: name.toLowerCase(), equipment, muscleGroup: 'chest', isCustom: false }) as Exercise
const session = (id: string, startedAt: number, ended = true) =>
  ({ id, name: 'W', startedAt, endedAt: ended ? startedAt + 3600_000 : undefined, templateId: null, bodyweightKg: 80 }) as unknown as Session
const set = (sessionId: string, exerciseId: string, weightKg: number, reps: number, e1rm: number, isWarmup = false) =>
  ({ sessionId, exerciseId, weightKg, reps, e1rm, isWarmup, setIndex: 0, completedAt: 0 }) as unknown as SetRow

describe('buildPublicStats', () => {
  const exercises = [ex('b', 'Bench Press'), ex('s', 'Squat')]
  const sessions = [
    session('old', T(2026, 8, 1)), // before the season
    session('season', T(2026, 10, 14)), // this season, an earlier week
    session('week', T(2026, 10, 27)), // this week (Monday 2026-10-26)
    session('open', T(2026, 10, 28), false), // not finished: ignored
  ]
  const sets = [
    set('old', 'b', 100, 5, 116.7),
    set('season', 's', 120, 5, 140),
    set('week', 'b', 80, 10, 106.7),
    set('week', 'b', 40, 10, 53.3, true), // warm-up: no volume
    set('open', 's', 200, 1, 200),
  ]
  const stats = buildPublicStats({
    rank: { seasonId: 4, seasonStart: '2026-10-01', points: 512.4, streakWeeks: 2 },
    sessions, sets, exercises, today: '2026-10-28',
  })

  it('counts finished workouts and volume per week and season, best e1RM over all time', () => {
    expect(stats).toEqual({
      seasonId: 4, points: 512, streakWeeks: 2, weekStart: '2026-10-26',
      sessionsWeek: 1, sessionsSeason: 2, volumeWeekKg: 800, volumeSeasonKg: 1400,
      bestLifts: [
        { key: 'squat', name: 'Squat', e1rm: 140 },
        { key: 'bench press', name: 'Bench Press', e1rm: 116.7 },
      ],
    })
  })

  it('reads an old week as 0 and an old season as unknown', () => {
    expect(currentView(stats, 4, '2026-10-28')).toMatchObject({ points: 512, sessionsWeek: 1, sessionsSeason: 2 })
    expect(currentView(stats, 4, '2026-11-03')).toMatchObject({ points: 512, sessionsWeek: 0, volumeWeekKg: 0 })
    expect(currentView(stats, 5, '2026-10-28')).toMatchObject({ points: null, sessionsSeason: null, volumeSeasonKg: null })
  })

  it('compares only the lifts both have', () => {
    expect(commonLifts(stats.bestLifts, [{ key: 'bench press', name: 'Bench Press', e1rm: 120 }, { key: 'deadlift', name: 'Deadlift', e1rm: 200 }]))
      .toEqual([{ key: 'bench press', name: 'Bench Press', mine: 116.7, theirs: 120 }])
  })
})

describe('friend codes', () => {
  it('reads a code typed or pasted with its invite link', () => {
    expect(normalizeFriendCode(' ab12cd34 ')).toBe('AB12CD34')
    expect(normalizeFriendCode(inviteLink('AB12CD34'))).toBe('AB12CD34')
    expect(normalizeFriendCode('123456789')).toBeNull()
    expect(normalizeFriendCode('XYZ')).toBeNull()
  })
})
