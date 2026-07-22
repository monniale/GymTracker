import { describe, it, expect } from 'vitest'
import { parseWeightPlan, parseMacroSuggestion } from './gemini'
import { snapWeight } from './workoutSuggest'
import {
  macroBasisSig,
  formatMacroCompletionBriefing,
  formatSubstitutionBriefing,
  type MacroCompletionBriefing,
  type SubstitutionBriefing,
  type CandidateFood,
} from './dietReport'
import { formatWorkoutPlanBriefing, type WorkoutPlanBriefing } from './coachBriefing'
import { pickBestOff } from './foodResolve'
import type { OffProduct } from './off'
import type { MacroSuggestionItem } from '../types'

/* ---------- parseWeightPlan (F2) ---------- */

describe('parseWeightPlan', () => {
  it('parses a valid plan and rounds reps', () => {
    const { plan } = parseWeightPlan(
      JSON.stringify({ plan: [{ ref: '3', sets: [{ weightKg: 82.5, reps: 8 }, { weightKg: 80, reps: 8.4 }] }] }),
    )
    expect(plan).toEqual([{ ref: '3', sets: [{ weightKg: 82.5, reps: 8 }, { weightKg: 80, reps: 8 }], note: undefined }])
  })

  it('drops sets with non-positive reps or non-finite weight', () => {
    const { plan } = parseWeightPlan(
      JSON.stringify({ plan: [{ ref: '1', sets: [{ weightKg: 60, reps: 0 }, { weightKg: 'x', reps: 5 }, { weightKg: 60, reps: 5 }] }] }),
    )
    expect(plan).toEqual([{ ref: '1', sets: [{ weightKg: 60, reps: 5 }], note: undefined }])
  })

  it('drops entries missing a ref or with no usable sets', () => {
    const { plan } = parseWeightPlan(
      JSON.stringify({ plan: [{ sets: [{ weightKg: 60, reps: 5 }] }, { ref: 'a', sets: [{ weightKg: 60, reps: 0 }] }] }),
    )
    expect(plan).toEqual([])
  })

  it('allows a zero weight (unknown starting load)', () => {
    const { plan } = parseWeightPlan(JSON.stringify({ plan: [{ ref: '2', sets: [{ weightKg: 0, reps: 8 }] }] }))
    expect(plan[0].sets[0]).toEqual({ weightKg: 0, reps: 8 })
  })

  it('returns an empty plan on invalid/truncated JSON (→ offline fallback)', () => {
    expect(parseWeightPlan('{"plan": [{"ref": "1", "sets": [{"weightKg": 8').plan).toEqual([])
    expect(parseWeightPlan('not json').plan).toEqual([])
  })
})

/* ---------- parseMacroSuggestion (F1) ---------- */

describe('parseMacroSuggestion', () => {
  const item = (over: Record<string, unknown> = {}) => ({
    ref: '5', food: 'Chicken breast', meal: 'lunch', grams: 150,
    kcal: 248, protein: 46, carbs: 0, fat: 5, reason: 'protein', ...over,
  })

  it('parses valid items and rounds macros', () => {
    const r = parseMacroSuggestion(JSON.stringify({ headline: 'Almost there', items: [item({ kcal: 247.6 })] }))
    expect(r.headline).toBe('Almost there')
    expect(r.items).toHaveLength(1)
    expect(r.items[0]).toMatchObject({ ref: '5', food: 'Chicken breast', meal: 'lunch', grams: 150, kcal: 248, protein: 46 })
  })

  it('coerces an invalid meal to snack and keeps a missing ref undefined', () => {
    const r = parseMacroSuggestion(JSON.stringify({ headline: 'x', items: [item({ meal: 'brunch', ref: undefined })] }))
    expect(r.items[0].meal).toBe('snack')
    expect(r.items[0].ref).toBeUndefined()
  })

  it('drops items with no food name or non-positive grams', () => {
    const r = parseMacroSuggestion(JSON.stringify({ headline: 'x', items: [item({ food: '' }), item({ grams: 0 }), item()] }))
    expect(r.items).toHaveLength(1)
  })

  it('salvages the headline from truncated JSON with no items', () => {
    const r = parseMacroSuggestion('{"headline": "Add some protein", "items": [{"food": "Egg')
    expect(r.headline).toBe('Add some protein')
    expect(r.items).toEqual([])
  })

  it('falls back to a default headline when absent', () => {
    const r = parseMacroSuggestion(JSON.stringify({ items: [] }))
    expect(r.headline).toBeTruthy()
    expect(r.items).toEqual([])
  })
})

/* ---------- snapWeight (F2) ---------- */

describe('snapWeight', () => {
  it('snaps to the nearest step increment', () => {
    expect(snapWeight(83, 2.5, 600)).toBe(82.5)
    expect(snapWeight(81.4, 2.5, 600)).toBe(82.5)
    expect(snapWeight(61, 1.25, 600)).toBe(61.25)
  })
  it('clamps to the max', () => {
    expect(snapWeight(999, 2.5, 300)).toBe(300)
  })
  it('returns 0 for non-positive weights', () => {
    expect(snapWeight(0, 2.5, 600)).toBe(0)
    expect(snapWeight(-5, 2.5, 600)).toBe(0)
  })
  it('defaults a non-positive step to 2.5', () => {
    expect(snapWeight(83, 0, 600)).toBe(82.5)
  })
})

/* ---------- macroBasisSig (F1 cache staleness) ---------- */

describe('macroBasisSig', () => {
  it('is stable within a bucket but changes on a real logged portion', () => {
    const a = macroBasisSig({ kcal: 620, protein: 38, carbs: 50, fat: 20 })
    const b = macroBasisSig({ kcal: 623, protein: 39, carbs: 51, fat: 20 }) // sub-bucket drift
    const c = macroBasisSig({ kcal: 372, protein: 8, carbs: 20, fat: 15 }) // logged a chicken breast
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })
})

/* ---------- format briefings (pure prompts) ---------- */

const candidate = (p: Partial<CandidateFood> = {}): CandidateFood => ({
  ref: '5', name: 'Chicken breast', kcal100: 165, protein100: 31, carbs100: 0, fat100: 4, typicalGrams: 150, ...p,
})

describe('formatMacroCompletionBriefing', () => {
  const briefing = (p: Partial<MacroCompletionBriefing> = {}): MacroCompletionBriefing => ({
    date: '2026-07-22', isTraining: true, bodyweightKg: 80,
    totals: { kcal: 1880, protein: 122, carbs: 230, fat: 60 },
    targets: { kcal: 2500, protein: 160, carbs: 280, fat: 80 },
    remaining: { kcal: 620, protein: 38, carbs: 50, fat: 20 },
    meals: [{ meal: 'breakfast', kcal: 600, protein: 40 }],
    candidates: [candidate()],
    ...p,
  })

  it('states the remaining macros as "to go"', () => {
    const t = formatMacroCompletionBriefing(briefing())
    expect(t).toContain('REMAINING today:')
    expect(t).toContain('Calories: 620 kcal to go')
    expect(t).toContain('Protein: 38 g to go')
  })

  it('marks an exceeded target as "over"', () => {
    const t = formatMacroCompletionBriefing(briefing({ remaining: { kcal: -120, protein: 5, carbs: 0, fat: -3 } }))
    expect(t).toContain('Calories: met (120 kcal over)')
    expect(t).toContain('Fat: met (3 g over)')
  })

  it('lists candidate foods with their ref and per-100g macros', () => {
    const t = formatMacroCompletionBriefing(briefing())
    expect(t).toContain('STRONGLY prefer these')
    expect(t).toContain('- 5) Chicken breast — per 100g: 165 kcal, 31P 0C 4F; typical 150 g')
  })

  it('handles an empty candidate list', () => {
    const t = formatMacroCompletionBriefing(briefing({ candidates: [] }))
    expect(t).toContain('none tracked yet')
  })
})

describe('formatSubstitutionBriefing', () => {
  const briefing = (): SubstitutionBriefing => ({
    date: '2026-07-22', isTraining: false, bodyweightKg: 80,
    current: { name: 'White rice', brand: 'Store', meal: 'dinner', grams: 100, kcal: 130, protein: 3, carbs: 28, fat: 0 },
    remaining: { kcal: 400, protein: 30, carbs: 10, fat: 15 },
    candidates: [candidate({ ref: '9', name: 'Potatoes', kcal100: 77 })],
  })

  it('describes the food to replace and remaining macros', () => {
    const t = formatSubstitutionBriefing(briefing())
    expect(t).toContain('Food to replace: White rice [Store] — 100 g in dinner: 130 kcal')
    expect(t).toContain('Remaining today: 400 kcal, 30g protein')
    expect(t).toContain('- 9) Potatoes')
  })
})

/* ---------- pickBestOff (F1 OFF grounding) ---------- */

describe('pickBestOff', () => {
  const off = (p: Partial<OffProduct>): OffProduct => ({
    offId: '1', name: 'x', kcal100: 0, protein100: 0, carbs100: 0, fat100: 0, ...p,
  })
  const item = (p: Partial<MacroSuggestionItem> = {}): MacroSuggestionItem => ({
    food: 'Greek yogurt', meal: 'snack', grams: 150, kcal: 160, protein: 30, carbs: 8, fat: 1, ...p,
  })

  it('accepts a close macro match', () => {
    // 150g of a 100kcal/20g-protein product = 150kcal/30g protein ≈ the estimate
    const match = pickBestOff([off({ offId: 'a', kcal100: 107, protein100: 20 })], item())
    expect(match?.offId).toBe('a')
  })

  it('rejects a wildly-off top hit (→ caller uses the model estimate)', () => {
    // A dessert yogurt: 150g = 180kcal but only 6g protein vs the promised 30g
    expect(pickBestOff([off({ offId: 'b', kcal100: 120, protein100: 4 })], item())).toBeNull()
  })

  it('picks the closest of several results', () => {
    const results = [
      off({ offId: 'far', kcal100: 250, protein100: 5 }),
      off({ offId: 'near', kcal100: 107, protein100: 20 }),
    ]
    expect(pickBestOff(results, item())?.offId).toBe('near')
  })

  it('returns null for an empty result set', () => {
    expect(pickBestOff([], item())).toBeNull()
  })
})

describe('formatWorkoutPlanBriefing', () => {
  const briefing = (): WorkoutPlanBriefing => ({
    sessionName: 'Push A', bodyweightKg: 82, barKg: 20,
    exercises: [
      {
        ref: '3', exerciseId: 3, name: 'Bench Press', muscleGroup: 'chest', equipment: 'barbell',
        targetSets: 3, targetReps: 8, stepKg: 2.5,
        lastSets: [{ weightKg: 80, reps: 8 }, { weightKg: 80, reps: 8 }],
        baseline: { weightKg: 82.5, reps: 8, reason: 'weight-up' }, strengthLevel: 'intermediate', recentBestE1rm: 100,
      },
      {
        ref: '7', exerciseId: 7, name: 'Fly', muscleGroup: 'chest',
        targetSets: 3, targetReps: 12, stepKg: 2.5, lastSets: [], baseline: null, strengthLevel: null, recentBestE1rm: null,
      },
    ],
  })

  it('serializes each exercise with its ref, target, last sets and baseline', () => {
    const t = formatWorkoutPlanBriefing(briefing())
    expect(t).toContain('round weights to 2.5 kg increments')
    expect(t).toContain('- 3) Bench Press (chest, barbell, level intermediate): target 3×8, step 2.5kg. Last: 80kg×8, 80kg×8. Baseline: 82.5kg×8 (add weight).')
    expect(t).toContain('- 7) Fly (chest): target 3×12, step 2.5kg. Last: no history. Baseline: none (repeat last, or start light if new).')
  })
})
