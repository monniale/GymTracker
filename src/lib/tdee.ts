// TDEE / macro calculator (pure: no db, no i18n). Everything here is an
// estimate: Mifflin-St Jeor BMR times an activity factor, then a daily kcal
// delta from the planned weekly rate (1 kg of body mass ~ 7700 kcal). The UI
// shows a disclaimer and the user adjusts after 2-3 weeks of real data.
//
// Rounding policy: bmrMifflin and tdee return raw floats (callers round for
// display); the targets are rounded at the end (kcal to 10, grams to 5).

import type { Settings } from '../types'

export type Sex = 'm' | 'f'
export type Activity = 'sedentary' | 'light' | 'moderate' | 'active' | 'very'

export const ACTIVITY_FACTOR: Record<Activity, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very: 1.9,
}

/** Energy in 1 kg of body mass change (the usual rule of thumb). */
export const KCAL_PER_KG = 7700

/** Absolute kcal floor of a deficit (also never below BMR). */
const MIN_KCAL = 1200
/** A surplus is capped at this share of TDEE. */
const MAX_SURPLUS = 0.2

const PROTEIN_DEFAULT = 1.8
const PROTEIN_MIN = 1.6
const PROTEIN_MAX = 2.2
const FAT_DEFAULT = 0.28
const FAT_MIN = 0.25
const FAT_MAX = 0.3
const SPLIT_DEFAULT = 0.1
const SPLIT_MAX = 0.3

/**
 * Below this distance (kg) the goal counts as reached. The single source for
 * `goalEta`, `goalStatus` and the goal direction (`goalDirection.ts`).
 */
export const GOAL_REACHED_KG = 0.3
/** goalEta gives up (null) beyond this many weeks (2 years). */
const MAX_ETA_WEEKS = 104

/**
 * Weekly rate choices in % of bodyweight, shared by the calculator and the goal
 * sheet. A fixed pick, not a stepper: NumberStepper shows one decimal and would
 * display 0.25 / 0.75 rounded.
 */
export const RATE_CHOICES: Record<'lose' | 'gain', readonly number[]> = {
  lose: [0.25, 0.5, 0.75, 1],
  gain: [0.25, 0.5],
}
export const DEFAULT_RATE: Record<'lose' | 'gain', number> = { lose: 0.5, gain: 0.25 }

/** The magnitude of `pct` (sign ignored) when it is one of the choices for that direction, else null (no rate picked). */
export function listedRate(dir: 'lose' | 'gain', pct: number | undefined): number | null {
  const m = Math.abs(pct ?? 0)
  return RATE_CHOICES[dir].includes(m) ? m : null
}

/** The rate magnitude to show for a direction: `pct` (sign ignored) if it is a choice there, else the default. */
export function rateChoice(dir: 'lose' | 'gain', pct: number | undefined): number {
  return listedRate(dir, pct) ?? DEFAULT_RATE[dir]
}

/** Mifflin-St Jeor BMR in kcal/day (raw, not rounded). */
export function bmrMifflin(p: { sex: Sex; ageYears: number; heightCm: number; weightKg: number }): number {
  return 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.ageYears + (p.sex === 'm' ? 5 : -161)
}

/** Total daily energy expenditure: BMR times the activity factor (raw). */
export function tdee(bmr: number, activity: Activity): number {
  return bmr * (ACTIVITY_FACTOR[activity] ?? ACTIVITY_FACTOR.moderate)
}

/**
 * Age from the birth year only: calendar year of `today` (YYYY-MM-DD) minus
 * `birthYear`. Up to one year high before the birthday, which moves BMR by
 * 5 kcal at most; never negative.
 */
export function ageFrom(birthYear: number, today: string): number {
  const year = Number(today.slice(0, 4))
  return Math.max(0, year - birthYear)
}

export interface MacroTargets {
  kcal: number
  protein: number
  carbs: number
  fat: number
}

function clamp(v: number | undefined, lo: number, hi: number, dflt: number): number {
  if (v === undefined || !Number.isFinite(v)) return dflt
  return Math.min(hi, Math.max(lo, v))
}

const round10 = (n: number) => Math.round(n / 10) * 10
const round5 = (n: number) => Math.round(n / 5) * 5

/** Rounded day targets; with a `floor`, carbs step up by 5 g until the day reaches it. */
function dayTargets(protein: number, carbs: number, fat: number, floor = 0): MacroTargets {
  const p = round5(protein)
  let c = Math.max(0, round5(carbs))
  const f = round5(fat)
  while (4 * p + 4 * c + 9 * f < floor) c += 5
  return { kcal: round10(4 * p + 4 * c + 9 * f), protein: p, carbs: c, fat: f }
}

/**
 * Training-day and rest-day targets from TDEE and the planned weekly rate
 * (`goalRatePctPerWeek`: % of bodyweight per week, negative to lose).
 *
 * - Base kcal = tdee + weightKg * rate/100 * KCAL_PER_KG / 7.
 *   Losing: never below max(1200, bmr) (but never above tdee either, so a very
 *   small person is not pushed into a surplus). Gaining: surplus capped at
 *   +20 % of tdee.
 * - Protein = proteinGPerKg (1.6-2.2, default 1.8) * weightKg, same both days.
 * - Fat = fatPct (0.25-0.30, default 0.28) * base kcal / 9, same both days.
 * - Carbs = the remainder / 4 (at least 0); training day carbs * (1 + split),
 *   rest day carbs * (1 - split), split default 0.10 (0-0.30). Each day's kcal
 *   follows from its rounded macros (4p + 4c + 9f).
 * - When losing near the floor, the split is narrowed so the rest day does not
 *   drop below the floor (at the floor both days are equal), and a day that
 *   rounding pushed under the floor gets 5 g carb steps back up to it (its
 *   kcal, rounded to 10, can still read up to 5 under).
 *
 * Weekly average: with 3 training and 4 rest days the average carbs are
 * carbs * (1 - split/7), so the average kcal is base - 4 * carbs * split / 7:
 * about 15 kcal/day under the base for 250 g carbs at the default split.
 * We accept this (inside the estimate's error) rather than skewing the split.
 *
 * `dailyDeltaKcal` is the effective delta after the clamps (base - tdee,
 * rounded to 10), negative when losing.
 */
export function targetsFor(p: {
  tdee: number
  bmr: number
  weightKg: number
  goalRatePctPerWeek: number
  proteinGPerKg?: number
  fatPct?: number
  carbSplit?: number
}): { training: MacroTargets; rest: MacroTargets; dailyDeltaKcal: number } {
  const rate = Number.isFinite(p.goalRatePctPerWeek) ? p.goalRatePctPerWeek : 0
  const rawDelta = (p.weightKg * rate) / 100 * KCAL_PER_KG / 7
  let base = p.tdee + rawDelta
  let floor = 0
  if (rawDelta < 0) {
    floor = Math.min(Math.max(MIN_KCAL, p.bmr), p.tdee)
    base = Math.max(base, floor)
  } else if (rawDelta > 0) {
    base = Math.min(base, p.tdee * (1 + MAX_SURPLUS))
  }

  const proteinPerKg = clamp(p.proteinGPerKg, PROTEIN_MIN, PROTEIN_MAX, PROTEIN_DEFAULT)
  const fatPct = clamp(p.fatPct, FAT_MIN, FAT_MAX, FAT_DEFAULT)
  let split = clamp(p.carbSplit, 0, SPLIT_MAX, SPLIT_DEFAULT)

  const protein = proteinPerKg * p.weightKg
  const fat = (fatPct * base) / 9
  const carbs = Math.max(0, (base - protein * 4 - fat * 9) / 4)

  if (floor > 0 && carbs > 0) {
    // Rest day kcal = base - 4 * carbs * split; keep it at or above the floor.
    split = Math.min(split, Math.max(0, (base - floor) / (4 * carbs)))
  }

  return {
    training: dayTargets(protein, carbs * (1 + split), fat, floor),
    rest: dayTargets(protein, carbs * (1 - split), fat, floor),
    dailyDeltaKcal: round10(base - p.tdee),
  }
}

/** Planned weekly change in kg (negative when losing). */
export function plannedRateKgPerWeek(weightKg: number, pct: number): number {
  return (weightKg * pct) / 100
}

/**
 * Weeks to reach `goalKg` at `ratePerWeek` kg/week, rounded up to whole weeks.
 * 0 when already within 0.3 kg. null when the rate is 0 or points away from
 * the goal ("not on track"), or when it would take more than 104 weeks
 * ("too far"): the UI shows no date rather than a meaningless one.
 */
export function goalEta(currentKg: number, goalKg: number, ratePerWeek: number): number | null {
  if (![currentKg, goalKg, ratePerWeek].every(Number.isFinite)) return null
  const diff = goalKg - currentKg
  if (Math.abs(diff) < GOAL_REACHED_KG) return 0
  if (ratePerWeek === 0 || Math.sign(ratePerWeek) !== Math.sign(diff)) return null
  const weeks = diff / ratePerWeek
  if (weeks > MAX_ETA_WEEKS) return null
  // The epsilon keeps float noise (10.5 / 0.35 = 30.000000000000004) from adding a week.
  return Math.ceil(weeks - 1e-9)
}

/** The 8 Settings target fields for a targetsFor result. */
export function targetsPatch(r: ReturnType<typeof targetsFor>): Partial<Settings> {
  return {
    kcalTarget: r.training.kcal,
    proteinTarget: r.training.protein,
    carbsTarget: r.training.carbs,
    fatTarget: r.training.fat,
    restKcalTarget: r.rest.kcal,
    restProteinTarget: r.rest.protein,
    restCarbsTarget: r.rest.carbs,
    restFatTarget: r.rest.fat,
  }
}
