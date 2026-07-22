/**
 * Resolve an AI food suggestion into a real, loggable food id and apply it.
 * Grounding order (the user's choice): a food they already track → a close
 * Open Food Facts match → a custom food built from the model's own per-portion
 * numbers. This keeps the macros actually logged close to what the card showed.
 */
import { db } from '../db/db'
import { logFood } from './nutrition'
import { searchOff, upsertOffProduct, type OffProduct } from './off'
import type { Food, Id, MacroSuggestionItem, MealType } from '../types'

/** Look up a food by the ref the model echoed back (String(food.id)). Handles
 * both UUID string ids and legacy integer ids. */
async function getFoodByRef(ref: string): Promise<Food | undefined> {
  const direct = await db.foods.get(ref)
  if (direct) return direct
  if (/^\d+$/.test(ref)) {
    const asNum = await db.foods.get(Number(ref))
    if (asNum) return asNum
  }
  return undefined
}

/**
 * Pick the OFF result whose per-portion macros are closest to the model's
 * estimate — but only if it's a reasonable match. OFF's top text hit is often an
 * unrelated product, and logging it would put real numbers on the plate that are
 * far from what the card promised. When nothing matches well, the caller uses
 * the model's own figures instead (which is exactly what the user saw).
 */
export function pickBestOff(results: OffProduct[], item: MacroSuggestionItem): OffProduct | null {
  const g = item.grams / 100
  let best: OffProduct | null = null
  let bestScore = Infinity
  for (const p of results) {
    // Protein is usually the point of a suggestion — weight its error heavily.
    const score = Math.abs(p.kcal100 * g - item.kcal) + 4 * Math.abs(p.protein100 * g - item.protein)
    if (score < bestScore) {
      bestScore = score
      best = p
    }
  }
  if (!best) return null
  const kcalOk = Math.abs(best.kcal100 * g - item.kcal) <= Math.max(60, item.kcal * 0.3)
  const proteinOk = Math.abs(best.protein100 * g - item.protein) <= Math.max(8, item.protein * 0.35)
  return kcalOk && proteinOk ? best : null
}

/** Create a custom Food from a suggestion's per-portion macros (per-100g = v/g*100). */
async function createCustomFromItem(item: MacroSuggestionItem): Promise<Id | null> {
  const g = item.grams
  if (!(g > 0)) return null
  const per100 = (v: number) => Math.round((v / g) * 100 * 10) / 10
  return db.foods.add({
    source: 'custom',
    name: item.food,
    nameLower: item.food.toLowerCase(),
    brand: item.brand,
    kcal100: per100(item.kcal),
    protein100: per100(item.protein),
    carbs100: per100(item.carbs),
    fat100: per100(item.fat),
    userOverridden: false,
    lastUsedAt: Date.now(),
    useCount: 0,
  })
}

/**
 * Turn an AI food suggestion into a real, loggable food id. Returns null only if
 * every path fails (e.g. a custom food with non-positive grams).
 */
export async function resolveSuggestedFood(item: MacroSuggestionItem): Promise<Id | null> {
  // 1) A food the user already tracks — ground-truth macros, no network.
  if (item.ref) {
    const known = await getFoodByRef(item.ref)
    if (known?.id !== undefined) return known.id
  }
  // 2) Open Food Facts (needs online) — real macros, but only if a result is a
  //    close match to what the model (and therefore the card) promised.
  try {
    const query = [item.brand, item.food].filter(Boolean).join(' ').trim()
    if (query) {
      const match = pickBestOff(await searchOff(query), item)
      if (match) return await upsertOffProduct(match)
    }
  } catch {
    // offline or OFF error — fall through to a custom food.
  }
  // 3) Custom food from the model's own per-portion estimate (matches the card).
  return createCustomFromItem(item)
}

/** Resolve + log a suggested food (F1 "complete my macros"). */
export async function applyMacroSuggestion(item: MacroSuggestionItem, date: string): Promise<Id | null> {
  const foodId = await resolveSuggestedFood(item)
  if (foodId == null) return null
  await logFood(foodId, item.grams, date, item.meal)
  return foodId
}

/**
 * Replace a logged food with a suggested swap, preserving the entry's meal (F1).
 * The delete + tombstone + new log all run in ONE transaction so a failure can
 * never leave the day with the original entry gone and nothing in its place.
 */
export async function applySwap(
  logId: Id,
  date: string,
  meal: MealType,
  item: MacroSuggestionItem,
): Promise<Id | null> {
  const foodId = await resolveSuggestedFood(item)
  if (foodId == null) return null
  const now = Date.now()
  await db.transaction('rw', db.foodLogs, db.foods, db.tombstones, async () => {
    await db.foodLogs.delete(logId)
    await db.tombstones.add({ table: 'foodLogs', rowId: logId, deletedAt: now })
    await db.foodLogs.add({ date, meal, foodId, grams: item.grams, loggedAt: now })
    const food = await db.foods.get(foodId)
    if (food) {
      await db.foods.update(foodId, {
        lastUsedAt: now,
        useCount: (food.useCount ?? 0) + 1,
        lastGrams: item.grams,
      })
    }
  })
  return foodId
}
