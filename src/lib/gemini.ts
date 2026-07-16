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

const CATEGORIES: CoachInsightCategory[] =
  ['verdict', 'pr', 'progression', 'balance', 'intensity', 'consistency', 'milestone']
const TONES: CoachInsightTone[] = ['celebratory', 'positive', 'neutral', 'warning']

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
    let detail = ''
    try {
      const err = (await res.json()) as { error?: { message?: string } }
      detail = err?.error?.message ?? ''
    } catch {
      /* non-JSON error body */
    }
    const kind: GeminiErrorKind =
      res.status === 400 ? 'bad-key'
        : res.status === 401 || res.status === 403 ? 'auth'
          : res.status === 429 ? 'rate-limit'
            : 'other'
    throw new GeminiError(detail || `Gemini request failed (${res.status})`, kind, res.status)
  }
  return (await res.json()) as GeminiResponse
}

/** Ask Gemini to judge a workout, returning a validated CoachNote. */
export async function generateCoachNote(prompt: string, opts: GenerateOpts): Promise<CoachNote> {
  const data = await post(
    {
      systemInstruction: { parts: [{ text: COACH_SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.6,
        maxOutputTokens: 900,
        responseMimeType: 'application/json',
        responseSchema: COACH_NOTE_SCHEMA,
      },
    },
    opts,
  )
  const cand = data.candidates?.[0]
  const finish = cand?.finishReason
  if (finish && finish !== 'STOP' && finish !== 'MAX_TOKENS') {
    throw new GeminiError('Gemini could not generate a note for this session.', 'blocked', 200)
  }
  const text = (cand?.content?.parts ?? []).map(p => p.text ?? '').join('')
  if (!text.trim()) throw new GeminiError('Gemini returned an empty response — try again.', 'other', 200)
  return parseCoachNote(text)
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
    return {
      headline: 'Coach note',
      tone: 'neutral',
      insights: [{ category: 'verdict', tone: 'neutral', message: text.trim().slice(0, 400) }],
    }
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

/** Lightweight key check used on Connect: a tiny generation that surfaces
 * auth/bad-key errors immediately without requiring structured output. */
export async function validateKey(apiKey: string, model: string, signal?: AbortSignal): Promise<void> {
  await post(
    {
      contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
      generationConfig: { maxOutputTokens: 5 },
    },
    { apiKey, model, signal },
  )
}
