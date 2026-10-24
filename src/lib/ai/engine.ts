import { t } from '../../i18n'
import { getLang, type Lang } from '../uiStore'
import { AiError, PROVIDERS, type AiProvider, type AiProviderId, type InlineImage, type JsonSchema, type StructuredRequest } from './provider'

/**
 * Provider-agnostic engine for every structured AI call: localizes the system
 * prompt, picks the provider, retries, and parses the answer with the caller's
 * parser.
 */

export interface GenerateOpts {
  apiKey: string
  model: string
  /** Which API answers; Gemini when absent (stores from before the provider choice). */
  provider?: AiProviderId
  /** OpenAI-compatible server root (e.g. https://api.openai.com/v1); unused by Gemini. */
  baseUrl?: string
  /** Gemini only: free models tried in order when `model` fails with a retryable error (see `fallbackModels`). */
  fallbacks?: string[]
  /** Told which model actually answered: `model` or one of the fallbacks. */
  onModel?: (model: string) => void
  signal?: AbortSignal
}

/** How to shape and parse one structured call. */
export interface StructuredConfig<T> {
  schema: JsonSchema
  parse: (text: string) => T
  /** Images sent after the prompt text (base64, no data: prefix). */
  images?: InlineImage[]
  temperature?: number
  maxOutputTokens?: number
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

/** Wait before the single retry of a non-Gemini provider. */
export const RETRY_DELAY_MS = 2000

/**
 * Ask the chosen provider for a structured JSON payload under a system prompt and
 * response schema, and parse it with the caller's parser. The system prompt gets
 * `ITALIAN_OUTPUT_LINE` while the UI is Italian, whatever the provider.
 *
 * Gemini: if the chosen model fails with a retryable error, the same request goes
 * to each of `opts.fallbacks` in turn. When every model fails, the error thrown is
 * a quota error if any model hit one (the actionable story), else the chosen
 * model's own error.
 *
 * Other providers: one model only, retried once after RETRY_DELAY_MS on a quota,
 * server (5xx), blocked, empty or unparseable answer; never on a key, permission
 * or network problem, nor after an abort.
 */
export async function generateStructured<T>(
  prompt: string,
  systemPrompt: string,
  config: StructuredConfig<T>,
  opts: GenerateOpts,
): Promise<T> {
  const id = opts.provider ?? 'gemini'
  const req: StructuredRequest = {
    system: localizedSystemPrompt(systemPrompt),
    user: prompt,
    schema: config.schema,
    images: config.images,
    model: opts.model,
    key: opts.apiKey,
    baseUrl: opts.baseUrl,
    temperature: config.temperature ?? 0.6,
    // Only a caller's own cap: each provider applies its default (Gemini 2048 with thinking off,
    // Claude 16000 because thinking shares the budget, OpenAI-compatible servers their own).
    maxTokens: config.maxOutputTokens,
    signal: opts.signal,
  }
  const provider = await PROVIDERS[id]()
  return id === 'gemini'
    ? geminiChain(provider, req, config.parse, opts)
    : singleRetry(provider, req, config.parse, opts)
}

async function generateOnce<T>(provider: AiProvider, req: StructuredRequest, parse: (text: string) => T): Promise<T> {
  const text = await provider.generate(req)
  if (!text.trim()) throw new AiError(t(provider.id === 'gemini' ? 'ai.gemini.empty' : 'ai.provider.empty'), 'other', 200)
  return parse(text)
}

async function geminiChain<T>(provider: AiProvider, req: StructuredRequest, parse: (text: string) => T, opts: GenerateOpts): Promise<T> {
  const chain = [...new Set([opts.model, ...(opts.fallbacks ?? [])].filter(Boolean))]
  const errors: unknown[] = []
  for (const [i, model] of chain.entries()) {
    try {
      const value = await generateOnce(provider, { ...req, model }, parse)
      opts.onModel?.(model)
      return value
    } catch (e) {
      // The chosen model got past the key check, so a fallback's own auth error is about that model only.
      const modelAuth = i > 0 && e instanceof AiError && (e.kind === 'auth' || e.kind === 'bad-key')
      if (!isRetryable(e) && !modelAuth) throw e
      errors.push(e)
    }
  }
  throw errors.find(e => e instanceof AiError && e.kind === 'rate-limit') ?? errors[0]
}

async function singleRetry<T>(provider: AiProvider, req: StructuredRequest, parse: (text: string) => T, opts: GenerateOpts): Promise<T> {
  try {
    const value = await generateOnce(provider, req, parse)
    opts.onModel?.(req.model)
    return value
  } catch (e) {
    if (!isRetryableOnce(e)) throw e
    await sleep(RETRY_DELAY_MS, opts.signal)
    const value = await generateOnce(provider, req, parse)
    opts.onModel?.(req.model)
    return value
  }
}

/**
 * Gemini fallback rule. Failures another model may not share: a per-model free
 * quota, an overloaded or retired model, a request shape the model rejects, an
 * empty/blocked/unparseable answer. A rejected key, a permission problem or no
 * network fails the same way on every model, and an abort is the caller's
 * choice — those never fall back.
 */
function isRetryable(e: unknown): boolean {
  if ((e as Error)?.name === 'AbortError') return false
  if (e instanceof AiError) return e.kind === 'rate-limit' || e.kind === 'blocked' || e.kind === 'other'
  return true // the parser rejected a malformed answer
}

/**
 * Single-retry rule for the other providers: the same model asked again, so only
 * a transient failure counts — a quota, a server error (5xx, incl. Anthropic's
 * 529 overload), a blocked or empty answer (status 200) or one the parser rejected.
 */
function isRetryableOnce(e: unknown): boolean {
  if ((e as Error)?.name === 'AbortError') return false
  if (e instanceof AiError) {
    if (e.kind === 'rate-limit' || e.kind === 'blocked') return true
    return e.kind === 'other' && (e.status >= 500 || e.status === 200)
  }
  return true // the parser rejected a malformed answer
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' })
    if (signal?.aborted) return reject(abortError())
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(abortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
