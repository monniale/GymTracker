import { db } from '../db/db'
import { addDays, parseLocalDate, localDateStr } from './dates'
import { totalsForLogs, dayTargets, macrosFor, type MacroTotals, type DayTargets } from './nutrition'
import type { Food, FoodLog, Id, MealType } from '../types'

/** Rolling trailing-7-day nutrition summary ending on `endDate`. Mirrors the
 * WeekReport computation in DietDay (window, training/rest resolution, ±10%
 * kcal adherence), extended with carbs/fat for the AI briefing. */
export interface WeekNutrition {
  loggedDays: number
  avgKcal: number
  avgProtein: number
  avgCarbs: number
  avgFat: number
  proteinPerKg: number
  /** Days within ±10% of the kcal target. */
  adherent: number
  trainingDays: number
}

export async function gatherWeekNutrition(endDate: string): Promise<WeekNutrition | null> {
  const settings = await db.settings.get(1)
  if (!settings) return null
  const days = Array.from({ length: 7 }, (_, i) => addDays(endDate, i - 6))

  const [foods, logs, dayTypeRows] = await Promise.all([
    db.foods.toArray(),
    db.foodLogs.where('date').anyOf(days).toArray(),
    db.dayTypes.where('date').anyOf(days).toArray(),
  ])
  const foodsById = new Map(foods.map(f => [f.id!, f]))
  const overrides = new Map(dayTypeRows.map(d => [d.date, d.type]))
  const rangeStart = parseLocalDate(days[0]).getTime()
  const sessions = await db.sessions.where('startedAt').aboveOrEqual(rangeStart).toArray()
  const trainedDates = new Set(sessions.map(s => localDateStr(new Date(s.startedAt))))

  let loggedDays = 0, kcalSum = 0, proteinSum = 0, carbsSum = 0, fatSum = 0, adherent = 0, trainingDays = 0
  for (const d of days) {
    const dayLogs = logs.filter(l => l.date === d)
    const isTraining = overrides.has(d) ? overrides.get(d) === 'training' : trainedDates.has(d)
    if (isTraining) trainingDays++
    if (dayLogs.length === 0) continue
    loggedDays++
    const t = totalsForLogs(dayLogs, foodsById)
    kcalSum += t.kcal
    proteinSum += t.protein
    carbsSum += t.carbs
    fatSum += t.fat
    const target = dayTargets(settings, isTraining).kcal
    if (Math.abs(t.kcal - target) <= target * 0.1) adherent++
  }
  return {
    loggedDays,
    avgKcal: loggedDays ? Math.round(kcalSum / loggedDays) : 0,
    avgProtein: loggedDays ? Math.round(proteinSum / loggedDays) : 0,
    avgCarbs: loggedDays ? Math.round(carbsSum / loggedDays) : 0,
    avgFat: loggedDays ? Math.round(fatSum / loggedDays) : 0,
    proteinPerKg: loggedDays
      ? Math.round((proteinSum / loggedDays / settings.bodyweightKg) * 100) / 100
      : 0,
    adherent,
    trainingDays,
  }
}

/** Structured summary of one day of eating (with weekly context) for the AI. */
export interface DietBriefing {
  date: string
  isTraining: boolean
  totals: MacroTotals
  targets: DayTargets
  meals: { meal: MealType; kcal: number; protein: number }[]
  waterMl: number
  waterTargetMl: number
  bodyweightKg: number
  week: WeekNutrition | null
}

const MEAL_ORDER: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack']

export async function gatherDietBriefing(date: string): Promise<DietBriefing | null> {
  const settings = await db.settings.get(1)
  if (!settings) return null

  const [foods, logs, waterLogs, override] = await Promise.all([
    db.foods.toArray(),
    db.foodLogs.where('date').equals(date).toArray(),
    db.waterLogs.where('date').equals(date).toArray(),
    db.dayTypes.get(date),
  ])
  if (logs.length === 0) return null // nothing to judge

  const foodsById = new Map(foods.map(f => [f.id!, f]))

  // Training/rest resolution — mirror DietDay: manual override else any session that day.
  const dayStartMs = parseLocalDate(date).getTime()
  const sessionCount = await db.sessions
    .where('startedAt')
    .between(dayStartMs, dayStartMs + 86_400_000)
    .count()
  const isTraining = override ? override.type === 'training' : sessionCount > 0

  const totals = totalsForLogs(logs, foodsById)
  const targets = dayTargets(settings, isTraining)

  const meals: DietBriefing['meals'] = []
  for (const m of MEAL_ORDER) {
    const mLogs = logs.filter(l => l.meal === m)
    if (mLogs.length === 0) continue
    const t = totalsForLogs(mLogs, foodsById)
    meals.push({ meal: m, kcal: Math.round(t.kcal), protein: Math.round(t.protein) })
  }

  const waterMl = waterLogs.reduce((a, l) => a + l.ml, 0)
  const week = await gatherWeekNutrition(date)

  return {
    date,
    isTraining,
    totals,
    targets,
    meals,
    waterMl,
    waterTargetMl: settings.waterTargetMl ?? 2500,
    bodyweightKg: settings.bodyweightKg,
    week,
  }
}

/** Serialize a diet briefing into a compact, grounded prompt for Gemini. Pure. */
export function formatDietBriefing(b: DietBriefing): string {
  const gPerKg = b.bodyweightKg > 0 ? (b.totals.protein / b.bodyweightKg).toFixed(2) : '—'
  const lines: string[] = []
  lines.push(`Day: ${b.date} (${b.isTraining ? 'training' : 'rest'} day)`)
  lines.push(`Bodyweight: ${b.bodyweightKg} kg`)
  lines.push(`Calories: ${Math.round(b.totals.kcal)} / ${b.targets.kcal} kcal target`)
  lines.push(`Protein: ${Math.round(b.totals.protein)} / ${b.targets.protein} g (${gPerKg} g/kg)`)
  lines.push(`Carbs: ${Math.round(b.totals.carbs)} / ${b.targets.carbs} g`)
  lines.push(`Fat: ${Math.round(b.totals.fat)} / ${b.targets.fat} g`)
  lines.push(`Water: ${b.waterMl} / ${b.waterTargetMl} ml`)
  lines.push('')
  lines.push('Per meal:')
  if (b.meals.length === 0) lines.push('- (nothing logged by meal)')
  else for (const m of b.meals) lines.push(`- ${m.meal}: ${m.kcal} kcal, ${m.protein} g protein`)
  if (b.week) {
    lines.push('')
    lines.push('Last 7 days:')
    lines.push(`- Logged ${b.week.loggedDays}/7 days; ${b.week.trainingDays} training days`)
    lines.push(
      `- Averages: ${b.week.avgKcal} kcal, ${b.week.avgProtein} g protein (${b.week.proteinPerKg} g/kg), ${b.week.avgCarbs} g carbs, ${b.week.avgFat} g fat`,
    )
    lines.push(`- On-target (±10% kcal): ${b.week.adherent}/${b.week.loggedDays} logged days`)
  }
  return lines.join('\n')
}

/* ---------- F1: actionable macro suggestions (complete the day / swap a food) ---------- */

const MAX_CANDIDATES = 24

/** A real food the user tracks, offered to the model as a grounded suggestion
 * option. `ref` is String(food.id) so the model can echo it back statelessly. */
export interface CandidateFood {
  ref: string
  name: string
  brand?: string
  kcal100: number
  protein100: number
  carbs100: number
  fat100: number
  typicalGrams: number
}

/** Mirror of AddFoodSheet.defaultGrams: the portion to default a suggestion to. */
function typicalGramsFor(f: Food): number {
  return f.lastGrams ?? f.servingG ?? 100
}

/** Top foods the user actually eats (by frequency then recency), as grounded
 * candidates. `excludeId` drops the food being replaced in a substitution. */
function buildCandidates(foods: Food[], excludeId?: Id): CandidateFood[] {
  return foods
    .filter(f => f.id !== undefined && f.id !== excludeId)
    .slice()
    .sort((a, b) => (b.useCount ?? 0) - (a.useCount ?? 0) || (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0))
    .slice(0, MAX_CANDIDATES)
    .map(f => ({
      ref: String(f.id),
      name: f.name,
      brand: f.brand,
      kcal100: Math.round(f.kcal100),
      protein100: Math.round(f.protein100),
      carbs100: Math.round(f.carbs100),
      fat100: Math.round(f.fat100),
      typicalGrams: Math.round(typicalGramsFor(f)),
    }))
}

/** Training/rest resolution, mirroring DietDay: manual override else any session that day. */
async function isTrainingDay(date: string): Promise<boolean> {
  const override = await db.dayTypes.get(date)
  if (override) return override.type === 'training'
  const dayStartMs = parseLocalDate(date).getTime()
  const count = await db.sessions.where('startedAt').between(dayStartMs, dayStartMs + 86_400_000).count()
  return count > 0
}

const subtract = (t: DayTargets, c: MacroTotals): MacroTotals => ({
  kcal: t.kcal - c.kcal,
  protein: t.protein - c.protein,
  carbs: t.carbs - c.carbs,
  fat: t.fat - c.fat,
})

function mealBreakdown(logs: FoodLog[], foodsById: Map<Id, Food>) {
  const meals: { meal: MealType; kcal: number; protein: number }[] = []
  for (const m of MEAL_ORDER) {
    const mLogs = logs.filter(l => l.meal === m)
    if (mLogs.length === 0) continue
    const t = totalsForLogs(mLogs, foodsById)
    meals.push({ meal: m, kcal: Math.round(t.kcal), protein: Math.round(t.protein) })
  }
  return meals
}

/**
 * A coarse signature of the day's remaining macros, used to flag a cached
 * suggestion as stale once more food is logged. Bucketed so tiny float drift
 * doesn't churn it, but any real logged portion moves it.
 */
export function macroBasisSig(remaining: MacroTotals): string {
  const b = (v: number, step: number) => Math.round(v / step)
  return [b(remaining.kcal, 25), b(remaining.protein, 5), b(remaining.carbs, 5), b(remaining.fat, 5)].join('|')
}

function candidateLines(candidates: CandidateFood[]): string[] {
  const lines = ['Candidate foods (STRONGLY prefer these — reference by ref):']
  if (candidates.length === 0) {
    lines.push('- (none tracked yet — propose common foods with your best macro estimate)')
    return lines
  }
  for (const c of candidates) {
    const brand = c.brand ? ` [${c.brand}]` : ''
    lines.push(
      `- ${c.ref}) ${c.name}${brand} — per 100g: ${c.kcal100} kcal, ${c.protein100}P ${c.carbs100}C ${c.fat100}F; typical ${c.typicalGrams} g`,
    )
  }
  return lines
}

/** One day's state for completing the remaining macros. */
export interface MacroCompletionBriefing {
  date: string
  isTraining: boolean
  bodyweightKg: number
  totals: MacroTotals
  targets: DayTargets
  remaining: MacroTotals
  meals: { meal: MealType; kcal: number; protein: number }[]
  candidates: CandidateFood[]
}

/** Assemble the state for a "complete my macros" suggestion. Unlike the diet
 * report, this works on an empty day (remaining = full targets). Null only when
 * settings are missing. */
export async function gatherMacroCompletionBriefing(date: string): Promise<MacroCompletionBriefing | null> {
  const settings = await db.settings.get(1)
  if (!settings) return null
  const [foods, logs] = await Promise.all([
    db.foods.toArray(),
    db.foodLogs.where('date').equals(date).toArray(),
  ])
  const foodsById = new Map(foods.map(f => [f.id!, f]))
  const isTraining = await isTrainingDay(date)
  const totals = totalsForLogs(logs, foodsById)
  const targets = dayTargets(settings, isTraining)
  return {
    date,
    isTraining,
    bodyweightKg: settings.bodyweightKg,
    totals,
    targets,
    remaining: subtract(targets, totals),
    meals: mealBreakdown(logs, foodsById),
    candidates: buildCandidates(foods),
  }
}

/** Serialize a macro-completion briefing into a grounded prompt. Pure. */
export function formatMacroCompletionBriefing(b: MacroCompletionBriefing): string {
  const r = b.remaining
  const rl = (label: string, v: number, unit: string) =>
    `- ${label}: ${v > 0 ? `${Math.round(v)} ${unit} to go` : `met (${Math.round(-v)} ${unit} over)`}`
  const lines: string[] = []
  lines.push(`Day: ${b.date} (${b.isTraining ? 'training' : 'rest'} day), bodyweight ${b.bodyweightKg} kg`)
  lines.push(
    `Eaten so far: ${Math.round(b.totals.kcal)} kcal, ${Math.round(b.totals.protein)}g P, ${Math.round(b.totals.carbs)}g C, ${Math.round(b.totals.fat)}g F`,
  )
  lines.push('REMAINING today:')
  lines.push(rl('Calories', r.kcal, 'kcal'))
  lines.push(rl('Protein', r.protein, 'g'))
  lines.push(rl('Carbs', r.carbs, 'g'))
  lines.push(rl('Fat', r.fat, 'g'))
  if (b.meals.length > 0) {
    lines.push('Logged by meal: ' + b.meals.map(m => `${m.meal} ${m.kcal}kcal/${m.protein}gP`).join(', '))
  }
  lines.push('')
  lines.push(...candidateLines(b.candidates))
  return lines.join('\n')
}

/** State for swapping one logged food. */
export interface SubstitutionBriefing {
  date: string
  isTraining: boolean
  bodyweightKg: number
  current: {
    name: string
    brand?: string
    meal: MealType
    grams: number
    kcal: number
    protein: number
    carbs: number
    fat: number
  }
  remaining: MacroTotals
  candidates: CandidateFood[]
}

/** Assemble the state for a "suggest a swap" on a single logged food. Null when
 * the log or its food/settings are missing. */
export async function gatherSubstitutionBriefing(foodLogId: Id): Promise<SubstitutionBriefing | null> {
  const settings = await db.settings.get(1)
  if (!settings) return null
  const log = await db.foodLogs.get(foodLogId)
  if (!log) return null
  const [food, foods, logs] = await Promise.all([
    db.foods.get(log.foodId),
    db.foods.toArray(),
    db.foodLogs.where('date').equals(log.date).toArray(),
  ])
  if (!food) return null
  const foodsById = new Map(foods.map(f => [f.id!, f]))
  const isTraining = await isTrainingDay(log.date)
  const totals = totalsForLogs(logs, foodsById)
  const targets = dayTargets(settings, isTraining)
  const m = macrosFor(food, log.grams)
  return {
    date: log.date,
    isTraining,
    bodyweightKg: settings.bodyweightKg,
    current: {
      name: food.name,
      brand: food.brand,
      meal: log.meal,
      grams: log.grams,
      kcal: Math.round(m.kcal),
      protein: Math.round(m.protein),
      carbs: Math.round(m.carbs),
      fat: Math.round(m.fat),
    },
    remaining: subtract(targets, totals),
    candidates: buildCandidates(foods, log.foodId),
  }
}

/** Serialize a substitution briefing into a grounded prompt. Pure. */
export function formatSubstitutionBriefing(b: SubstitutionBriefing): string {
  const c = b.current
  const r = b.remaining
  const lines: string[] = []
  lines.push(`Day: ${b.date} (${b.isTraining ? 'training' : 'rest'} day), bodyweight ${b.bodyweightKg} kg`)
  lines.push(
    `Food to replace: ${c.name}${c.brand ? ` [${c.brand}]` : ''} — ${c.grams} g in ${c.meal}: ${c.kcal} kcal, ${c.protein}g P, ${c.carbs}g C, ${c.fat}g F`,
  )
  lines.push(
    `Remaining today: ${Math.round(r.kcal)} kcal, ${Math.round(r.protein)}g protein, ${Math.round(r.carbs)}g carbs, ${Math.round(r.fat)}g fat`,
  )
  lines.push('')
  lines.push(...candidateLines(b.candidates))
  return lines.join('\n')
}
