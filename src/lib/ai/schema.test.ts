import { describe, it, expect } from 'vitest'
import { toGeminiSchema, toStrictSchema, schemaPromptLine } from './schema'
import * as schemas from './schemas'
import type { JsonSchema } from './provider'

const TONES = ['celebratory', 'positive', 'neutral', 'warning']
const CATEGORIES = [
  'verdict', 'pr', 'progression', 'balance', 'intensity', 'consistency', 'milestone',
  'calories', 'protein', 'macros', 'hydration',
]

/** The responseSchema literals src/lib/gemini.ts sent before the provider layer (must not change). */
const OLD = {
  COACH_NOTE_SCHEMA: {
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
  },
  WEIGHT_PLAN_SCHEMA: {
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
                properties: { weightKg: { type: 'number' }, reps: { type: 'number' } },
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
  },
  MACRO_SUGGESTION_SCHEMA: {
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
            meal: { type: 'string', enum: ['breakfast', 'lunch', 'dinner', 'snack'] },
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
  },
  MEAL_ESTIMATE_SCHEMA: {
    type: 'object',
    properties: {
      headline: { type: 'string' },
      confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
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
  },
}

describe('toGeminiSchema', () => {
  for (const name of Object.keys(OLD) as (keyof typeof OLD)[]) {
    it(`sends exactly the old ${name}`, () => {
      const converted = toGeminiSchema(schemas[name])
      expect(converted).toEqual(OLD[name])
      // Same key order too, so the request body serializes byte for byte as before.
      expect(JSON.stringify(converted)).toBe(JSON.stringify(OLD[name]))
    })
  }

  it('drops additionalProperties/$schema and maps a nullable type to the OpenAPI flag', () => {
    const s: JsonSchema = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      additionalProperties: false,
      properties: { a: { type: ['string', 'null'] }, b: { type: 'array', items: { type: 'object', additionalProperties: false } } },
    }
    expect(toGeminiSchema(s)).toEqual({
      type: 'object',
      properties: { a: { type: 'string', nullable: true }, b: { type: 'array', items: { type: 'object' } } },
    })
  })

  it('does not mutate its input', () => {
    const before = JSON.stringify(schemas.COACH_NOTE_SCHEMA)
    toGeminiSchema(schemas.COACH_NOTE_SCHEMA)
    expect(JSON.stringify(schemas.COACH_NOTE_SCHEMA)).toBe(before)
  })
})

describe('toStrictSchema', () => {
  it('closes every object and requires every property, nested arrays included', () => {
    const s = toStrictSchema(schemas.WEIGHT_PLAN_SCHEMA)
    expect(s.additionalProperties).toBe(false)
    expect(s.required).toEqual(['plan'])
    const entry = s.properties!.plan.items!
    expect(entry.additionalProperties).toBe(false)
    expect(entry.required).toEqual(['ref', 'sets', 'note'])
    const set = entry.properties!.sets.items!
    expect(set.additionalProperties).toBe(false)
    expect(set.required).toEqual(['weightKg', 'reps'])
    expect(set.properties!.reps).toEqual({ type: 'number' })
  })

  it('turns an optional property into a nullable one and leaves required ones alone', () => {
    const s = toStrictSchema(schemas.MACRO_SUGGESTION_SCHEMA)
    const item = s.properties!.items.items!
    expect(item.properties!.ref).toEqual({ type: ['string', 'null'] })
    expect(item.properties!.brand).toEqual({ type: ['string', 'null'] })
    expect(item.properties!.reason).toEqual({ type: ['string', 'null'] })
    expect(item.properties!.food).toEqual({ type: 'string' })
    expect(item.properties!.meal).toEqual({ type: 'string', enum: ['breakfast', 'lunch', 'dinner', 'snack'] })
  })

  it('adds null to the enum of an optional enum property', () => {
    const s = toStrictSchema({ type: 'object', properties: { tone: { type: 'string', enum: ['a', 'b'] } } })
    expect(s.properties!.tone).toEqual({ type: ['string', 'null'], enum: ['a', 'b', null] })
  })

  it('maps the OpenAPI nullable flag and keeps an existing null type once', () => {
    const s = toStrictSchema({
      type: 'object',
      properties: { a: { type: 'number', nullable: true }, b: { type: ['string', 'null'] } },
      required: ['a'],
    })
    expect(s.properties!.a).toEqual({ type: ['number', 'null'] })
    expect(s.properties!.b).toEqual({ type: ['string', 'null'] })
  })

  it('strips size/range constraints and unsupported formats, keeps supported formats', () => {
    const s = toStrictSchema({
      type: 'object',
      properties: {
        n: { type: 'number', minimum: 0, maximum: 10 },
        s: { type: 'string', minLength: 1, maxLength: 5, format: 'int32' },
        d: { type: 'string', format: 'date-time', description: 'when' },
        l: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string' } },
      },
      required: ['n', 's', 'd', 'l'],
    })
    expect(s.properties).toEqual({
      n: { type: 'number' },
      s: { type: 'string' },
      d: { type: 'string', format: 'date-time', description: 'when' },
      l: { type: 'array', items: { type: 'string' } },
    })
  })

  it('wraps an optional property without a type in anyOf with null', () => {
    const s = toStrictSchema({ type: 'object', properties: { x: { anyOf: [{ type: 'string' }, { type: 'number' }] } } })
    expect(s.properties!.x).toEqual({ anyOf: [{ anyOf: [{ type: 'string' }, { type: 'number' }] }, { type: 'null' }] })
  })

  it('does not mutate its input', () => {
    const before = JSON.stringify(schemas.MEAL_ESTIMATE_SCHEMA)
    toStrictSchema(schemas.MEAL_ESTIMATE_SCHEMA)
    expect(JSON.stringify(schemas.MEAL_ESTIMATE_SCHEMA)).toBe(before)
  })
})

describe('schemaPromptLine', () => {
  it('embeds the schema as JSON in one line', () => {
    const line = schemaPromptLine(schemas.COACH_NOTE_SCHEMA)
    expect(line).not.toContain('\n')
    expect(line).toMatch(/JSON/)
    expect(line).toContain(JSON.stringify(schemas.COACH_NOTE_SCHEMA))
  })
})
