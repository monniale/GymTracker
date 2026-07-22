import type {
  CoachNote, CoachInsight, CoachInsightCategory, CoachInsightTone,
  MacroSuggestion, MacroSuggestionItem, MealType, PlannedSet,
} from '../types'

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
    status === 400 ? 'bad-key'
      : status === 401 || status === 403 ? 'auth'
        : status === 429 ? 'rate-limit'
          : 'other'
  return new GeminiError(detail || `Gemini request failed (${status})`, kind, status)
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

export interface GenerateOpts {
  apiKey: string
  model: string
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
    throw new GeminiError('Network unreachable — check your connection.', 'network')
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

/** How to shape and parse one structured Gemini call. */
interface StructuredConfig<T> {
  schema: object
  parse: (text: string) => T
  maxOutputTokens?: number
  temperature?: number
}

/**
 * Shared engine: ask Gemini for a structured JSON payload under a given system
 * prompt and response schema, and parse it with the caller's parser. Generic
 * over the payload type so every AI feature (coach note, diet note, weight plan,
 * macro suggestion) reuses the transport, error mapping and the mandatory
 * thinking-disabled config with zero duplication.
 */
async function generateStructured<T>(
  prompt: string,
  systemPrompt: string,
  config: StructuredConfig<T>,
  opts: GenerateOpts,
): Promise<T> {
  const data = await post(
    {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
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
    },
    opts,
  )
  const cand = data.candidates?.[0]
  const finish = cand?.finishReason
  if (finish && finish !== 'STOP' && finish !== 'MAX_TOKENS') {
    throw new GeminiError('Gemini could not generate a response — try again.', 'blocked', 200)
  }
  const text = (cand?.content?.parts ?? []).map(p => p.text ?? '').join('')
  if (!text.trim()) throw new GeminiError('Gemini returned an empty response — try again.', 'other', 200)
  return config.parse(text)
}

/** Ask Gemini to judge a workout, returning a validated CoachNote. */
export function generateCoachNote(prompt: string, opts: GenerateOpts): Promise<CoachNote> {
  return generateStructured(prompt, COACH_SYSTEM_PROMPT, { schema: COACH_NOTE_SCHEMA, parse: parseCoachNote }, opts)
}

/** Ask Gemini to judge a day of eating, returning a validated CoachNote. */
export function generateDietNote(prompt: string, opts: GenerateOpts): Promise<CoachNote> {
  return generateStructured(prompt, DIET_SYSTEM_PROMPT, { schema: COACH_NOTE_SCHEMA, parse: parseCoachNote }, opts)
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
    headline: typeof p.headline === 'string' && p.headline.trim() ? p.headline.trim() : 'Session reviewed',
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
  const headline = h ? jsonUnescape(h[1]) : 'Session reviewed'
  const messages = [...text.matchAll(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/g)]
    .map(m => jsonUnescape(m[1]))
    .filter(msg => msg.trim().length > 0)
  const insights: CoachInsight[] = messages.length
    ? messages.map(message => ({ category: 'verdict', tone: 'neutral', message }))
    : [{ category: 'verdict', tone: 'neutral', message: 'The coach note was cut off — tap Regenerate.' }]
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
    return { headline: h ? jsonUnescape(h[1]) : 'The suggestion was cut off — tap Regenerate.', items: [] }
  }
  const p = (parsed ?? {}) as Partial<MacroSuggestion>
  const items = Array.isArray(p.items)
    ? p.items.map(cleanMacroItem).filter((i): i is MacroSuggestionItem => i !== null)
    : []
  return {
    headline: typeof p.headline === 'string' && p.headline.trim() ? p.headline.trim() : 'Ideas to finish your day',
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
    throw new GeminiError('Network unreachable — check your connection.', 'network')
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
