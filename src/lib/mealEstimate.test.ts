import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { db } from '../db/db'
import { logFood } from './nutrition'
import { planFood } from './mealPlan'
import { estimateTotals, saveEstimatedItems } from './mealEstimate'
import { generateMealEstimate, parseMealEstimate, MEAL_ESTIMATE_SYSTEM_PROMPT } from './gemini'
import type { MealEstimateItem } from '../types'

afterEach(() => vi.unstubAllGlobals())

const item = (over: Partial<MealEstimateItem> = {}): MealEstimateItem =>
  ({ name: 'Döner wrap', grams: 350, kcal100: 215, protein100: 11, carbs100: 20, fat100: 10, ...over })

describe('parseMealEstimate', () => {
  it('rounds, clamps and keeps the notes', () => {
    const e = parseMealEstimate(JSON.stringify({
      headline: 'Big wrap, fries in oil',
      confidence: 'medium',
      items: [
        { name: ' Fries ', grams: 152.4, kcal100: 312, protein100: 3.44, carbs100: 41.06, fat100: 15.01, note: 'medium portion' },
        { name: 'Cola', grams: 9999, kcal100: 42, protein100: 0, carbs100: 10.6, fat100: -1 },
      ],
    }))
    expect(e.confidence).toBe('medium')
    expect(e.items[0]).toEqual({ name: 'Fries', grams: 152, kcal100: 312, protein100: 3.4, carbs100: 41.1, fat100: 15, note: 'medium portion' })
    expect(e.items[1]).toMatchObject({ grams: 2000, fat100: 0, kcal100: 42 })
  })

  it('drops items without a name or grams and coerces a bad confidence', () => {
    const e = parseMealEstimate(JSON.stringify({
      headline: 'x', confidence: 'certain',
      items: [{ name: '', grams: 100, kcal100: 100 }, { name: 'Sauce', grams: 0, kcal100: 400 }, { name: 'Bun', grams: 80, kcal100: 270, protein100: 9, carbs100: 49, fat100: 4 }],
    }))
    expect(e.confidence).toBe('low')
    expect(e.items.map(i => i.name)).toEqual(['Bun'])
  })

  it('recomputes kcal from the macros when they disagree by more than a quarter', () => {
    const [i] = parseMealEstimate(JSON.stringify({ headline: '', confidence: 'low', items: [{ name: 'Patty', grams: 150, kcal100: 120, protein100: 17, carbs100: 0, fat100: 20 }] })).items
    expect(i.kcal100).toBe(248)
  })

  it('salvages the headline from truncated JSON', () => {
    const e = parseMealEstimate('{"headline":"Two slices of pizza","confidence":"low","items":[{"name":"Pi')
    expect(e).toEqual({ headline: 'Two slices of pizza', confidence: 'low', items: [] })
  })
})

describe('generateMealEstimate', () => {
  const stub = () => {
    const fn = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ headline: 'h', confidence: 'high', items: [item()] }) }] } }] }),
    }))
    vi.stubGlobal('fetch', fn)
    return fn
  }
  const body = (fn: ReturnType<typeof stub>) => JSON.parse((fn.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)

  it('sends the description, the system prompt and the photo as an inline image', async () => {
    const fn = stub()
    const e = await generateMealEstimate('kebab and fries', { mimeType: 'image/jpeg', data: 'AAAA' }, { apiKey: 'k', model: 'gemini-2.5-flash' })
    const b = body(fn)
    expect(b.contents[0].parts).toEqual([{ text: 'Meal: kebab and fries' }, { inlineData: { mimeType: 'image/jpeg', data: 'AAAA' } }])
    expect(b.systemInstruction.parts[0].text).toContain(MEAL_ESTIMATE_SYSTEM_PROMPT)
    expect(b.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 })
    expect(b.generationConfig.temperature).toBe(0.3)
    expect(e.items).toHaveLength(1)
  })

  it('sends only text without a photo', async () => {
    const fn = stub()
    await generateMealEstimate('pizza margherita', null, { apiKey: 'k', model: 'm' })
    expect(body(fn).contents[0].parts).toEqual([{ text: 'Meal: pizza margherita' }])
  })
})

describe('saving an estimate', () => {
  beforeEach(async () => {
    db.close()
    await Dexie.delete('gymtracker')
    await db.open()
  })

  it('totals the items at their grams', () => {
    const t = estimateTotals([item(), item({ name: 'Cola', grams: 330, kcal100: 42, protein100: 0, carbs100: 10.6, fat100: 0 })])
    expect(Math.round(t.kcal)).toBe(Math.round(752.5 + 138.6))
    expect(Math.round(t.protein * 10) / 10).toBe(38.5)
  })

  it('logs each item as a custom food, skipping 0 g ones', async () => {
    await saveEstimatedItems([item(), item({ name: 'Sauce', grams: 0 })], (id, g) => logFood(id, g, '2026-10-23', 'dinner'))
    const foods = await db.foods.toArray()
    expect(foods).toHaveLength(1)
    expect(foods[0]).toMatchObject({ source: 'custom', name: 'Döner wrap', nameLower: 'döner wrap', kcal100: 215, servingG: 350 })
    const logs = await db.foodLogs.toArray()
    expect(logs).toMatchObject([{ date: '2026-10-23', meal: 'dinner', grams: 350, foodId: foods[0].id }])
  })

  it('plans instead when the sheet targets the plan', async () => {
    await saveEstimatedItems([item()], async (id, g) => void (await planFood(id, g, '2026-10-24', 'dinner')))
    expect(await db.foodLogs.count()).toBe(0)
    expect(await db.plannedFoods.toArray()).toMatchObject([{ date: '2026-10-24', meal: 'dinner', grams: 350 }])
  })
})
