import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '../db/db'
import { applyTables, collectTables } from '../db/backup'
import { mergeSnapshots, type SnapshotTables, type SyncPayload } from './merge'
import { planFood, copyToPlan, updatePlannedGrams, deletePlanned, eatPlanned, eatAllPlanned } from './mealPlan'
import { totalsForLogs } from './nutrition'
import type { Food } from '../types'

const T = (y: number, m: number, d: number, h = 0) => new Date(y, m - 1, d, h).getTime()

function memoryStorage(): Storage {
  const m = new Map<string, string>()
  return {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: k => m.get(k) ?? null,
    key: i => [...m.keys()][i] ?? null,
    removeItem: k => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  }
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T(2026, 10, 15, 20))
  vi.stubGlobal('localStorage', memoryStorage())
  db.close()
  await Dexie.delete('gymtracker')
  await db.open()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const food = (name: string, extra: Partial<Food> = {}): Food => ({
  source: 'custom', name, nameLower: name.toLowerCase(), kcal100: 100, protein100: 10, carbs100: 10, fat100: 2,
  userOverridden: false, lastUsedAt: 0, useCount: 3, ...extra,
})

describe('meal plan', () => {
  it('plans without logging: totals and use counts are untouched', async () => {
    const oats = await db.foods.add(food('Oats'))
    const id = await planFood(oats, 80, '2026-10-16', 'breakfast')
    expect(typeof id).toBe('string') // UUID like every synced table
    expect(await db.foodLogs.count()).toBe(0)
    const f = await db.foods.get(oats)
    expect(f).toMatchObject({ useCount: 3, lastGrams: 80 })
    expect(f!.lastUsedAt).toBe(T(2026, 10, 15, 20))
  })

  it('eats a planned food: one log on the planned day and meal, plan row tombstoned', async () => {
    const oats = await db.foods.add(food('Oats'))
    const id = await planFood(oats, 80, '2026-10-16', 'breakfast')
    await updatePlannedGrams(id, 90)
    expect(await eatPlanned([id])).toBe(1)
    const logs = await db.foodLogs.toArray()
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({ date: '2026-10-16', meal: 'breakfast', foodId: oats, grams: 90 })
    expect(await db.plannedFoods.count()).toBe(0)
    expect(await db.tombstones.where('deletedAt').above(0).toArray()).toMatchObject([{ table: 'plannedFoods', rowId: id }])
    expect((await db.foods.get(oats))!.useCount).toBe(4)
    // Eating it again (e.g. a double tap) is a no-op.
    expect(await eatPlanned([id])).toBe(0)
    expect(await db.foodLogs.count()).toBe(1)
  })

  it('eats a whole meal and leaves the other meals planned', async () => {
    const oats = await db.foods.add(food('Oats'))
    const milk = await db.foods.add(food('Milk'))
    await copyToPlan([{ foodId: oats, grams: 80 }, { foodId: milk, grams: 200 }], '2026-10-16', 'breakfast')
    await planFood(milk, 100, '2026-10-16', 'snack')
    expect(await eatAllPlanned('2026-10-16', 'breakfast')).toBe(2)
    expect((await db.foodLogs.toArray()).map(l => l.grams).sort()).toEqual([200, 80])
    expect(await db.plannedFoods.toArray()).toMatchObject([{ meal: 'snack', grams: 100 }])
  })

  it('removes a planned food with a tombstone', async () => {
    const oats = await db.foods.add(food('Oats'))
    const id = await planFood(oats, 80, '2026-10-16', 'lunch')
    await deletePlanned(id)
    expect(await db.plannedFoods.count()).toBe(0)
    expect(await db.tombstones.count()).toBe(1)
  })

  it('sums planned rows with the same helper as logs', () => {
    const f = { ...food('Rice'), id: 'f1' }
    const totals = totalsForLogs([{ foodId: 'f1', grams: 150 }], new Map([['f1', f]]))
    expect(totals).toEqual({ kcal: 150, protein: 15, carbs: 15, fat: 3 })
  })
})

describe('meal plan sync', () => {
  const payload = (deviceId: string, tables: SnapshotTables): SyncPayload =>
    ({ app: 'gymtracker', version: 2, exportedAt: Date.now(), deviceId, tables })

  it('keeps local plans when a pulled snapshot predates the table', async () => {
    const oats = await db.foods.add(food('Oats'))
    await planFood(oats, 80, '2026-10-16', 'breakfast')
    const old = (await collectTables()) as Partial<SnapshotTables>
    delete old.plannedFoods
    expect(await applyTables(old as never)).toBe(true)
    expect(await db.plannedFoods.count()).toBe(1)
  })

  it('unions plans from both sides, drops tombstoned ones and remaps deduped foods', () => {
    const base = (): SnapshotTables => ({
      exercises: [], templates: [], sessions: [], sets: [], foods: [], foodLogs: [], savedMeals: [],
      settings: [], rankState: [], scoreEvents: [], seasons: [], dayTypes: [], bodyLog: [], waterLogs: [],
      achievements: [], quests: [], tombstones: [],
    })
    const now = T(2026, 10, 15, 20)
    const local = base()
    local.foods = [{ ...food('Yogurt', { offId: '800', updatedAt: 5, lastUsedAt: 5 }), id: 'fa' }]
    local.plannedFoods = [
      { id: 'p1', date: '2026-10-16', meal: 'breakfast', foodId: 'fa', grams: 150, plannedAt: 1, updatedAt: 1 },
      { id: 'p2', date: '2026-10-16', meal: 'lunch', foodId: 'fa', grams: 100, plannedAt: 1, updatedAt: 1 },
    ]
    const remote = base()
    remote.foods = [{ ...food('Yogurt', { offId: '800', updatedAt: 9, lastUsedAt: 9 }), id: 'fb' }]
    remote.plannedFoods = [{ id: 'p3', date: '2026-10-16', meal: 'snack', foodId: 'fb', grams: 125, plannedAt: 2, updatedAt: 2 }]
    remote.tombstones = [{ id: 't1', table: 'plannedFoods', rowId: 'p2', deletedAt: now - 1000 }]

    const merged = mergeSnapshots(payload('a', local), payload('b', remote), now).tables
    expect(merged.foods.map(f => f.id)).toEqual(['fb']) // newer duplicate wins
    expect(merged.plannedFoods!.map(p => [p.id, p.foodId]).sort()).toEqual([['p1', 'fb'], ['p3', 'fb']])

    const oneSided = mergeSnapshots(payload('a', local), payload('b', { ...remote, plannedFoods: undefined }), now).tables
    expect(oneSided.plannedFoods!.map(p => p.id).sort()).toEqual(['p1'])
  })
})
