import { describe, it, expect } from 'vitest'
import { parseMacroSuggestion, parseMealEstimate, parseWeightPlan } from './gemini'

/**
 * Strict structured output (OpenAI-compatible and Claude, ai/schema.ts toStrictSchema) makes
 * every optional field required but nullable, so those models answer `null` where Gemini
 * leaves the field out. The parsers must read that null as absent, never as the text 'null'.
 */
describe('parsers on strict-mode answers (optional fields as null)', () => {
  it('parseWeightPlan: note null → undefined', () => {
    const plan = parseWeightPlan('{"plan":[{"ref":"a","sets":[{"weightKg":20,"reps":5}],"note":null}]}')
    expect(plan.plan).toEqual([{ ref: 'a', sets: [{ weightKg: 20, reps: 5 }], note: undefined }])
  })

  it('parseMacroSuggestion: ref, brand and reason null → undefined', () => {
    const s = parseMacroSuggestion(JSON.stringify({
      headline: 'Close the protein gap',
      items: [{ ref: null, food: 'Greek yogurt', brand: null, meal: 'snack', grams: 170, kcal: 100, protein: 17, carbs: 6, fat: 0, reason: null }],
    }))
    expect(s.items).toHaveLength(1)
    const item = s.items[0]
    expect(item.ref).toBeUndefined()
    expect(item.brand).toBeUndefined()
    expect(item.reason).toBeUndefined()
    expect(item.food).toBe('Greek yogurt')
  })

  it('parseMealEstimate: note null → undefined', () => {
    const e = parseMealEstimate(JSON.stringify({
      headline: 'Kebab with fries',
      confidence: 'medium',
      items: [{ name: 'Fries', grams: 150, kcal100: 312, protein100: 3.4, carbs100: 41, fat100: 15, note: null }],
    }))
    expect(e.items).toHaveLength(1)
    expect(e.items[0].note).toBeUndefined()
    expect(e.items[0].name).toBe('Fries')
  })
})
