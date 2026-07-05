import { db } from '../db/db'
import type { Food, FoodLog, MealType, Settings } from '../types'

export interface MacroTotals {
  kcal: number
  protein: number
  carbs: number
  fat: number
}

export const EMPTY_TOTALS: MacroTotals = { kcal: 0, protein: 0, carbs: 0, fat: 0 }

export interface DayTargets {
  kcal: number
  protein: number
  carbs: number
  fat: number
}

/** Targets for a day; rest-day values fall back to training values (pre-v2 data). */
export function dayTargets(s: Settings, training: boolean): DayTargets {
  if (training) {
    return { kcal: s.kcalTarget, protein: s.proteinTarget, carbs: s.carbsTarget, fat: s.fatTarget }
  }
  return {
    kcal: s.restKcalTarget ?? s.kcalTarget,
    protein: s.restProteinTarget ?? s.proteinTarget,
    carbs: s.restCarbsTarget ?? s.carbsTarget,
    fat: s.restFatTarget ?? s.fatTarget,
  }
}

export function macrosFor(food: Food, grams: number): MacroTotals {
  const f = grams / 100
  return {
    kcal: food.kcal100 * f,
    protein: food.protein100 * f,
    carbs: food.carbs100 * f,
    fat: food.fat100 * f,
  }
}

export function addTotals(a: MacroTotals, b: MacroTotals): MacroTotals {
  return {
    kcal: a.kcal + b.kcal,
    protein: a.protein + b.protein,
    carbs: a.carbs + b.carbs,
    fat: a.fat + b.fat,
  }
}

export function totalsForLogs(logs: FoodLog[], foodsById: Map<number, Food>): MacroTotals {
  let acc = EMPTY_TOTALS
  for (const log of logs) {
    const food = foodsById.get(log.foodId)
    if (food) acc = addTotals(acc, macrosFor(food, log.grams))
  }
  return acc
}

/** Logs a food and updates its recents metadata in one transaction. */
export async function logFood(
  foodId: number, grams: number, date: string, meal: MealType,
): Promise<void> {
  await db.transaction('rw', db.foodLogs, db.foods, async () => {
    await db.foodLogs.add({ date, meal, foodId, grams, loggedAt: Date.now() })
    const food = await db.foods.get(foodId)
    if (food) {
      await db.foods.update(foodId, {
        lastUsedAt: Date.now(),
        useCount: (food.useCount ?? 0) + 1,
        lastGrams: grams,
      })
    }
  })
}
