import { t } from '../../i18n'
import { AiError, usesServerFallback, type AiModel, type AiProvider, type StructuredRequest } from './provider'
import { toStrictSchema } from './schema'

/**
 * Anthropic (Claude) provider, through the official @anthropic-ai/sdk.
 *
 * The SDK is loaded with a dynamic import so it lands in its own chunk and only
 * users who pick Claude download it.
 *
 * Browser access: the SDK refuses to run in a browser unless
 * `dangerouslyAllowBrowser` is set, because a key shipped in a public bundle
 * would leak. Here the key is the user's own, typed into Settings and stored
 * only in this device's localStorage (invariant 3) — the same trust model as
 * the Gemini key and the GitHub PAT — so calling the API from the page is
 * acceptable.
 *
 * Structured output uses `output_config.format` (json_schema), never a forced
 * tool: forced `tool_choice` returns 400 on current models. Sampling params
 * (`temperature`, `top_p`), `thinking` and `budget_tokens` are never sent —
 * current models reject them, and the thinking defaults are fine (hence the
 * generous `max_tokens`). Retries
 * belong to the engine, so the SDK's own retries are off (`maxRetries: 0`).
 */

type Sdk = typeof import('@anthropic-ai/sdk')
type Client = InstanceType<Sdk['default']>
type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

let sdkPromise: Promise<Sdk> | null = null
/**
 * The SDK chunk is not precached (vite.config.ts), so loading it can fail offline or on a
 * flaky connection: that is a 'network' AiError (never retried, translated copy in the UI).
 */
function loadSdk(): Promise<Sdk> {
  sdkPromise ??= import('@anthropic-ai/sdk').catch(() => {
    sdkPromise = null // a failed chunk load (offline) may succeed next time
    throw new AiError(t('ai.provider.network'), 'network')
  })
  return sdkPromise
}

/**
 * The Anthropic provider always talks to api.anthropic.com: `baseUrl` belongs
 * to the OpenAI-compatible provider and is ignored here, so a URL left in the
 * store from another provider can never redirect the user's Claude key.
 */
function makeClient(sdk: Sdk, key: string): Client {
  return new sdk.default({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 0 })
}

/**
 * Models that accept `output_config.effort`: every Claude 5+ model, the
 * *-4-6 / *-4-7 / *-4-8 generation and claude-opus-4-5 — not
 * claude-sonnet-4-5 / claude-haiku-4-5 or older. An optional date suffix
 * (`-20251101`) is allowed.
 */
const EFFORT_MODEL = /^claude-(?:[a-z]+-[5-9](?:-\d{1,2})?|[a-z]+-4-[678]|opus-4-5)(?:-\d{8})?$/
export function supportsEffort(model: string): boolean {
  return EFFORT_MODEL.test(model)
}

// Models with a server-side refusal fallback: defined in provider.ts so Settings can describe
// it without loading this module.
export { usesServerFallback }

/** Order of preference for the default model; otherwise the first one listed. */
const PREFERRED_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']

function isAbort(sdk: Sdk, e: unknown): boolean {
  return e instanceof sdk.APIUserAbortError || (e as Error)?.name === 'AbortError'
}

/** The engine recognises an abort by `name === 'AbortError'`, like fetch's. */
function abortError(): Error {
  return new DOMException('The operation was aborted.', 'AbortError')
}

/** Map an SDK failure onto AiError by its typed class (never by message text). */
function mapError(sdk: Sdk, e: unknown): Error {
  if (isAbort(sdk, e)) return abortError()
  if (e instanceof AiError) return e
  // APIConnectionTimeoutError is a subclass, so a timeout lands here too.
  if (e instanceof sdk.APIConnectionError) return new AiError(t('ai.provider.network'), 'network')
  if (e instanceof sdk.AuthenticationError) return new AiError(t('ai.provider.badKey'), 'bad-key', 401)
  if (e instanceof sdk.PermissionDeniedError) return new AiError(t('ai.provider.auth'), 'auth', 403)
  if (e instanceof sdk.RateLimitError) return new AiError(t('ai.provider.rateLimit'), 'rate-limit', 429)
  // InternalServerError covers every 5xx, 529 (overloaded) included; NotFoundError
  // is an unknown model id; BadRequestError a request shape the model rejects.
  if (e instanceof sdk.APIError) {
    const status = e.status ?? 0
    return new AiError(t('ai.provider.http', { status }), 'other', status)
  }
  return e instanceof Error ? e : new Error(String(e))
}

async function listModels(key: string, _baseUrl?: string, signal?: AbortSignal): Promise<AiModel[]> {
  const sdk = await loadSdk()
  const client = makeClient(sdk, key)
  try {
    const models: AiModel[] = []
    for await (const m of client.models.list({ limit: 1000 }, { signal })) {
      models.push({ id: m.id, label: m.display_name || m.id })
    }
    return models
  } catch (e) {
    throw mapError(sdk, e)
  }
}

function pickDefaultModel(models: AiModel[]): string {
  for (const id of PREFERRED_MODELS) if (models.some(m => m.id === id)) return id
  return models[0]?.id ?? ''
}

async function generate(req: StructuredRequest): Promise<string> {
  const sdk = await loadSdk()
  const client = makeClient(sdk, req.key)
  const params = {
    model: req.model,
    // max_tokens caps thinking and answer together, and current models think by default:
    // 16000 unless the caller asked for its own cap (the engine sends none by default).
    max_tokens: req.maxTokens ?? 16000,
    system: req.system,
    messages: [{
      role: 'user' as const,
      // Images first, then the instruction text.
      content: [
        ...(req.images ?? []).map(img => ({
          type: 'image' as const,
          source: { type: 'base64' as const, media_type: img.mimeType as ImageMediaType, data: img.data },
        })),
        { type: 'text' as const, text: req.user },
      ],
    }],
    output_config: {
      format: { type: 'json_schema' as const, schema: toStrictSchema(req.schema) as Record<string, unknown> },
      // These are short, well-specified extraction tasks: low effort keeps them fast and cheap.
      ...(supportsEffort(req.model) ? { effort: 'low' as const } : {}),
    },
  }
  let msg
  try {
    msg = usesServerFallback(req.model)
      ? await client.beta.messages.create(
        { ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' },
        { signal: req.signal },
      )
      : await client.messages.create(params, { signal: req.signal })
  } catch (e) {
    throw mapError(sdk, e)
  }
  // Check why the model stopped before reading any content.
  if (msg.stop_reason === 'refusal') {
    const category = msg.stop_details?.category
    throw new AiError(category ? `${t('ai.provider.blocked')} (${category})` : t('ai.provider.blocked'), 'blocked', 200)
  }
  if (msg.stop_reason === 'max_tokens') {
    // The JSON was cut off mid-way: never hand a truncated answer to the parser.
    throw new AiError(t('ai.provider.empty'), 'other', 200)
  }
  const block = msg.content.find(b => b.type === 'text')
  const text = block && 'text' in block ? block.text : ''
  if (!text.trim()) throw new AiError(t('ai.provider.empty'), 'other', 200)
  return text
}

export const anthropicProvider: AiProvider = {
  id: 'anthropic',
  listModels,
  pickDefaultModel,
  generate,
}
