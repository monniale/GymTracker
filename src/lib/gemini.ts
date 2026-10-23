import type {
  CoachNote, CoachInsight, CoachInsightTone,
  MacroSuggestion, MacroSuggestionItem, MealEstimate, MealEstimateItem, MealType, PlannedSet,
} from '../types'
import { t } from '../i18n'
import { generateStructured, type GenerateOpts } from './ai/engine'
import type { InlineImage } from './ai/provider'
import {
  CATEGORIES, TONES, MEAL_ENUM, CONFIDENCE,
  COACH_NOTE_SCHEMA, WEIGHT_PLAN_SCHEMA, MACRO_SUGGESTION_SCHEMA, MEAL_ESTIMATE_SCHEMA,
} from './ai/schemas'

/**
 * The AI features: system prompts, response parsers and one `generate*` per
 * feature. The transport lives in src/lib/ai/ (engine + one module per
 * provider); this facade keeps the historical import path for every caller.
 */

export { AiError, type AiErrorKind, type AiModel, type AiProviderId, type InlineImage } from './ai/provider'
export { GeminiError, type GeminiErrorKind, fallbackModels, MAX_FALLBACKS, pickDefaultModel } from './ai/gemini'
export { ITALIAN_OUTPUT_LINE, localizedSystemPrompt, type GenerateOpts } from './ai/engine'

/**
 * List the Gemini models the given key can call with generateContent (validates
 * the key on Connect). Other providers: `(await PROVIDERS[id]()).listModels`.
 */
export { listModels } from './ai/gemini'

export const COACH_SYSTEM_PROMPT =
  `You are an experienced strength & hypertrophy coach reviewing ONE workout for a lifter who logs every set.
Judge the session using ONLY the numbers provided — never invent weights, reps, PRs, or exercises.
Ground your reasoning in established principles: progressive overload, weekly volume as the main hypertrophy driver, load/intensity specificity, and training consistency.
Be concise, specific, and encouraging but honest — a lighter day is variation, not a failure; never scold.
Return a short headline verdict (max ~8 words) plus 3–5 brief insights (each max ~24 words). Vary the categories across the insights.`

export const DIET_SYSTEM_PROMPT =
  `You are a sports-nutrition coach reviewing ONE day of eating for a lifter, in the context of their recent week.
Judge intake using ONLY the numbers provided — never invent foods or amounts.
Ground your reasoning in established principles: adequate protein for muscle (~1.6–2.2 g/kg bodyweight), calories relative to the day's target (training vs rest), a sensible carb/fat split, protein spread across meals, and hydration.
Be concise, specific, and encouraging but honest — one off day is not a failure; never shame the user about food.
Prefer the diet categories (calories, protein, macros, hydration, consistency, verdict).
Return a short headline verdict (max ~8 words) plus 3–5 brief insights (each max ~24 words).`

export const WEEK_SYSTEM_PROMPT =
  `You are a strength & nutrition coach reviewing ONE whole week (Monday to Sunday) for a lifter who logs workouts, food and bodyweight.
Judge the week using ONLY the numbers provided — never invent sessions, weights, PRs, foods or weigh-ins.
Ground your reasoning in established principles: training consistency vs the weekly target, weekly hard sets per muscle (~10–20 for hypertrophy), progressive overload, protein ~1.6–2.2 g/kg, calories vs target, and the bodyweight trend relative to the goal implied by the numbers.
Be concise, specific, and encouraging but honest — a light week is not a failure; never scold or shame.
Use the 'verdict' category for the overall judgement; any category fits the rest.
Return a short headline verdict (max ~8 words) plus 4–6 brief insights (each max ~24 words); the last 2–3 must be concrete actions for next week.`

/** Ask the AI to judge a workout, returning a validated CoachNote. */
export function generateCoachNote(prompt: string, opts: GenerateOpts): Promise<CoachNote> {
  return generateStructured(prompt, COACH_SYSTEM_PROMPT, { schema: COACH_NOTE_SCHEMA, parse: parseCoachNote }, opts)
}

/** Ask the AI to judge a day of eating, returning a validated CoachNote. */
export function generateDietNote(prompt: string, opts: GenerateOpts): Promise<CoachNote> {
  return generateStructured(prompt, DIET_SYSTEM_PROMPT, { schema: COACH_NOTE_SCHEMA, parse: parseCoachNote }, opts)
}

/** Ask the AI to review a whole week and set next week's focus, returning a validated CoachNote. */
export function generateWeekNote(prompt: string, opts: GenerateOpts): Promise<CoachNote> {
  return generateStructured(prompt, WEEK_SYSTEM_PROMPT, { schema: COACH_NOTE_SCHEMA, parse: parseCoachNote }, opts)
}

/**
 * Parse and sanitize Gemini JSON into a CoachNote. Because it is user-facing,
 * it degrades gracefully: invalid JSON becomes a single-insight note rather
 * than throwing, and unknown enum values are coerced to safe defaults.
 */
export function parseCoachNote(text: string): CoachNote {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    // Truncated/invalid JSON (e.g. the model ran out of tokens mid-object):
    // salvage the headline and any complete messages instead of dumping raw JSON.
    return salvageCoachNote(text)
  }
  const p = (parsed ?? {}) as Partial<CoachNote>
  const insights: CoachInsight[] = Array.isArray(p.insights)
    ? p.insights
        .filter((i): i is CoachInsight => !!i && typeof i.message === 'string' && i.message.trim().length > 0)
        .map(i => ({
          category: CATEGORIES.includes(i.category) ? i.category : 'verdict',
          tone: TONES.includes(i.tone) ? i.tone : 'neutral',
          message: String(i.message).trim(),
        }))
    : []
  return {
    headline: typeof p.headline === 'string' && p.headline.trim() ? p.headline.trim() : t('ai.note.defaultHeadline'),
    tone: TONES.includes(p.tone as CoachInsightTone) ? (p.tone as CoachInsightTone) : 'neutral',
    insights,
  }
}

/** Unescape a raw JSON string body (the capture between the quotes). */
function jsonUnescape(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`) as string
  } catch {
    return raw
  }
}

/** Recover a usable note from truncated/invalid JSON by regex-extracting the
 * headline and any complete "message" strings, rather than showing raw JSON. */
function salvageCoachNote(text: string): CoachNote {
  const h = text.match(/"headline"\s*:\s*"((?:[^"\\]|\\.)*)"/)
  const headline = h ? jsonUnescape(h[1]) : t('ai.note.defaultHeadline')
  const messages = [...text.matchAll(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/g)]
    .map(m => jsonUnescape(m[1]))
    .filter(msg => msg.trim().length > 0)
  const insights: CoachInsight[] = messages.length
    ? messages.map(message => ({ category: 'verdict', tone: 'neutral', message }))
    : [{ category: 'verdict', tone: 'neutral', message: t('ai.note.cutOff') }]
  return { headline, tone: 'neutral', insights }
}

/* ---------- F2: pre-workout weight/rep plan ---------- */

/** One exercise's opening plan as returned by the model, keyed by the "ref"
 * (a stringified exerciseId) supplied in the briefing. */
export interface RawExercisePlan {
  ref: string
  sets: PlannedSet[]
  note?: string
}
export interface RawWorkoutPlan {
  plan: RawExercisePlan[]
}

export const WORKOUT_PLAN_SYSTEM_PROMPT =
  `You are a strength & hypertrophy coach setting the OPENING weights and reps for TODAY's workout, for a lifter who logs every set.
Use ONLY the numbers provided — never invent history. Each exercise lists its target sets×reps, last session's work sets, and a deterministic progression baseline ("baseline: …") the app computed.
For EACH exercise, output a weight (kg) and reps for every target set, keyed by that exercise's "ref".
Anchor on the baseline: match it or make a small, sensible progressive-overload step from last time — never jump more than ~5–10% in one session, and stay within the lifter's demonstrated range. Respect the target rep range (a top set may sit at the low end, back-off sets slightly lighter or higher-rep).
Round every weight to a loadable increment (multiples of 2.5 kg). If an exercise has no history and no baseline, repeat the target reps at weight 0 (unknown) rather than guessing a load.
Return one plan entry per exercise ref. Do not add exercises that were not listed.`

/** Parse a weight plan. On invalid/truncated JSON it returns an empty plan so
 * the caller silently falls back to the offline progression engine. A negative
 * weight is kept (assisted bodyweight move); the caller clamps it per exercise
 * (`snapWeight`), so it reaches only a bodyweight exercise. */
export function parseWeightPlan(text: string): RawWorkoutPlan {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { plan: [] }
  }
  const rawPlan = (parsed as { plan?: unknown })?.plan
  if (!Array.isArray(rawPlan)) return { plan: [] }
  const plan: RawExercisePlan[] = []
  for (const entry of rawPlan) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    if (typeof e.ref !== 'string' || !Array.isArray(e.sets)) continue
    const sets: PlannedSet[] = []
    for (const s of e.sets) {
      const w = Number((s as Record<string, unknown>)?.weightKg)
      const r = Number((s as Record<string, unknown>)?.reps)
      if (Number.isFinite(w) && Number.isFinite(r) && r > 0) {
        sets.push({ weightKg: w, reps: Math.round(r) })
      }
    }
    if (sets.length === 0) continue
    plan.push({ ref: e.ref, sets, note: typeof e.note === 'string' ? e.note : undefined })
  }
  return { plan }
}

/** Ask the AI for opening weights/reps for the whole session (raw refs). */
export function generateWeightPlan(prompt: string, opts: GenerateOpts): Promise<RawWorkoutPlan> {
  return generateStructured(prompt, WORKOUT_PLAN_SYSTEM_PROMPT, { schema: WEIGHT_PLAN_SCHEMA, parse: parseWeightPlan }, opts)
}

/* ---------- F1: diet macro suggestions (complete the day / swap a food) ---------- */

export const MACRO_COMPLETE_SYSTEM_PROMPT =
  `You are a sports-nutrition coach helping a lifter finish TODAY's macros. Use ONLY the numbers provided.
You are given the macros still REMAINING for the day (target − eaten) and a list of foods the lifter already eats ("candidates"), each with a ref and per-100g macros.
Suggest a short list (2–4) of specific foods and gram portions that together close most of the remaining PROTEIN and calories without pushing any target far over.
STRONGLY prefer candidate foods: reference them by their exact "ref" and reuse realistic portions. Only propose a food that is NOT a candidate when nothing fits — then leave "ref" empty and give your best per-portion macro estimate.
For each item give: food name, brand (if any), the meal it best fits, grams, and the resulting kcal/protein/carbs/fat FOR THAT PORTION (compute from the per-100g values — never invent numbers). Add a one-line reason.
Give a short, encouraging headline (max ~8 words). Never shame the user.`

export const MACRO_SUBSTITUTE_SYSTEM_PROMPT =
  `You are a sports-nutrition coach suggesting a SWAP for one logged food. Use ONLY the numbers provided.
You are given the food to replace (its portion and macros), the macros REMAINING for the day, and candidate foods the lifter already eats (with refs and per-100g macros).
Suggest 1–3 alternative foods+portions that fit the same meal but improve the macro fit for what's remaining (e.g. more protein, fewer calories), or are simply a sensible variety swap.
STRONGLY prefer candidate foods (reference by "ref"); only propose a non-candidate when nothing fits — then leave "ref" empty and estimate per-portion macros.
For each: food, brand (if any), the meal (keep the original's meal), grams, and the resulting kcal/protein/carbs/fat for that portion (from per-100g values — never invent). One-line reason. Short headline.`

function cleanMacroItem(raw: unknown): MacroSuggestionItem | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const food = typeof r.food === 'string' ? r.food.trim() : ''
  const grams = Number(r.grams)
  if (!food || !Number.isFinite(grams) || grams <= 0) return null
  const nn = (v: unknown) => {
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? n : 0
  }
  return {
    ref: typeof r.ref === 'string' && r.ref.trim() ? r.ref.trim() : undefined,
    food,
    brand: typeof r.brand === 'string' && r.brand.trim() ? r.brand.trim() : undefined,
    meal: MEAL_ENUM.includes(r.meal as MealType) ? (r.meal as MealType) : 'snack',
    grams: Math.round(grams),
    kcal: Math.round(nn(r.kcal)),
    protein: Math.round(nn(r.protein)),
    carbs: Math.round(nn(r.carbs)),
    fat: Math.round(nn(r.fat)),
    reason: typeof r.reason === 'string' && r.reason.trim() ? r.reason.trim() : undefined,
  }
}

/** Parse a macro suggestion, degrading gracefully on invalid/truncated JSON. */
export function parseMacroSuggestion(text: string): MacroSuggestion {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    const h = text.match(/"headline"\s*:\s*"((?:[^"\\]|\\.)*)"/)
    return { headline: h ? jsonUnescape(h[1]) : t('ai.macro.cutOff'), items: [] }
  }
  const p = (parsed ?? {}) as Partial<MacroSuggestion>
  const items = Array.isArray(p.items)
    ? p.items.map(cleanMacroItem).filter((i): i is MacroSuggestionItem => i !== null)
    : []
  return {
    headline: typeof p.headline === 'string' && p.headline.trim() ? p.headline.trim() : t('ai.macro.defaultHeadline'),
    items,
  }
}

/** Ask the AI for foods+portions to complete the day's remaining macros. */
export function generateMacroSuggestion(prompt: string, opts: GenerateOpts): Promise<MacroSuggestion> {
  return generateStructured(prompt, MACRO_COMPLETE_SYSTEM_PROMPT, { schema: MACRO_SUGGESTION_SCHEMA, parse: parseMacroSuggestion }, opts)
}

/** Ask the AI for swap alternatives to a single logged food. */
export function generateSubstitution(prompt: string, opts: GenerateOpts): Promise<MacroSuggestion> {
  return generateStructured(prompt, MACRO_SUBSTITUTE_SYSTEM_PROMPT, { schema: MACRO_SUGGESTION_SCHEMA, parse: parseMacroSuggestion }, opts)
}

/* ---------- Meal estimate (takeaway food with no label) ---------- */

export const MEAL_ESTIMATE_SYSTEM_PROMPT =
  `You are a nutritionist estimating a meal from a small takeaway, kebab shop, pizzeria or street-food stand: no label, no chain data.
You get the user's description and maybe a photo. Split the meal into its components (e.g. bun, patty, cheese, bacon, sauce, fries, drink) and estimate each one's eaten weight in grams from realistic portion sizes for that kind of place (independent shops usually serve bigger and fattier portions than chains; fried food absorbs oil).
For each component give per-100 g kcal, protein, carbs and fat, consistent with kcal ≈ 4·protein + 4·carbs + 9·fat, and a short note with the assumption (size, cooking).
Return a short headline summarising the main assumptions (max ~14 words) and a confidence: high only when the description/photo pins down portions, low when guessing.
Never refuse: always give your best estimate. Never moralise about the food.`

function cleanEstimateItem(raw: unknown): MealEstimateItem | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const name = typeof r.name === 'string' ? r.name.trim() : ''
  const grams = Number(r.grams)
  if (!name || !Number.isFinite(grams) || grams <= 0) return null
  const nn = (v: unknown, max: number) => {
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0
  }
  const protein100 = Math.round(nn(r.protein100, 100) * 10) / 10
  const carbs100 = Math.round(nn(r.carbs100, 100) * 10) / 10
  const fat100 = Math.round(nn(r.fat100, 100) * 10) / 10
  let kcal100 = Math.round(nn(r.kcal100, 900))
  // Trust the macros over a kcal figure that disagrees with them by more than a quarter.
  const fromMacros = 4 * protein100 + 4 * carbs100 + 9 * fat100
  if (fromMacros > 0 && Math.abs(kcal100 - fromMacros) > 0.25 * fromMacros) kcal100 = Math.round(fromMacros)
  return {
    name,
    grams: Math.round(Math.min(grams, 2000)),
    kcal100, protein100, carbs100, fat100,
    note: typeof r.note === 'string' && r.note.trim() ? r.note.trim() : undefined,
  }
}

/** Parse a meal estimate, degrading gracefully on invalid/truncated JSON (never throws). */
export function parseMealEstimate(text: string): MealEstimate {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    const h = text.match(/"headline"\s*:\s*"((?:[^"\\]|\\.)*)"/)
    return { headline: h ? jsonUnescape(h[1]) : t('ai.macro.cutOff'), confidence: 'low', items: [] }
  }
  const p = (parsed ?? {}) as Partial<MealEstimate>
  return {
    headline: typeof p.headline === 'string' ? p.headline.trim() : '',
    confidence: CONFIDENCE.includes(p.confidence as MealEstimate['confidence']) ? p.confidence! : 'low',
    items: Array.isArray(p.items) ? p.items.map(cleanEstimateItem).filter((i): i is MealEstimateItem => i !== null) : [],
  }
}

/** Ask the AI to break a described (and optionally photographed) meal into items with macros. */
export function generateMealEstimate(description: string, image: InlineImage | null, opts: GenerateOpts): Promise<MealEstimate> {
  const prompt = description.trim()
    ? `Meal: ${description.trim()}`
    : 'Meal: see the photo (no description given).'
  return generateStructured(prompt, MEAL_ESTIMATE_SYSTEM_PROMPT, {
    schema: MEAL_ESTIMATE_SCHEMA,
    parse: parseMealEstimate,
    temperature: 0.3,
    images: image ? [image] : undefined,
  }, opts)
}
