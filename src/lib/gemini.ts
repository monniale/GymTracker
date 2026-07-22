import type { CoachNote, CoachInsight, CoachInsightCategory, CoachInsightTone } from '../types'

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

/** Shared engine: ask Gemini for a structured note under a given system prompt. */
async function generateStructuredNote(
  prompt: string,
  systemPrompt: string,
  opts: GenerateOpts,
): Promise<CoachNote> {
  const data = await post(
    {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.6,
        // Gemini 2.5/3 Flash count "thinking" tokens against maxOutputTokens and
        // think by default; with structured output that starves the JSON and
        // truncates it. Disable thinking for this short, well-specified task and
        // keep a generous cap as a safety margin.
        thinkingConfig: { thinkingBudget: 0 },
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
        responseSchema: COACH_NOTE_SCHEMA,
      },
    },
    opts,
  )
  const cand = data.candidates?.[0]
  const finish = cand?.finishReason
  if (finish && finish !== 'STOP' && finish !== 'MAX_TOKENS') {
    throw new GeminiError('Gemini could not generate a note — try again.', 'blocked', 200)
  }
  const text = (cand?.content?.parts ?? []).map(p => p.text ?? '').join('')
  if (!text.trim()) throw new GeminiError('Gemini returned an empty response — try again.', 'other', 200)
  return parseCoachNote(text)
}

/** Ask Gemini to judge a workout, returning a validated CoachNote. */
export function generateCoachNote(prompt: string, opts: GenerateOpts): Promise<CoachNote> {
  return generateStructuredNote(prompt, COACH_SYSTEM_PROMPT, opts)
}

/** Ask Gemini to judge a day of eating, returning a validated CoachNote. */
export function generateDietNote(prompt: string, opts: GenerateOpts): Promise<CoachNote> {
  return generateStructuredNote(prompt, DIET_SYSTEM_PROMPT, opts)
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
