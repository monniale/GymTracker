import { db } from '../db/db'
import { blobToBase64 } from './shareCard'
import { addTotals, macrosFor, type MacroTotals } from './nutrition'
import type { InlineImage } from './gemini'
import type { Id, MealEstimateItem } from '../types'

/**
 * A photo for the meal estimate: scaled so its long side is at most `maxPx` and re-encoded as JPEG,
 * which keeps the request small (and the free quota happy). Never stored.
 */
export async function downscaleImage(file: Blob, maxPx = 1024): Promise<InlineImage> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', 0.8))
  return { mimeType: 'image/jpeg', data: await blobToBase64(blob) }
}

/** The meal's total macros at the (edited) grams. */
export function estimateTotals(items: MealEstimateItem[]): MacroTotals {
  return items.reduce((total, item) => addTotals(total, macrosFor(item, item.grams)), { kcal: 0, protein: 0, carbs: 0, fat: 0 })
}

/**
 * Log (or plan) the estimated items: each becomes a custom food (so a repeat order is one tap in
 * Recent) and goes through `add`, the Add food sheet's write path for the target day and meal.
 */
export async function saveEstimatedItems(
  items: MealEstimateItem[],
  add: (foodId: Id, grams: number) => Promise<void>,
): Promise<void> {
  for (const item of items) {
    if (item.grams <= 0) continue
    const name = item.name.trim()
    const foodId = await db.foods.add({
      source: 'custom',
      name,
      nameLower: name.toLowerCase(),
      kcal100: item.kcal100,
      protein100: item.protein100,
      carbs100: item.carbs100,
      fat100: item.fat100,
      servingG: item.grams,
      userOverridden: false,
      lastUsedAt: Date.now(),
      useCount: 0,
    })
    await add(foodId, item.grams)
  }
}
