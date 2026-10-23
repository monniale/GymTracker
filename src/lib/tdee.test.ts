import { describe, it, expect } from 'vitest'
import {
  ACTIVITY_FACTOR,
  GOAL_REACHED_KG,
  KCAL_PER_KG,
  ageFrom,
  bmrMifflin,
  goalEta,
  plannedRateKgPerWeek,
  listedRate,
  rateChoice,
  targetsFor,
  targetsPatch,
  tdee,
  type MacroTargets,
} from './tdee'

const male = { sex: 'm' as const, ageYears: 30, heightCm: 180, weightKg: 80 }
const female = { sex: 'f' as const, ageYears: 30, heightCm: 165, weightKg: 60 }

/** Rounded grams vs rounded kcal: off by at most 5 (kcal rounds to 10). */
function expectAddsUp(t: MacroTargets) {
  expect(Math.abs(4 * t.protein + 4 * t.carbs + 9 * t.fat - t.kcal)).toBeLessThanOrEqual(5)
}

describe('bmrMifflin / tdee', () => {
  it('matches the Mifflin-St Jeor reference values (raw, not rounded)', () => {
    expect(bmrMifflin(male)).toBe(1780)
    expect(bmrMifflin(female)).toBeCloseTo(1320.25, 10)
  })

  it('applies the activity factors', () => {
    expect(ACTIVITY_FACTOR).toEqual({ sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very: 1.9 })
    expect(tdee(1780, 'sedentary')).toBeCloseTo(2136)
    expect(tdee(1780, 'moderate')).toBeCloseTo(2759)
    expect(tdee(1780, 'very')).toBeCloseTo(3382)
    expect(KCAL_PER_KG).toBe(7700)
  })

  it('ageFrom uses the calendar year only and is never negative', () => {
    expect(ageFrom(1996, '2026-01-01')).toBe(30)
    expect(ageFrom(1996, '2026-12-31')).toBe(30)
    expect(ageFrom(2030, '2026-06-01')).toBe(0)
  })
})

describe('targetsFor', () => {
  const bmr = bmrMifflin(male)
  const t = tdee(bmr, 'moderate') // 2759

  it('-0.5 %/wk at 80 kg is about -440 kcal/day', () => {
    const r = targetsFor({ tdee: t, bmr, weightKg: 80, goalRatePctPerWeek: -0.5 })
    expect(r.dailyDeltaKcal).toBe(-440)
    expect(plannedRateKgPerWeek(80, -0.5)).toBeCloseTo(-0.4)
  })

  it('the deficit reaches the day targets (fat and carbs from the base, not tdee)', () => {
    const r = targetsFor({ tdee: t, bmr, weightKg: 80, goalRatePctPerWeek: -0.5 })
    // Base 2759 - 440 = 2319: the weekly average (3 training + 4 rest days) sits near it.
    const avg = (3 * r.training.kcal + 4 * r.rest.kcal) / 7
    expect(Math.abs(avg - (t + r.dailyDeltaKcal))).toBeLessThan(40)
    expect(r.training.fat).toBe(70) // 0.28 * 2319 / 9 = 72.1, not 85 from tdee
    expect(r.rest.fat).toBe(70)
    // An ordinary deficit keeps the training/rest carb split.
    expect(r.training.carbs).toBeGreaterThan(r.rest.carbs)
  })

  it('narrows the carb split just above the floor without dropping the rest day under it', () => {
    // Floor 1500 (bmr), base 2420 - 880 = 1540: a full 10 % split (145 / 120 g) would put the rest day under.
    const r = targetsFor({ tdee: 2420, bmr: 1500, weightKg: 80, goalRatePctPerWeek: -1 })
    expect(r.dailyDeltaKcal).toBe(-880)
    const diff = r.training.carbs - r.rest.carbs
    expect(diff).toBeGreaterThan(0)
    expect(diff).toBeLessThan(25)
    expect(r.rest.kcal).toBeGreaterThanOrEqual(1500 - 5)
  })

  it('maintenance has no delta and the weekly average stays close to tdee', () => {
    const r = targetsFor({ tdee: t, bmr, weightKg: 80, goalRatePctPerWeek: 0 })
    expect(r.dailyDeltaKcal).toBe(0)
    const avg = (3 * r.training.kcal + 4 * r.rest.kcal) / 7
    expect(Math.abs(avg - t)).toBeLessThan(40)
  })

  it('macros add up to kcal within rounding and are rounded (kcal 10, g 5)', () => {
    for (const rate of [-1, -0.5, 0, 0.25, 0.5]) {
      const r = targetsFor({ tdee: t, bmr, weightKg: 80, goalRatePctPerWeek: rate })
      for (const day of [r.training, r.rest]) {
        expectAddsUp(day)
        expect(day.kcal % 10).toBe(0)
        for (const g of [day.protein, day.carbs, day.fat]) expect(g % 5).toBe(0)
      }
    }
  })

  it('uses protein 1.8 g/kg and fat 28 % by default, same on both days', () => {
    const r = targetsFor({ tdee: t, bmr, weightKg: 80, goalRatePctPerWeek: 0 })
    expect(r.training.protein).toBe(145) // 144 -> 145
    expect(r.rest.protein).toBe(145)
    expect(r.training.fat).toBe(r.rest.fat)
    expect(r.training.fat).toBe(85) // 0.28 * 2759 / 9 = 85.8
  })

  it('clamps protein to 1.6-2.2 g/kg and fat to 25-30 %', () => {
    const lo = targetsFor({ tdee: t, bmr, weightKg: 80, goalRatePctPerWeek: 0, proteinGPerKg: 1, fatPct: 0.1 })
    expect(lo.training.protein).toBe(130) // 1.6 * 80 = 128
    expect(lo.training.fat).toBe(75) // 0.25 * 2759 / 9 = 76.6
    const hi = targetsFor({ tdee: t, bmr, weightKg: 80, goalRatePctPerWeek: 0, proteinGPerKg: 3, fatPct: 0.5 })
    expect(hi.training.protein).toBe(175) // 2.2 * 80 = 176
    expect(hi.training.fat).toBe(90) // 0.30 * 2759 / 9 = 92
  })

  it('an aggressive deficit never goes below max(1200, bmr)', () => {
    const r = targetsFor({ tdee: t, bmr, weightKg: 80, goalRatePctPerWeek: -1.5 })
    expect(r.dailyDeltaKcal).toBe(-980) // 1780 - 2759, not -1320
    // At the floor the split collapses: both days sit on the floor.
    expect(r.training.kcal).toBeGreaterThanOrEqual(bmr - 5)
    expect(r.rest.kcal).toBeGreaterThanOrEqual(bmr - 5)
    expect(r.training.kcal).toBeLessThanOrEqual(bmr + 25)
    expect(r.rest.kcal).toBeLessThanOrEqual(bmr + 25)
    expect(r.training.carbs).toBe(r.rest.carbs)
  })

  it('the 1200 floor wins over a lower bmr, and the floor never exceeds tdee', () => {
    const smallBmr = 1000
    const r = targetsFor({ tdee: 1400, bmr: smallBmr, weightKg: 50, goalRatePctPerWeek: -1 })
    expect(r.dailyDeltaKcal).toBe(-200)
    expect(r.rest.kcal).toBeGreaterThanOrEqual(1195)
    const tiny = targetsFor({ tdee: 1150, bmr: 950, weightKg: 45, goalRatePctPerWeek: -1 })
    expect(tiny.dailyDeltaKcal).toBe(0)
  })

  it('caps a surplus at +20 % of tdee', () => {
    const r = targetsFor({ tdee: 2000, bmr: 1500, weightKg: 100, goalRatePctPerWeek: 1 })
    // Raw delta would be 100 * 0.01 * 7700 / 7 = 1100.
    expect(r.dailyDeltaKcal).toBe(400)
    // The capped base (2400) reaches the day targets.
    const avg = (3 * r.training.kcal + 4 * r.rest.kcal) / 7
    expect(Math.abs(avg - 2400)).toBeLessThan(40)
  })

  it('splits carbs symmetrically between training and rest days', () => {
    const r = targetsFor({ tdee: t, bmr, weightKg: 80, goalRatePctPerWeek: 0 })
    // Base carbs: (2759 - 576 - 772.5) / 4 = 352.6 -> 388 / 317.
    expect(r.training.carbs).toBe(390)
    expect(r.rest.carbs).toBe(315)
    expect(r.training.kcal - r.rest.kcal).toBeGreaterThan(0)
    const none = targetsFor({ tdee: t, bmr, weightKg: 80, goalRatePctPerWeek: 0, carbSplit: 0 })
    expect(none.training).toEqual(none.rest)
  })

  it('never returns negative carbs', () => {
    const r = targetsFor({ tdee: 1300, bmr: 1200, weightKg: 150, goalRatePctPerWeek: 0, proteinGPerKg: 2.2 })
    expect(r.rest.carbs).toBe(0)
    expect(r.training.carbs).toBe(0)
  })
})

describe('goalEta', () => {
  it('weeks to the goal, rounded up', () => {
    expect(goalEta(80, 76, -0.4)).toBe(10)
    expect(goalEta(80, 75, -0.4)).toBe(13) // 12.5
    expect(goalEta(70, 74, 0.25)).toBe(16)
  })

  it('float noise does not add a week', () => {
    // -10.5 / -0.35 = 30.000000000000004 in floating point.
    expect(goalEta(70, 59.5, plannedRateKgPerWeek(70, -0.5))).toBe(30)
  })

  it('0 when the goal is within 0.3 kg', () => {
    expect(goalEta(80, 80.2, -0.4)).toBe(0)
    expect(goalEta(80, 79.8, 0)).toBe(0)
    // Exactly the threshold away (binary-exact 0.3 vs 0) is not reached yet.
    expect(goalEta(0, GOAL_REACHED_KG, 1)).toBe(1)
  })

  it('null for a zero rate or a rate in the wrong direction', () => {
    expect(goalEta(80, 76, 0)).toBeNull()
    expect(goalEta(80, 76, 0.3)).toBeNull()
    expect(goalEta(70, 74, -0.2)).toBeNull()
  })

  it('null when it would take more than 104 weeks', () => {
    expect(goalEta(80, 59, -0.2)).toBeNull() // 105 weeks
    expect(goalEta(80, 60, -0.2)).toBe(100)
    expect(goalEta(80, 54, -0.25)).toBe(104) // exactly 104 (26 / 0.25) is still shown
    expect(goalEta(80, 70, Number.NaN)).toBeNull()
  })
})

describe('targetsPatch', () => {
  it('maps training and rest targets to the 8 Settings fields', () => {
    const r = targetsFor({ tdee: 2759, bmr: 1780, weightKg: 80, goalRatePctPerWeek: -0.5 })
    expect(targetsPatch(r)).toEqual({
      kcalTarget: r.training.kcal,
      proteinTarget: r.training.protein,
      carbsTarget: r.training.carbs,
      fatTarget: r.training.fat,
      restKcalTarget: r.rest.kcal,
      restProteinTarget: r.rest.protein,
      restCarbsTarget: r.rest.carbs,
      restFatTarget: r.rest.fat,
    })
  })
})

describe('rateChoice', () => {
  it('keeps a listed magnitude whatever its sign', () => {
    expect(rateChoice('lose', -0.75)).toBe(0.75)
    expect(rateChoice('gain', 0.5)).toBe(0.5)
  })
  it('falls back to the direction default for an unlisted or missing rate', () => {
    expect(rateChoice('gain', 0.75)).toBe(0.25)
    expect(rateChoice('lose', 0.3)).toBe(0.5)
    expect(rateChoice('lose', undefined)).toBe(0.5)
  })
  it('listedRate is null for an unlisted, zero or missing rate', () => {
    expect(listedRate('lose', -0.75)).toBe(0.75)
    expect(listedRate('gain', 0.75)).toBeNull()
    expect(listedRate('lose', 0)).toBeNull()
    expect(listedRate('lose', undefined)).toBeNull()
  })
})
