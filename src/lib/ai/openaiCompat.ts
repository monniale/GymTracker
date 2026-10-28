import { t } from '../../i18n'
import {
  AiError, BASE_URL_PRESETS, LOCAL_KEY,
  type AiErrorKind, type AiModel, type AiProvider, type StructuredRequest,
} from './provider'
import { schemaPromptLine, toStrictSchema } from './schema'

/**
 * Client for OpenAI-compatible chat servers (OpenAI, OpenRouter, Groq, Mistral,
 * Ollama, LM Studio, any custom `/v1` server). Runs from the browser with
 * `fetch`, like the Gemini client: the user's own key goes straight to the
 * server they chose. A CORS rejection surfaces as a fetch TypeError, so it maps
 * to 'network' (the settings screen shows the CORS hint for local/custom URLs).
 *
 * Structured output degrades in three steps, because support varies by server:
 * `json_schema` (strict) → `json_object` + the schema described in the system
 * prompt → no `response_format`, schema in the prompt only.
 */

const DEFAULT_BASE_URL = BASE_URL_PRESETS.find(p => p.id === 'openai')?.url ?? 'https://api.openai.com/v1'

/** Model ids that are not chat models (speech, embeddings, images, safety, ranking). */
const NON_CHAT = /whisper|tts|embed|moderation|dall-e|image|guard|rerank|transcri|audio|realtime/i

/** A 400 whose text says the server rejected the structured-output request shape. */
const FORMAT_REJECTED = /response_format|json_schema|strict|schema|unsupported/i
/** A 400 that is really a wrong key (OpenAI-style servers). */
const BAD_KEY = /invalid_api_key|incorrect api key|invalid api key/i
/** Newer OpenAI models reject `max_tokens` and ask for `max_completion_tokens`. */
const MAX_TOKENS_REJECTED = /max_completion_tokens/i
/** Reasoning models only accept the default temperature. */
const TEMPERATURE_REJECTED = /temperature/i

type FormatMode = 'schema' | 'object' | 'none'

/** Trim whitespace and trailing slashes; an empty URL means the OpenAI API. */
export function normalizeBaseUrl(baseUrl?: string): string {
  const url = (baseUrl ?? '').trim().replace(/\/+$/, '')
  return url || DEFAULT_BASE_URL
}

/** Bearer header unless the server is keyless (local sentinel or empty key). */
function authHeaders(key: string): Record<string, string> {
  return key && key !== LOCAL_KEY ? { Authorization: `Bearer ${key}` } : {}
}

function isAbort(e: unknown, signal?: AbortSignal): boolean {
  return (e as Error)?.name === 'AbortError' || !!signal?.aborted
}

async function send(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch (e) {
    if (isAbort(e, init.signal ?? undefined)) throw e
    throw new AiError(t('ai.provider.network'), 'network')
  }
}

/** The error body as raw text plus the most useful message inside it. */
async function errorDetail(res: Response): Promise<{ raw: string; message: string }> {
  let raw = ''
  try {
    raw = typeof res.text === 'function' ? await res.text() : JSON.stringify(await res.json())
  } catch {
    return { raw: '', message: '' }
  }
  let message = ''
  try {
    const body = JSON.parse(raw) as {
      error?: string | { message?: string; code?: string | number }
      message?: string
      detail?: string
    }
    message = typeof body.error === 'string'
      ? body.error
      : body.error?.message ?? body.message ?? (typeof body.detail === 'string' ? body.detail : '')
  } catch {
    message = raw
  }
  return { raw, message: message.slice(0, 300) }
}

function mapHttpError(status: number, detail: { raw: string; message: string }): AiError {
  const text = `${detail.raw} ${detail.message}`
  let kind: AiErrorKind = 'other'
  let message: string
  if (status === 400 && BAD_KEY.test(text)) {
    kind = 'bad-key'
    message = t('ai.provider.badKey')
  } else if (status === 401 || status === 403) {
    kind = 'auth'
    message = t('ai.provider.auth')
  } else if (status === 429) {
    kind = 'rate-limit'
    message = t('ai.provider.rateLimit')
  } else {
    const head = t('ai.provider.http', { status })
    message = detail.message ? `${head}: ${detail.message}` : head
  }
  return new AiError(message, kind, status)
}

interface RawModel { id?: unknown; name?: unknown }

async function listModels(key: string, baseUrl?: string, signal?: AbortSignal): Promise<AiModel[]> {
  const res = await send(`${normalizeBaseUrl(baseUrl)}/models`, { signal, headers: authHeaders(key) })
  if (!res.ok) throw mapHttpError(res.status, await errorDetail(res))
  let data: { data?: RawModel[] }
  try {
    data = (await res.json()) as { data?: RawModel[] }
  } catch {
    throw new AiError(t('ai.provider.empty'), 'other', res.status)
  }
  const seen = new Set<string>()
  const models: AiModel[] = []
  for (const m of Array.isArray(data?.data) ? data.data : []) {
    if (typeof m?.id !== 'string' || !m.id || NON_CHAT.test(m.id) || seen.has(m.id)) continue
    seen.add(m.id)
    models.push({ id: m.id, label: typeof m.name === 'string' && m.name ? m.name : m.id })
  }
  return models.sort((a, b) => a.id.localeCompare(b.id))
}

/**
 * Best default for the server the list came from, recognised by its ids:
 * OpenAI → a cheap mini model, OpenRouter → a free model, Groq → Llama 3.3 70B,
 * Mistral → Mistral Small, anything else (local servers) → the first model.
 */
function pickDefaultModel(models: AiModel[]): string {
  const ids = models.map(m => m.id)
  const exact = ['gpt-4o-mini', 'gpt-4.1-mini', 'llama-3.3-70b-versatile', 'mistral-small-latest']
    .find(id => ids.includes(id))
  if (exact) return exact
  const free = ids.find(id => id.endsWith(':free'))
  if (free) return free
  const looksOpenAi = ids.some(id => id.startsWith('gpt-')) && !ids.some(id => id.includes('/'))
  if (looksOpenAi) {
    const mini = ids.find(id => /^gpt-.*mini/i.test(id)) ?? ids.find(id => /mini/i.test(id))
    if (mini) return mini
  }
  return ids[0] ?? ''
}

type ContentPart = { type?: string; text?: string }
interface ChatResponse {
  choices?: Array<{
    finish_reason?: string | null
    message?: { content?: string | ContentPart[] | null; refusal?: string | null }
  }>
}

/** The answer text: parts joined, reasoning blocks and ```json fences removed. */
export function extractText(content: string | ContentPart[] | null | undefined): string {
  const joined = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map(p => (typeof p?.text === 'string' ? p.text : '')).join('')
      : ''
  const text = joined.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
  const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(text)
  return (fenced ? fenced[1] : text).trim()
}

interface BodyOpts { mode: FormatMode; maxTokensKey: 'max_tokens' | 'max_completion_tokens'; temperature: boolean }

function buildBody(req: StructuredRequest, o: BodyOpts): Record<string, unknown> {
  const system = o.mode === 'schema' ? req.system : `${req.system}\n\n${schemaPromptLine(req.schema)}`
  const user = req.images?.length
    ? [
        { type: 'text', text: req.user },
        ...req.images.map(i => ({ type: 'image_url', image_url: { url: `data:${i.mimeType};base64,${i.data}` } })),
      ]
    : req.user
  const body: Record<string, unknown> = {
    model: req.model,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  }
  if (o.temperature && req.temperature !== undefined) body.temperature = req.temperature
  if (req.maxTokens !== undefined) body[o.maxTokensKey] = req.maxTokens
  if (o.mode === 'schema') {
    body.response_format = {
      type: 'json_schema',
      json_schema: { name: 'result', schema: toStrictSchema(req.schema), strict: true },
    }
  } else if (o.mode === 'object') {
    body.response_format = { type: 'json_object' }
  }
  return body
}

async function generate(req: StructuredRequest): Promise<string> {
  const url = `${normalizeBaseUrl(req.baseUrl)}/chat/completions`
  const headers = { 'Content-Type': 'application/json', ...authHeaders(req.key) }
  const o: BodyOpts = { mode: 'schema', maxTokensKey: 'max_tokens', temperature: true }
  // At most: two parameter fixes plus the two response_format downgrades.
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await send(url, {
      method: 'POST',
      signal: req.signal,
      headers,
      body: JSON.stringify(buildBody(req, o)),
    })
    if (!res.ok) {
      const detail = await errorDetail(res)
      const text = `${detail.raw} ${detail.message}`
      if (res.status === 400 && !BAD_KEY.test(text)) {
        if (o.maxTokensKey === 'max_tokens' && req.maxTokens !== undefined && MAX_TOKENS_REJECTED.test(text)) {
          o.maxTokensKey = 'max_completion_tokens'
          continue
        }
        if (o.temperature && req.temperature !== undefined && TEMPERATURE_REJECTED.test(text)) {
          o.temperature = false
          continue
        }
        if (o.mode !== 'none' && FORMAT_REJECTED.test(text)) {
          o.mode = o.mode === 'schema' ? 'object' : 'none'
          continue
        }
      }
      throw mapHttpError(res.status, detail)
    }
    let data: ChatResponse
    try {
      data = (await res.json()) as ChatResponse
    } catch {
      throw new AiError(t('ai.provider.empty'), 'other', res.status)
    }
    const choice = data?.choices?.[0]
    if (choice?.finish_reason === 'content_filter' || choice?.message?.refusal) {
      throw new AiError(t('ai.provider.blocked'), 'blocked', res.status)
    }
    if (choice?.finish_reason === 'length') {
      // Cut off at the token cap: never hand a truncated answer to the parser (its salvage
      // paths would hide the failure from the engine's retry).
      throw new AiError(t('ai.provider.empty'), 'other', res.status)
    }
    const text = extractText(choice?.message?.content)
    if (!text) throw new AiError(t('ai.provider.empty'), 'other', res.status)
    return text
  }
  throw new AiError(t('ai.provider.empty'), 'other')
}

export const openaiProvider: AiProvider = {
  id: 'openai',
  listModels,
  pickDefaultModel,
  generate,
}
