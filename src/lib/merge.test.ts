import { describe, it, expect } from 'vitest'
import { mergeSnapshots, type SnapshotTables, type SyncPayload } from './merge'
import type { Food, RankState, ScoreEvent, Settings } from '../types'

const NOW = 1_800_000_000_000

function emptyTables(): SnapshotTables {
  return {
    exercises: [], templates: [], sessions: [], sets: [], foods: [],
    foodLogs: [], savedMeals: [], settings: [], rankState: [], scoreEvents: [],
    seasons: [], dayTypes: [], bodyLog: [], waterLogs: [], achievements: [],
    quests: [], tombstones: [],
  }
}

function payload(deviceId: string, partial: Partial<SnapshotTables>): SyncPayload {
  return {
    app: 'gymtracker',
    version: 2,
    exportedAt: NOW,
    deviceId,
    tables: { ...emptyTables(), ...partial },
  }
}

const set = (id: string | number, sessionId: string | number, weightKg: number, updatedAt = NOW) => ({
  id, sessionId, exerciseId: 1, setNumber: 1, weightKg, reps: 8,
  isWarmup: false, completedAt: updatedAt, e1rm: weightKg * 1.26, updatedAt,
})

const baseSettings = (updatedAt: number, kcal: number): Settings => ({
  id: 1, bodyweightKg: 80, kcalTarget: kcal, proteinTarget: 160, carbsTarget: 280,
  fatTarget: 80, soundEnabled: true, defaultRestSec: 90, weeklySessionTarget: 3, updatedAt,
})

const baseRank = (over: Partial<RankState>): RankState => ({
  id: 1, seasonId: 1, seasonStart: '2026-07-01', points: 0, streakWeeks: 0,
  lastStreakWeek: '', idleDecayTaken: 0, lastDecayCheckDate: '2026-07-07', ...over,
})

const event = (id: string, date: string, total: number, label?: string): ScoreEvent => ({
  id, date, total, label, basePoints: total, prBonus: 0, streakMult: 1, dayFactor: 1,
  breakdown: [], updatedAt: NOW,
})

describe('mergeSnapshots', () => {
  it('unions append-only tables from both devices (UUID ids)', () => {
    const local = payload('A', { sets: [set('a-1', 's-1', 100)] })
    const remote = payload('B', { sets: [set('b-1', 's-2', 80)] })
    const m = mergeSnapshots(local, remote, NOW)
    expect(m.tables.sets).toHaveLength(2)
  })

  it('keeps a single copy of rows with identical legacy integer ids', () => {
    const local = payload('A', { sets: [set(1, 1, 100)] })
    const remote = payload('B', { sets: [set(1, 1, 100)] })
    const m = mergeSnapshots(local, remote, NOW)
    expect(m.tables.sets).toHaveLength(1)
  })

  it('settings: last write wins by updatedAt', () => {
    const local = payload('A', { settings: [baseSettings(100, 2500)] })
    const remote = payload('B', { settings: [baseSettings(200, 3000)] })
    const m = mergeSnapshots(local, remote, NOW)
    expect(m.tables.settings[0].kcalTarget).toBe(3000)
  })

  it('tombstone removes a row deleted on the other device', () => {
    const local = payload('A', {
      tombstones: [{ id: 't1', table: 'sets', rowId: 'x-1', deletedAt: NOW - 1000 }],
    })
    const remote = payload('B', { sets: [set('x-1', 's-1', 60, NOW - 5000)] })
    const m = mergeSnapshots(local, remote, NOW)
    expect(m.tables.sets).toHaveLength(0)
  })

  it('a row edited after its deletion elsewhere survives (intentional resurrection)', () => {
    const local = payload('A', {
      tombstones: [{ id: 't1', table: 'templates', rowId: 'tpl-1', deletedAt: NOW - 10_000 }],
    })
    const remote = payload('B', {
      templates: [{ id: 'tpl-1', name: 'Push v2', position: 0, items: [], updatedAt: NOW - 500 }],
    })
    const m = mergeSnapshots(local, remote, NOW)
    expect(m.tables.templates).toHaveLength(1)
    expect(m.tables.templates[0].name).toBe('Push v2')
  })

  it('expired tombstones (>90 days) are pruned from the merged payload', () => {
    const local = payload('A', {
      tombstones: [{ id: 'old', table: 'sets', rowId: 'gone', deletedAt: NOW - 91 * 86_400_000 }],
    })
    const m = mergeSnapshots(local, payload('B', {}), NOW)
    expect(m.tables.tombstones).toHaveLength(0)
  })

  it('quests: done never regresses (OR-merge), earliest award kept', () => {
    const local = payload('A', {
      quests: [{ weekKey: '2026-07-06', quests: [{ id: 'sessions', done: true, awardedAt: 500 }], updatedAt: 1 }],
    })
    const remote = payload('B', {
      quests: [{ weekKey: '2026-07-06', quests: [{ id: 'sessions', done: false }], updatedAt: 999 }],
    })
    const m = mergeSnapshots(local, remote, NOW)
    expect(m.tables.quests[0].quests[0].done).toBe(true)
    expect(m.tables.quests[0].quests[0].awardedAt).toBe(500)
  })

  it('achievements union with earliest unlock time', () => {
    const local = payload('A', { achievements: [{ id: 'first-session', unlockedAt: 100 }] })
    const remote = payload('B', {
      achievements: [{ id: 'first-session', unlockedAt: 50 }, { id: 'prs-10', unlockedAt: 300 }],
    })
    const m = mergeSnapshots(local, remote, NOW)
    expect(m.tables.achievements).toHaveLength(2)
    expect(m.tables.achievements.find(a => a.id === 'first-session')?.unlockedAt).toBe(50)
  })

  it('duplicate quest awards collapse to one score event', () => {
    const local = payload('A', { scoreEvents: [event('a-e1', '2026-07-07', 15, 'Quest: Finish 3 sessions')] })
    const remote = payload('B', { scoreEvents: [event('b-e1', '2026-07-07', 15, 'Quest: Finish 3 sessions')] })
    const m = mergeSnapshots(local, remote, NOW)
    expect(m.tables.scoreEvents).toHaveLength(1)
  })

  it('foods deduped by barcode with foodLogs and savedMeals remapped', () => {
    const foodA: Food = {
      id: 'f-a', source: 'off', offId: '3017620422003', name: 'Nutella', nameLower: 'nutella',
      kcal100: 539, protein100: 6.3, carbs100: 57.5, fat100: 30.9,
      userOverridden: false, lastUsedAt: 100, useCount: 1, updatedAt: 100,
    }
    const foodB: Food = { ...foodA, id: 'f-b', userOverridden: true, kcal100: 530, lastUsedAt: 50, updatedAt: 50 }
    const local = payload('A', {
      foods: [foodA],
      foodLogs: [{ id: 'l-1', date: '2026-07-07', meal: 'snack', foodId: 'f-a', grams: 30, loggedAt: 1, updatedAt: 1 }],
    })
    const remote = payload('B', {
      foods: [foodB],
      savedMeals: [{ id: 'm-1', name: 'Snack', items: [{ foodId: 'f-b', grams: 30 }], lastUsedAt: 1, updatedAt: 1 }],
    })
    const m = mergeSnapshots(local, remote, NOW)
    expect(m.tables.foods).toHaveLength(1)
    // user-overridden copy wins even though it is older
    expect(m.tables.foods[0].id).toBe('f-b')
    expect(m.tables.foods[0].kcal100).toBe(530)
    expect(m.tables.foodLogs[0].foodId).toBe('f-b')
    expect(m.tables.savedMeals[0].items[0].foodId).toBe('f-b')
  })

  it('rankState: points recomputed from merged season events (+ carryover)', () => {
    const local = payload('A', {
      rankState: [baseRank({ seasonId: 2, seasonStart: '2026-07-01', points: 120, updatedAt: 10 })],
      scoreEvents: [event('a-1', '2026-07-02', 120)],
      seasons: [{ id: 's1', seasonId: 1, startDate: '2026-04-01', endDate: '2026-06-30', finalPoints: 1000, finalRank: 'Bronze I', updatedAt: 1 }],
    })
    const remote = payload('B', {
      rankState: [baseRank({ seasonId: 2, seasonStart: '2026-07-01', points: 280, updatedAt: 20 })],
      scoreEvents: [event('b-1', '2026-07-03', 80)],
      seasons: [{ id: 's1b', seasonId: 1, startDate: '2026-04-01', endDate: '2026-06-30', finalPoints: 1000, finalRank: 'Bronze I', updatedAt: 2 }],
    })
    const m = mergeSnapshots(local, remote, NOW)
    // carryover 200 + events 120 + 80 = 400
    expect(m.tables.rankState[0].points).toBe(400)
    expect(m.tables.seasons).toHaveLength(1) // same archived season, different row ids
  })

  it('rankState: the device that already rolled the season wins the base', () => {
    const local = payload('A', {
      rankState: [baseRank({ seasonId: 3, seasonStart: '2026-07-05', points: 10, updatedAt: 5 })],
    })
    const remote = payload('B', {
      rankState: [baseRank({ seasonId: 2, seasonStart: '2026-04-05', points: 900, updatedAt: 999 })],
    })
    const m = mergeSnapshots(local, remote, NOW)
    expect(m.tables.rankState[0].seasonId).toBe(3)
  })

  it('bodyLog/dayTypes: same-date conflicts resolve by latest update', () => {
    const local = payload('A', {
      bodyLog: [{ date: '2026-07-07', weightKg: 80, updatedAt: 100 }],
      dayTypes: [{ date: '2026-07-07', type: 'rest', updatedAt: 100 }],
    })
    const remote = payload('B', {
      bodyLog: [{ date: '2026-07-07', weightKg: 79.5, updatedAt: 200 }],
      dayTypes: [{ date: '2026-07-07', type: 'training', updatedAt: 50 }],
    })
    const m = mergeSnapshots(local, remote, NOW)
    expect(m.tables.bodyLog[0].weightKg).toBe(79.5)
    expect(m.tables.dayTypes[0].type).toBe('rest')
  })
})
