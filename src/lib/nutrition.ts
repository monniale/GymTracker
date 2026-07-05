import { db } from '../db/db'
import type { Food, FoodLog, MacroSet, MealType, Settings } from '../types'

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

/**
 * Cook once, log per-portion: per-100g macros of a finished recipe from its raw
 * ingredients and the total cooked weight (water loss/gain included).
 */
export function recipePer100(
  items: { food: MacroSet; grams: number }[],
  cookedWeightG: number,
): MacroSet {
  const total = items.reduce(
    (acc, { food, grams }) => ({
      kcal100: acc.kcal100 + (food.kcal100 * grams) / 100,
      protein100: acc.protein100 + (food.protein100 * grams) / 100,
      carbs100: acc.carbs100 + (food.carbs100 * grams) / 100,
      fat100: acc.fat100 + (food.fat100 * grams) / 100,
    }),
    { kcal100: 0, protein100: 0, carbs100: 0, fat100: 0 },
  )
  const f = cookedWeightG > 0 ? 100 / cookedWeightG : 0
  const r1 = (v: number) => Math.round(v * f * 10) / 10
  return {
    kcal100: r1(total.kcal100),
    protein100: r1(total.protein100),
    carbs100: r1(total.carbs100),
    fat100: r1(total.fat100),
  }
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
