import { describe, it, expect } from 'vitest'
import { questsForWeek } from './quests'
import { standardFor, levelFor, LEVELS } from './standards'
import { ACHIEVEMENTS, type AchievementStats } from './achievements'

describe('questsForWeek', () => {
  it('is deterministic for the same week', () => {
    const a = questsForWeek('2026-07-06').map(q => q.id)
    const b = questsForWeek('2026-07-06').map(q => q.id)
    expect(a).toEqual(b)
  })
  it('always returns two distinct quests', () => {
    for (let i = 0; i < 20; i++) {
      const week = `2026-0${(i % 9) + 1}-0${(i % 7) + 1}`
      const ids = questsForWeek(week).map(q => q.id)
      expect(ids).toHaveLength(2)
      expect(ids[0]).not.toBe(ids[1])
    }
  })
  it('varies across weeks', () => {
    const picks = new Set<string>()
    for (const w of ['2026-06-01', '2026-06-08', '2026-06-15', '2026-06-22', '2026-06-29', '2026-07-06']) {
      picks.add(questsForWeek(w).map(q => q.id).join('+'))
    }
    expect(picks.size).toBeGreaterThan(1)
  })
})

describe('strength standards', () => {
  it('classifies a bodyweight bench as Intermediate', () => {
    const std = standardFor('bench press')!
    const info = levelFor(80, 80, std) // ratio 1.0
    expect(info.level).toBe('Intermediate')
    expect(info.next).toBe('Advanced')
    expect(info.progress).toBeGreaterThanOrEqual(0)
  })
  it('caps at Elite with full progress', () => {
    const std = standardFor('deadlift')!
    const info = levelFor(250, 80, std) // ratio 3.1
    expect(info.level).toBe('Elite')
    expect(info.progress).toBe(1)
    expect(info.next).toBeNull()
  })
  it('returns null for unknown lifts', () => {
    expect(standardFor('cable crunch')).toBeNull()
  })
  it('has monotonically increasing level indexes', () => {
    const std = standardFor('squat')!
    const levels = [0.5, 1.0, 1.3, 1.8, 2.3].map(r => levelFor(r * 80, 80, std).index)
    for (let i = 1; i < levels.length; i++) expect(levels[i]).toBeGreaterThanOrEqual(levels[i - 1])
    expect(LEVELS[levels[0]]).toBe('Untrained')
  })
})

describe('achievements', () => {
  const base: AchievementStats = {
    totalSessions: 0,
    totalVolumeKg: 0,
    streakWeeks: 0,
    totalPrs: 0,
    maxSessionPoints: 0,
    foodLogDays: 0,
    liftRatios: new Map(),
  }
  it('first-session unlocks at exactly one session', () => {
    const def = ACHIEVEMENTS.find(a => a.id === 'first-session')!
    expect(def.check(base)).toBe(false)
    expect(def.check({ ...base, totalSessions: 1 })).toBe(true)
  })
  it('bodyweight bench requires ratio >= 1', () => {
    const def = ACHIEVEMENTS.find(a => a.id === 'bench-bw')!
    expect(def.check({ ...base, liftRatios: new Map([['bench', 0.99]]) })).toBe(false)
    expect(def.check({ ...base, liftRatios: new Map([['bench', 1.0]]) })).toBe(true)
  })
  it('all achievement ids are unique', () => {
    const ids = ACHIEVEMENTS.map(a => a.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
