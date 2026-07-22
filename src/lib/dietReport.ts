import { db } from '../db/db'
import { addDays, parseLocalDate, localDateStr } from './dates'
import { totalsForLogs, dayTargets, type MacroTotals, type DayTargets } from './nutrition'
import type { MealType } from '../types'

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
