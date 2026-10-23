import type {
  CoachInsightCategory, CoachInsightTone, MealEstimate, MealType,
} from '../../types'
import type { JsonSchema } from './provider'

/**
 * The structured-output schemas of every AI feature, as plain JSON Schema. Each
 * provider converts them to what its API accepts (`toGeminiSchema`,
 * `toStrictSchema`). The enum lists are shared with the parsers in src/lib/gemini.ts.
 */

export const CATEGORIES: CoachInsightCategory[] = [
  // workout categories
  'verdict', 'pr', 'progression', 'balance', 'intensity', 'consistency', 'milestone',
  // diet categories
  'calories', 'protein', 'macros', 'hydration',
]
export const TONES: CoachInsightTone[] = ['celebratory', 'positive', 'neutral', 'warning']
export const MEAL_ENUM: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack']
export const CONFIDENCE: MealEstimate['confidence'][] = ['low', 'medium', 'high']

/** Mirrors CoachNote (workout, diet day and week notes). */
export const COACH_NOTE_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    tone: { type: 'string', enum: TONES },
    insights: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: CATEGORIES },
          tone: { type: 'string', enum: TONES },
          message: { type: 'string' },
        },
        required: ['category', 'tone', 'message'],
      },
    },
  },
  required: ['headline', 'tone', 'insights'],
}

/** Mirrors RawWorkoutPlan (pre-workout opening weights). */
export const WEIGHT_PLAN_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    plan: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ref: { type: 'string' },
          sets: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                weightKg: { type: 'number' },
                reps: { type: 'number' },
              },
              required: ['weightKg', 'reps'],
            },
          },
          note: { type: 'string' },
        },
        required: ['ref', 'sets'],
      },
    },
  },
  required: ['plan'],
}

/** Mirrors MacroSuggestion (complete the day / swap a food). */
export const MACRO_SUGGESTION_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ref: { type: 'string' },
          food: { type: 'string' },
          brand: { type: 'string' },
          meal: { type: 'string', enum: MEAL_ENUM },
          grams: { type: 'number' },
          kcal: { type: 'number' },
          protein: { type: 'number' },
          carbs: { type: 'number' },
          fat: { type: 'number' },
          reason: { type: 'string' },
        },
        required: ['food', 'meal', 'grams', 'kcal', 'protein', 'carbs', 'fat'],
      },
    },
  },
  required: ['headline', 'items'],
}

/** Mirrors MealEstimate (takeaway meal broken into items with per-100 g macros). */
export const MEAL_ESTIMATE_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    confidence: { type: 'string', enum: CONFIDENCE },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          grams: { type: 'number' },
          kcal100: { type: 'number' },
          protein100: { type: 'number' },
          carbs100: { type: 'number' },
          fat100: { type: 'number' },
          note: { type: 'string' },
        },
        required: ['name', 'grams', 'kcal100', 'protein100', 'carbs100', 'fat100'],
      },
    },
  },
  required: ['headline', 'confidence', 'items'],
}
