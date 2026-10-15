import { db, deleteWithTombstone } from '../db/db'
import type { Id, MealType } from '../types'

/**
 * Meal plan: foods put on a future (or today's) menu before they are eaten.
 * Planned rows live in their own table, so totals, quests, achievements and AI
 * briefings — which all read `foodLogs` — never count them. "Eat" moves a row
 * into `foodLogs` on the planned day.
 */

/** Plans a food for a meal; it also surfaces in Recent foods (no use count: not eaten yet). */
export async function planFood(foodId: Id, grams: number, date: string, meal: MealType): Promise<Id> {
  return db.transaction('rw', db.plannedFoods, db.foods, async () => {
    const id = await db.plannedFoods.add({ date, meal, foodId, grams, plannedAt: Date.now() })
    if (await db.foods.get(foodId)) {
      await db.foods.update(foodId, { lastUsedAt: Date.now(), lastGrams: grams })
    }
    return id
  })
}

/** Plans several foods at once (copy a day's meal or a saved meal into the plan). */
export async function copyToPlan(items: { foodId: Id; grams: number }[], date: string, meal: MealType): Promise<void> {
  if (items.length === 0) return
  const now = Date.now()
  await db.plannedFoods.bulkAdd(items.map(it => ({ date, meal, foodId: it.foodId, grams: it.grams, plannedAt: now })))
}

export async function updatePlannedGrams(id: Id, grams: number): Promise<void> {
  await db.plannedFoods.update(id, { grams })
}

/** Removes a planned food everywhere (tombstoned, so the delete syncs). */
export async function deletePlanned(id: Id): Promise<void> {
  await deleteWithTombstone('plannedFoods', id)
}

/**
 * Marks planned foods as eaten: each becomes a FoodLog on its planned day and
 * meal (with its current grams), the plan row is deleted + tombstoned and the
 * food's recents metadata is bumped as `logFood` does. One transaction, so a
 * failure never leaves a food both planned and logged, or neither.
 */
export async function eatPlanned(ids: Id[]): Promise<number> {
  if (ids.length === 0) return 0
  return db.transaction('rw', db.plannedFoods, db.foodLogs, db.foods, db.tombstones, async () => {
    const now = Date.now()
    let eaten = 0
    for (const id of ids) {
      const plan = await db.plannedFoods.get(id)
      if (!plan) continue // already eaten or removed (e.g. on another device)
      await db.foodLogs.add({ date: plan.date, meal: plan.meal, foodId: plan.foodId, grams: plan.grams, loggedAt: now })
      await db.plannedFoods.delete(id)
      await db.tombstones.add({ table: 'plannedFoods', rowId: id, deletedAt: now })
      const food = await db.foods.get(plan.foodId)
      if (food) {
        await db.foods.update(plan.foodId, {
          lastUsedAt: now,
          useCount: (food.useCount ?? 0) + 1,
          lastGrams: plan.grams,
        })
      }
      eaten++
    }
    return eaten
  })
}

/** "Eat all" for one meal of a day. */
export async function eatAllPlanned(date: string, meal: MealType): Promise<number> {
  const ids = await db.plannedFoods.where('[date+meal]').equals([date, meal]).primaryKeys()
  return eatPlanned(ids)
}
