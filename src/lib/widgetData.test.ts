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
      weekDone: 1, weekTarget: 4, nextWorkout: 'Pull', nextWorkoutUntil: T(2026, 10, 16), nextWorkoutTomorrow: 'Pull',
      nextWorkoutByDay: Array(7).fill('Pull'), weekEndsAt: T(2026, 10, 19), updatedAt: T(2026, 10, 15, 12),
    })
  })

  it("shows the template scheduled for today's weekday, then the rotation once it is done", async () => {
    const push = await db.templates.add({ name: 'Push', position: 0, items: [], updatedAt: 1 })
    await db.templates.add({ name: 'Pull', position: 1, items: [], updatedAt: 1 })
    const legs = await db.templates.add({ name: 'Legs', position: 2, items: [], weekdays: [4], updatedAt: 1 }) // Thursday
    await db.sessions.add({ name: 'Push', templateId: push, startedAt: T(2026, 10, 13, 18), endedAt: T(2026, 10, 13, 19), bodyweightKg: 80, extraExerciseIds: [] })

    // Thu 15 Oct 2026: Legs day, although the rotation says Pull.
    expect((await gatherWidgetState(T(2026, 10, 15, 12))).nextWorkout).toBe('Legs')
    // Wed 14 Oct: no schedule, rotation; after midnight (Thursday) the widget switches to Legs.
    expect(await gatherWidgetState(T(2026, 10, 14, 12))).toMatchObject({
      nextWorkout: 'Pull', nextWorkoutUntil: T(2026, 10, 15), nextWorkoutTomorrow: 'Legs',
      // With the app closed for days: Legs on Thursday (getDay 4), the rotation (Pull) on the others.
      nextWorkoutByDay: ['Pull', 'Pull', 'Pull', 'Pull', 'Legs', 'Pull', 'Pull'],
    })

    await db.sessions.add({ name: 'Legs', templateId: legs, startedAt: T(2026, 10, 15, 8), endedAt: T(2026, 10, 15, 9), bodyweightKg: 80, extraExerciseIds: [] })
    expect((await gatherWidgetState(T(2026, 10, 15, 12))).nextWorkout).toBe('Push')

    // A freestyle workout after Legs the same day does not bring Legs back.
    await db.sessions.add({ name: 'Run', startedAt: T(2026, 10, 15, 10), endedAt: T(2026, 10, 15, 11), bodyweightKg: 80, extraExerciseIds: [] })
    expect((await gatherWidgetState(T(2026, 10, 15, 12))).nextWorkout).toBe('Push')
  })

  it('works on a fresh install', async () => {
    const s = await gatherWidgetState(T(2026, 10, 15, 12))
    expect(s).toMatchObject({ points: 0, tier: 'Copper III', weekDone: 0, weekTarget: 3, nextWorkout: '' })
  })
})
