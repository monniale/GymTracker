import type {
  CoachNote, CoachInsight, CoachInsightCategory, CoachInsightTone,
  MacroSuggestion, MacroSuggestionItem, MealEstimate, MealEstimateItem, MealType, PlannedSet,
} from '../types'
import { t } from '../i18n'
import { getLang, type Lang } from './uiStore'

/**
 * Minimal Gemini client for the AI workout coach. Runs directly from the
 * browser (no backend): the generateContent endpoint is CORS-open, and the
 * user's own free-tier key is sent from this device — the same trust model as
 * the GitHub sync PAT. Error handling mirrors githubApi.ts `gh()`.
 */

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'

export type GeminiErrorKind =
  | 'auth' | 'bad-key' | 'rate-limit' | 'network' | 'blocked' | 'other'

export class GeminiError extends Error {
  constructor(
    message: string,
    readonly kind: GeminiErrorKind,
    readonly status = 0,
  ) {
    super(message)
    this.name = 'GeminiError'
  }
}

const CATEGORIES: CoachInsightCategory[] = [
  // workout categories
  'verdict', 'pr', 'progression', 'balance', 'intensity', 'consistency', 'milestone',
  // diet categories
  'calories', 'protein', 'macros', 'hydration',
]
const TONES: CoachInsightTone[] = ['celebratory', 'positive', 'neutral', 'warning']

/** A generateContent-capable model available to the user's key. */
export interface AiModel {
  id: string
  label: string
}

function mapHttpError(status: number, detail: string): GeminiError {
  const kind: GeminiErrorKind =
    // 400 is also INVALID_ARGUMENT for a model that rejects the request shape (e.g. a
    // thinking-only model refusing thinkingBudget 0): only a key problem is 'bad-key'.
    status === 400 ? (!detail || /api.?key/i.test(detail) ? 'bad-key' : 'other')
      : status === 401 || status === 403 ? 'auth'
        : status === 429 ? 'rate-limit'
          : 'other'
  return new GeminiError(
    detail ? t('ai.gemini.requestFailedDetail', { detail }) : t('ai.gemini.requestFailed', { status }),
    kind,
    status,
  )
}

/** Gemini structured-output schema (OpenAPI subset) mirroring CoachNote. */
const COACH_NOTE_SCHEMA = {
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

export interface GenerateOpts {
  apiKey: string
  model: string
  /** Free models tried in order when `model` fails with a retryable error (see `fallbackModels`). */
  fallbacks?: string[]
  /** Told which model actually answered: `model` or one of the fallbacks. */
  onModel?: (model: string) => void
  signal?: AbortSignal
}

interface GeminiResponse {
  candidates?: Array<{
    finishReason?: string
    content?: { parts?: Array<{ text?: string }> }
  }>
}

async function post(body: unknown, opts: GenerateOpts): Promise<GeminiResponse> {
  const url = `${ENDPOINT}/${encodeURIComponent(opts.model)}:generateContent`
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      signal: opts.signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': opts.apiKey },
      body: JSON.stringify(body),
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new GeminiError(t('ai.gemini.network'), 'network')
  }
  if (!res.ok) {
    throw mapHttpError(res.status, await errorDetail(res))
  }
  return (await res.json()) as GeminiResponse
}

async function errorDetail(res: Response): Promise<string> {
  try {
    const err = (await res.json()) as { error?: { message?: string } }
    return err?.error?.message ?? ''
  } catch {
    return ''
  }
}

/**
 * Appended to every system prompt while the UI is Italian, so the prose the user reads comes back
 * in Italian. The briefings, JSON keys and enum values stay English (the schema fixes the enums).
 */
export const ITALIAN_OUTPUT_LINE =
  'Write every user-facing text (headline, messages, reasons, names you invent) in Italian.'

/** The system prompt for the UI language `lang`. */
export function localizedSystemPrompt(systemPrompt: string, lang: Lang = getLang()): string {
  return lang === 'it' ? `${systemPrompt}\n${ITALIAN_OUTPUT_LINE}` : systemPrompt
}

/** How to shape and parse one structured Gemini call. */
interface StructuredConfig<T> {
  schema: object
  parse: (text: string) => T
  maxOutputTokens?: number
  temperature?: number
  /** Images sent after the prompt text (base64, no data: prefix). */
  images?: InlineImage[]
}

/** An image part for a multimodal request (the free Flash models accept them). */
export interface InlineImage {
  mimeType: string
  data: string
}

/**
 * Shared engine: ask Gemini for a structured JSON payload under a given system
 * prompt and response schema, and parse it with the caller's parser. Generic
 * over the payload type so every AI feature (coach note, diet note, weight plan,
 * macro suggestion) reuses the transport, error mapping, the model fallback
 * chain and the mandatory thinking-disabled config with zero duplication. The
 * system prompt gets `ITALIAN_OUTPUT_LINE` while the UI is Italian.
 *
 * If the chosen model fails with a retryable error, the same request goes to
 * each of `opts.fallbacks` in turn. When every model fails, the error thrown is
 * a quota error if any model hit one (the actionable story), else the chosen
 * model's own error.
 */
async function generateStructured<T>(
  prompt: string,
  systemPrompt: string,
  config: StructuredConfig<T>,
  opts: GenerateOpts,
): Promise<T> {
  const body = {
    systemInstruction: { parts: [{ text: localizedSystemPrompt(systemPrompt) }] },
    contents: [{
      role: 'user',
      parts: [{ text: prompt }, ...(config.images ?? []).map(img => ({ inlineData: { mimeType: img.mimeType, data: img.data } }))],
    }],
    generationConfig: {
      temperature: config.temperature ?? 0.6,
      // Gemini 2.5/3 Flash count "thinking" tokens against maxOutputTokens and
      // think by default; with structured output that starves the JSON and
      // truncates it. Disable thinking for these short, well-specified tasks
      // and keep a generous cap as a safety margin.
      thinkingConfig: { thinkingBudget: 0 },
      maxOutputTokens: config.maxOutputTokens ?? 2048,
      responseMimeType: 'application/json',
      responseSchema: config.schema,
    },
  }
  const chain = [...new Set([opts.model, ...(opts.fallbacks ?? [])].filter(Boolean))]
  const errors: unknown[] = []
  for (const [i, model] of chain.entries()) {
    try {
      const value = await generateOnce(body, config.parse, { ...opts, model })
      opts.onModel?.(model)
      return value
    } catch (e) {
      // The chosen model got past the key check, so a fallback's own auth error is about that model only.
      const modelAuth = i > 0 && e instanceof GeminiError && (e.kind === 'auth' || e.kind === 'bad-key')
      if (!isRetryable(e) && !modelAuth) throw e
      errors.push(e)
    }
  }
  throw errors.find(e => e instanceof GeminiError && e.kind === 'rate-limit') ?? errors[0]
}

async function generateOnce<T>(body: unknown, parse: (text: string) => T, opts: GenerateOpts): Promise<T> {
  const data = await post(body, opts)
  const cand = data.candidates?.[0]
  const finish = cand?.finishReason
  if (finish && finish !== 'STOP' && finish !== 'MAX_TOKENS') {
    throw new GeminiError(t('ai.gemini.blocked'), 'blocked', 200)
  }
  const text = (cand?.content?.parts ?? []).map(p => p.text ?? '').join('')
  if (!text.trim()) throw new GeminiError(t('ai.gemini.empty'), 'other', 200)
  return parse(text)
}

/**
 * Failures another model may not share: a per-model free quota, an overloaded or
 * retired model, a request shape the model rejects, an empty/blocked/unparseable
 * answer. A rejected key, a permission problem or no network fails the same way
 * on every model, and an abort is the caller's choice — those never fall back.
 */
function isRetryable(e: unknown): boolean {
  if ((e as Error)?.name === 'AbortError') return false
  if (e instanceof GeminiError) return e.kind === 'rate-limit' || e.kind === 'blocked' || e.kind === 'other'
  return true // the parser rejected a malformed answer
}

/** Ask Gemini to judge a workout, returning a validated CoachNote. */
export function generateCoachNote(prompt: string, opts: GenerateOpts): Promise<CoachNote> {
  return generateStructured(prompt, COACH_SYSTEM_PROMPT, { schema: COACH_NOTE_SCHEMA, parse: parseCoachNote }, opts)
}

/** Ask Gemini to judge a day of eating, returning a validated CoachNote. */
export function generateDietNote(prompt: string, opts: GenerateOpts): Promise<CoachNote> {
  return generateStructured(prompt, DIET_SYSTEM_PROMPT, { schema: COACH_NOTE_SCHEMA, parse: parseCoachNote }, opts)
}

/** Ask Gemini to review a whole week and set next week's focus, returning a validated CoachNote. */
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

const WEIGHT_PLAN_SCHEMA = {
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

export const WORKOUT_PLAN_SYSTEM_PROMPT =
  `You are a strength & hypertrophy coach setting the OPENING weights and reps for TODAY's workout, for a lifter who logs every set.
Use ONLY the numbers provided — never invent history. Each exercise lists its target sets×reps, last session's work sets, and a deterministic progression baseline ("baseline: …") the app computed.
For EACH exercise, output a weight (kg) and reps for every target set, keyed by that exercise's "ref".
Anchor on the baseline: match it or make a small, sensible progressive-overload step from last time — never jump more than ~5–10% in one session, and stay within the lifter's demonstrated range. Respect the target rep range (a top set may sit at the low end, back-off sets slightly lighter or higher-rep).
Round every weight to a loadable increment (multiples of 2.5 kg). If an exercise has no history and no baseline, repeat the target reps at weight 0 (unknown) rather than guessing a load.
Return one plan entry per exercise ref. Do not add exercises that were not listed.`

/** Parse a weight plan. On invalid/truncated JSON it returns an empty plan so
 * the caller silently falls back to the offline progression engine. */
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
      if (Number.isFinite(w) && w >= 0 && Number.isFinite(r) && r > 0) {
        sets.push({ weightKg: w, reps: Math.round(r) })
      }
    }
    if (sets.length === 0) continue
    plan.push({ ref: e.ref, sets, note: typeof e.note === 'string' ? e.note : undefined })
  }
  return { plan }
}

/** Ask Gemini for opening weights/reps for the whole session (raw refs). */
export function generateWeightPlan(prompt: string, opts: GenerateOpts): Promise<RawWorkoutPlan> {
  return generateStructured(prompt, WORKOUT_PLAN_SYSTEM_PROMPT, { schema: WEIGHT_PLAN_SCHEMA, parse: parseWeightPlan }, opts)
}

/* ---------- F1: diet macro suggestions (complete the day / swap a food) ---------- */

const MEAL_ENUM: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack']

const MACRO_SUGGESTION_SCHEMA = {
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

/** Ask Gemini for foods+portions to complete the day's remaining macros. */
export function generateMacroSuggestion(prompt: string, opts: GenerateOpts): Promise<MacroSuggestion> {
  return generateStructured(prompt, MACRO_COMPLETE_SYSTEM_PROMPT, { schema: MACRO_SUGGESTION_SCHEMA, parse: parseMacroSuggestion }, opts)
}

/** Ask Gemini for swap alternatives to a single logged food. */
export function generateSubstitution(prompt: string, opts: GenerateOpts): Promise<MacroSuggestion> {
  return generateStructured(prompt, MACRO_SUBSTITUTE_SYSTEM_PROMPT, { schema: MACRO_SUGGESTION_SCHEMA, parse: parseMacroSuggestion }, opts)
}

/* ---------- Meal estimate (takeaway food with no label) ---------- */

const CONFIDENCE: MealEstimate['confidence'][] = ['low', 'medium', 'high']

const MEAL_ESTIMATE_SCHEMA = {
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

/** Ask Gemini to break a described (and optionally photographed) meal into items with macros. */
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

interface RawModel {
  name: string
  displayName?: string
  supportedGenerationMethods?: string[]
}

/** Sort key: stable Flash first, then Flash-Lite, then Pro, previews/experimental last. */
function modelRank(id: string): number {
  const s = id.toLowerCase()
  const preview = /preview|exp|thinking|image|tts|live|vision|-8b|latest/.test(s)
  if (/flash/.test(s) && !/lite/.test(s) && !preview) return 0
  if (/flash-lite/.test(s) && !preview) return 1
  if (/pro/.test(s) && !preview) return 2
  if (/flash/.test(s)) return 3
  if (/pro/.test(s)) return 4
  return 5
}

/**
 * List the Gemini models the given key can call with generateContent. Used on
 * Connect: it both validates the key (401/400 → typed error) AND discovers
 * which models are actually available to THIS key/tier — so a model being
 * retired for new free-tier users can never hard-code us into a broken state.
 */
export async function listModels(apiKey: string, signal?: AbortSignal): Promise<AiModel[]> {
  let res: Response
  try {
    res = await fetch(`${ENDPOINT}?pageSize=1000`, { signal, headers: { 'x-goog-api-key': apiKey } })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new GeminiError(t('ai.gemini.network'), 'network')
  }
  if (!res.ok) throw mapHttpError(res.status, await errorDetail(res))
  const data = (await res.json()) as { models?: RawModel[] }
  return (data.models ?? [])
    .filter(m => (m.supportedGenerationMethods ?? []).includes('generateContent'))
    .filter(m => m.name.startsWith('models/gemini-'))
    .map(m => {
      const id = m.name.replace(/^models\//, '')
      return { id, label: m.displayName || id }
    })
    .sort((a, b) => modelRank(a.id) - modelRank(b.id) || a.id.localeCompare(b.id))
}

/** Best default from an available-model list (the list is already rank-sorted). */
export function pickDefaultModel(models: AiModel[]): string {
  return models[0]?.id ?? ''
}

/** Most free-fallback attempts after the chosen model, so a failing call stays quick. */
export const MAX_FALLBACKS = 3

/** Free-tier aliases to try when the key's model list is unknown. */
const FREE_ALIASES = ['gemini-flash-latest', 'gemini-flash-lite-latest']

/** Variants that can't answer a plain JSON text request. */
const NON_TEXT = /image|tts|audio|live|native|embed|robotics|computer|thinking|-8b/

function modelVersion(id: string): number {
  const m = /gemini-(\d+(?:\.\d+)?)/.exec(id)
  return m ? parseFloat(m[1]) : 0
}

/**
 * The models to fall back on when `primary` fails: the key's other Flash and
 * Flash-Lite models — free on the Gemini free tier (a key with billing on pays
 * their low Flash price); Pro is left out so a fallback never costs Pro prices —
 * stable before preview, newest
 * version first, at most MAX_FALLBACKS. Free-tier quotas are per model, so a 429
 * on one model usually leaves the others open.
 */
export function fallbackModels(models: AiModel[], primary: string): string[] {
  const ids = models.length > 0 ? models.map(m => m.id) : FREE_ALIASES
  return [...new Set(ids)]
    .filter(id => id !== primary && /flash/i.test(id) && !NON_TEXT.test(id.toLowerCase()))
    .sort((a, b) => modelRank(a) - modelRank(b) || modelVersion(b) - modelVersion(a) || a.localeCompare(b))
    .slice(0, MAX_FALLBACKS)
}
