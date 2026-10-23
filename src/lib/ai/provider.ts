/**
 * Provider-agnostic AI types and the provider registry. Every AI feature talks to
 * `engine.generateStructured`, which picks one of these providers. Keys and base
 * URLs stay device-local (aiStore, localStorage), never in Dexie.
 */

import { t } from '../../i18n'

export type AiProviderId = 'gemini' | 'openai' | 'anthropic'

export type AiErrorKind = 'auth' | 'bad-key' | 'rate-limit' | 'network' | 'blocked' | 'other'

/** A typed failure from any provider: the UI maps `kind` to a message, `status` is the HTTP status (0 when none). */
export class AiError extends Error {
  constructor(
    message: string,
    public kind: AiErrorKind,
    public status = 0,
  ) {
    super(message)
    this.name = 'AiError'
  }
}

/** The JSON Schema subset the response schemas use (draft-07 style, lowercase types). */
export type JsonSchema = {
  type?: string | string[]
  description?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  enum?: (string | number)[]
  nullable?: boolean
  additionalProperties?: boolean
  [k: string]: unknown
}

/** An image part for a multimodal request (base64, no data: prefix). */
export interface InlineImage {
  mimeType: string
  data: string
}

/** A model the user's key (or local server) can call. */
export interface AiModel {
  id: string
  label: string
}

/** One structured-output call, already resolved to a single model. */
export interface StructuredRequest {
  /** The system prompt, already localized by the engine. */
  system: string
  user: string
  schema: JsonSchema
  images?: InlineImage[]
  model: string
  key: string
  baseUrl?: string
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
}

export interface AiProvider {
  id: AiProviderId
  listModels(key: string, baseUrl?: string, signal?: AbortSignal): Promise<AiModel[]>
  pickDefaultModel(models: AiModel[]): string
  /** The raw JSON text of the answer, for the caller's parser. */
  generate(req: StructuredRequest): Promise<string>
}

/**
 * Provider modules, loaded on demand so the OpenAI-compatible and Anthropic code
 * stays out of the main chunk. Gemini is imported dynamically too: ai/gemini.ts
 * extends AiError from this module, so a static import here would be a cycle
 * whose evaluation order decides whether AiError exists yet. The facade
 * (src/lib/gemini.ts) imports it statically, so it lives in the main chunk anyway.
 */
export const PROVIDERS: Record<AiProviderId, () => Promise<AiProvider>> = {
  gemini: () => loadModule(import('./gemini').then(m => m.geminiProvider)),
  openai: () => loadModule(import('./openaiCompat').then(m => m.openaiProvider)),
  anthropic: () => loadModule(import('./anthropic').then(m => m.anthropicProvider)),
}

/** A provider chunk that fails to load (offline, or a deploy replaced it) is a network problem. */
function loadModule(p: Promise<AiProvider>): Promise<AiProvider> {
  return p.catch(() => {
    throw new AiError(t('ai.provider.network'), 'network')
  })
}

/**
 * Claude models with a server-side refusal fallback: when a safety classifier
 * declines, Anthropic re-runs the request on its recommended fallback model
 * inside the same call (ai/anthropic.ts sends the beta; Settings says so).
 */
const SERVER_FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5'])
export function usesServerFallback(model: string): boolean {
  return SERVER_FALLBACK_MODELS.has(model)
}

/** OpenAI-compatible servers offered in Settings; `local` ones run on the user's machine and need no key. */
export const BASE_URL_PRESETS: {
  id: 'openai' | 'openrouter' | 'groq' | 'mistral' | 'ollama' | 'lmstudio' | 'custom'
  url: string
  local: boolean
}[] = [
  { id: 'openai', url: 'https://api.openai.com/v1', local: false },
  { id: 'openrouter', url: 'https://openrouter.ai/api/v1', local: false },
  { id: 'groq', url: 'https://api.groq.com/openai/v1', local: false },
  { id: 'mistral', url: 'https://api.mistral.ai/v1', local: false },
  { id: 'ollama', url: 'http://localhost:11434/v1', local: true },
  { id: 'lmstudio', url: 'http://localhost:1234/v1', local: true },
  { id: 'custom', url: '', local: false },
]

/** Stored as the key for a keyless local server, so every `!!apiKey` gate keeps working. */
export const LOCAL_KEY = 'local'

/** True for a server on this machine or the local network (no key needed, nothing leaves the network). */
export function isLocalBaseUrl(url: string): boolean {
  let host: string
  try {
    host = new URL(url.trim()).hostname.toLowerCase()
  } catch {
    return false
  }
  host = host.replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true
  if (host === '::1' || host === '0.0.0.0') return true
  // Private IPv4 ranges only for a dotted-quad address, never a DNS name such as 10.example.com.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const [a, b] = host.split('.').map(Number)
    return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)
  }
  // IPv6 literals (the URL parser keeps a colon in them): unique-local fc00::/7, link-local fe80::/10.
  return host.includes(':') && (/^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host))
}
