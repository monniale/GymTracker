import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../db/db'
import { ensureSeeded } from '../db/seed'
import { gatherWidgetState } from './widgetData'

const T = (y: number, m: number, d: number, h = 0) => new Date(y, m - 1, d, h).getTime()

beforeEach(async () => {
  db.close()
  await Dexie.delete('gymtracker')
  await db.open()
  await ensureSeeded()
})

describe('gatherWidgetState', () => {
  it('reports rank, streak, this week and the next template', async () => {
    await db.rankState.update(1, { points: 2450.4, streakWeeks: 3 })
    await db.settings.update(1, { weeklySessionTarget: 4 })
    const push = await db.templates.add({ name: 'Push', position: 0, items: [], updatedAt: 1 })
    await db.templates.add({ name: 'Pull', position: 1, items: [], updatedAt: 1 })
    await db.sessions.add({ name: 'Push', templateId: push, startedAt: T(2026, 10, 13, 18), endedAt: T(2026, 10, 13, 19), bodyweightKg: 80, extraExerciseIds: [] })
    await db.sessions.add({ name: 'Old', startedAt: T(2026, 10, 9, 18), endedAt: T(2026, 10, 9, 19), bodyweightKg: 80, extraExerciseIds: [] })
    await db.sessions.add({ name: 'Open', startedAt: T(2026, 10, 15, 8), bodyweightKg: 80, extraExerciseIds: [] }) // not finished

    const s = await gatherWidgetState(T(2026, 10, 15, 12))
    expect(s).toEqual({
      points: 2450, tier: 'Gold III', tierColor: '#E8B93B', streakWeeks: 3,
      weekDone: 1, weekTarget: 4, nextWorkout: 'Pull', updatedAt: T(2026, 10, 15, 12),
    })
  })

  it('works on a fresh install', async () => {
    const s = await gatherWidgetState(T(2026, 10, 15, 12))
    expect(s).toMatchObject({ points: 0, tier: 'Copper III', weekDone: 0, weekTarget: 3, nextWorkout: '' })
  })
})
