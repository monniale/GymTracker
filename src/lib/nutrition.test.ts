import { describe, it, expect } from 'vitest'
import { recipePer100 } from './nutrition'
import { validEan } from './scanner'

const chicken = { kcal100: 165, protein100: 31, carbs100: 0, fat100: 3.6 }
const rice = { kcal100: 350, protein100: 7, carbs100: 77, fat100: 1 }

describe('recipePer100', () => {
  it('computes per-100g macros from raw ingredients and cooked weight', () => {
    // 200g chicken + 100g rice, cooked down/up to 450g total.
    const r = recipePer100(
      [{ food: chicken, grams: 200 }, { food: rice, grams: 100 }],
      450,
    )
    // totals: kcal 330+350=680, P 62+7=69, C 77, F 7.2+1=8.2 → per 100g of 450g
    expect(r.kcal100).toBeCloseTo(151.1, 1)
    expect(r.protein100).toBeCloseTo(15.3, 1)
    expect(r.carbs100).toBeCloseTo(17.1, 1)
    expect(r.fat100).toBeCloseTo(1.8, 1)
  })
  it('handles zero cooked weight without dividing by zero', () => {
    expect(recipePer100([{ food: rice, grams: 100 }], 0).kcal100).toBe(0)
  })
})

describe('validEan', () => {
  it('accepts valid EAN-13 (Nutella) and EAN-8', () => {
    expect(validEan('3017620422003')).toBe(true)
    expect(validEan('96385074')).toBe(true)
  })
  it('rejects bad checksums and wrong lengths', () => {
    expect(validEan('3017620422004')).toBe(false)
    expect(validEan('12345')).toBe(false)
    expect(validEan('abcdefghijklm')).toBe(false)
  })
})
