import { t } from '../../i18n'
import { AiError, type AiErrorKind, type AiModel, type AiProvider, type StructuredRequest } from './provider'
import { toGeminiSchema } from './schema'

/**
 * Gemini transport. Runs directly from the browser (no backend): the
 * generateContent endpoint is CORS-open, and the user's own free-tier key is
 * sent from this device — the same trust model as the GitHub sync PAT. Error
 * handling mirrors githubApi.ts `gh()`. The model fallback chain lives in
 * engine.ts; this module answers for one model at a time.
 */

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'

export type GeminiErrorKind = AiErrorKind

/** A Gemini failure; still an AiError, so provider-agnostic code handles it the same way. */
export class GeminiError extends AiError {
  constructor(message: string, kind: GeminiErrorKind, status = 0) {
    super(message, kind, status)
    this.name = 'GeminiError'
  }
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

interface GeminiResponse {
  candidates?: Array<{
    finishReason?: string
    content?: { parts?: Array<{ text?: string }> }
  }>
}

async function post(body: unknown, model: string, key: string, signal?: AbortSignal): Promise<GeminiResponse> {
  const url = `${ENDPOINT}/${encodeURIComponent(model)}:generateContent`
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
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

/** The generateContent body for one structured call (the same for every model of the chain). */
function requestBody(req: StructuredRequest) {
  return {
    systemInstruction: { parts: [{ text: req.system }] },
    contents: [{
      role: 'user',
      parts: [{ text: req.user }, ...(req.images ?? []).map(img => ({ inlineData: { mimeType: img.mimeType, data: img.data } }))],
    }],
    generationConfig: {
      temperature: req.temperature ?? 0.6,
      // Gemini 2.5/3 Flash count "thinking" tokens against maxOutputTokens and
      // think by default; with structured output that starves the JSON and
      // truncates it. Disable thinking for these short, well-specified tasks
      // and keep a generous cap as a safety margin.
      thinkingConfig: { thinkingBudget: 0 },
      maxOutputTokens: req.maxTokens ?? 2048,
      responseMimeType: 'application/json',
      responseSchema: toGeminiSchema(req.schema),
    },
  }
}

/** One generateContent call: the answer's text, or a blocked/empty GeminiError. */
async function generate(req: StructuredRequest): Promise<string> {
  const data = await post(requestBody(req), req.model, req.key, req.signal)
  const cand = data.candidates?.[0]
  const finish = cand?.finishReason
  if (finish && finish !== 'STOP' && finish !== 'MAX_TOKENS') {
    throw new GeminiError(t('ai.gemini.blocked'), 'blocked', 200)
  }
  const text = (cand?.content?.parts ?? []).map(p => p.text ?? '').join('')
  if (!text.trim()) throw new GeminiError(t('ai.gemini.empty'), 'other', 200)
  return text
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

export const geminiProvider: AiProvider = {
  id: 'gemini',
  listModels: (key, _baseUrl, signal) => listModels(key, signal),
  pickDefaultModel,
  generate,
}
