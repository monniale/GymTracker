import { describe, it, expect, vi, afterEach } from 'vitest'

// The schema helpers have their own tests; here we only check where their output goes.
vi.mock('./schema', () => ({
  toStrictSchema: (s: unknown) => ({ strict: true, of: s }),
  schemaPromptLine: () => 'Reply with JSON matching SCHEMA.',
}))

import { openaiProvider, extractText, normalizeBaseUrl } from './openaiCompat'
import { AiError, LOCAL_KEY, type StructuredRequest } from './provider'

afterEach(() => vi.unstubAllGlobals())

type Res = { ok?: boolean; status?: number; body?: unknown }

function response({ ok = true, status = 200, body = {} }: Res) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  }
}

/** Stubs fetch with one response per call (the last one repeats). */
function stubFetch(...responses: Res[]) {
  let i = 0
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => response(responses[Math.min(i++, responses.length - 1)]))
  vi.stubGlobal('fetch', fn)
  return fn
}

const chat = (content: unknown, finish_reason = 'stop') => ({
  body: { choices: [{ finish_reason, message: { role: 'assistant', content } }] },
})

const err400 = (message: string, code: string | null = null) => ({
  ok: false, status: 400, body: { error: { message, type: 'invalid_request_error', code } },
})

const SCHEMA = { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] }

const req = (over: Partial<StructuredRequest> = {}): StructuredRequest => ({
  system: 'SYS',
  user: 'USER',
  schema: SCHEMA,
  model: 'gpt-4o-mini',
  key: 'sk-test',
  baseUrl: 'https://api.openai.com/v1/',
  temperature: 0.4,
  maxTokens: 1000,
  ...over,
})

const bodyOf = (fn: ReturnType<typeof stubFetch>, call = 0) =>
  JSON.parse(fn.mock.calls[call][1]!.body as string) as Record<string, any>
const headersOf = (fn: ReturnType<typeof stubFetch>, call = 0) =>
  (fn.mock.calls[call][1]?.headers ?? {}) as Record<string, string>

async function caught(p: Promise<unknown>): Promise<AiError> {
  try {
    await p
  } catch (e) {
    return e as AiError
  }
  throw new Error('expected a rejection')
}

describe('normalizeBaseUrl', () => {
  it('trims trailing slashes and whitespace, defaults to OpenAI', () => {
    expect(normalizeBaseUrl(' http://localhost:11434/v1// ')).toBe('http://localhost:11434/v1')
    expect(normalizeBaseUrl('')).toBe('https://api.openai.com/v1')
    expect(normalizeBaseUrl(undefined)).toBe('https://api.openai.com/v1')
  })
})

describe('openaiProvider.listModels', () => {
  it('GETs {baseUrl}/models with a Bearer key, drops non-chat models and sorts', async () => {
    const fn = stubFetch({
      body: {
        object: 'list',
        data: [
          { id: 'gpt-4o-mini' }, { id: 'whisper-1' }, { id: 'text-embedding-3-small' },
          { id: 'tts-1' }, { id: 'dall-e-3' }, { id: 'omni-moderation-latest' },
          { id: 'gpt-image-1' }, { id: 'llama-guard-4-12b' }, { id: 'gpt-4o-realtime-preview' },
          { id: 'gpt-4o-transcribe' }, { id: 'gpt-4o-audio-preview' }, { id: 'bge-reranker' },
          { id: 'gpt-4.1-mini' }, { id: 'gpt-4o-mini' }, { id: 42 },
        ],
      },
    })
    const models = await openaiProvider.listModels('sk-test', 'https://api.openai.com/v1/')
    expect(fn.mock.calls[0][0]).toBe('https://api.openai.com/v1/models')
    expect(headersOf(fn).Authorization).toBe('Bearer sk-test')
    expect(models).toEqual([
      { id: 'gpt-4.1-mini', label: 'gpt-4.1-mini' },
      { id: 'gpt-4o-mini', label: 'gpt-4o-mini' },
    ])
  })

  it('uses the server name as label when given (OpenRouter)', async () => {
    stubFetch({ body: { data: [{ id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Meta: Llama 3.3 70B (free)' }] } })
    const models = await openaiProvider.listModels('sk-or', 'https://openrouter.ai/api/v1')
    expect(models).toEqual([{ id: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Meta: Llama 3.3 70B (free)' }])
  })

  it('omits Authorization for the local sentinel and an empty key', async () => {
    const fn = stubFetch({ body: { data: [{ id: 'llama3.2' }] } })
    await openaiProvider.listModels(LOCAL_KEY, 'http://localhost:11434/v1')
    await openaiProvider.listModels('', 'http://localhost:1234/v1')
    expect(fn.mock.calls[0][0]).toBe('http://localhost:11434/v1/models')
    expect(headersOf(fn, 0).Authorization).toBeUndefined()
    expect(headersOf(fn, 1).Authorization).toBeUndefined()
  })

  it('maps a rejected key to auth', async () => {
    stubFetch({ ok: false, status: 401, body: { error: { message: 'Incorrect API key provided', code: 'invalid_api_key' } } })
    const e = await caught(openaiProvider.listModels('sk-bad', 'https://api.openai.com/v1'))
    expect(e).toBeInstanceOf(AiError)
    expect(e.kind).toBe('auth')
    expect(e.status).toBe(401)
  })

  it('maps an unreachable server to network', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    const e = await caught(openaiProvider.listModels(LOCAL_KEY, 'http://localhost:11434/v1'))
    expect(e.kind).toBe('network')
  })
})

describe('openaiProvider.pickDefaultModel', () => {
  const m = (...ids: string[]) => ids.map(id => ({ id, label: id }))
  it('prefers the cheap OpenAI mini models', () => {
    expect(openaiProvider.pickDefaultModel(m('gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini'))).toBe('gpt-4o-mini')
    expect(openaiProvider.pickDefaultModel(m('gpt-4.1', 'gpt-4.1-mini', 'gpt-5'))).toBe('gpt-4.1-mini')
    expect(openaiProvider.pickDefaultModel(m('gpt-5', 'gpt-5-mini', 'o3'))).toBe('gpt-5-mini')
  })
  it('picks a free OpenRouter model, else the first', () => {
    expect(openaiProvider.pickDefaultModel(m('anthropic/claude-x', 'meta-llama/llama-3.3-70b-instruct:free', 'openai/gpt-4o-mini')))
      .toBe('meta-llama/llama-3.3-70b-instruct:free')
    expect(openaiProvider.pickDefaultModel(m('anthropic/claude-x', 'openai/gpt-5'))).toBe('anthropic/claude-x')
  })
  it('picks the Groq and Mistral defaults', () => {
    expect(openaiProvider.pickDefaultModel(m('gemma2-9b-it', 'llama-3.1-8b-instant', 'llama-3.3-70b-versatile'))).toBe('llama-3.3-70b-versatile')
    expect(openaiProvider.pickDefaultModel(m('codestral-latest', 'mistral-large-latest', 'mistral-small-latest'))).toBe('mistral-small-latest')
  })
  it('falls back to the first model (local servers) or empty', () => {
    expect(openaiProvider.pickDefaultModel(m('llama3.2:3b', 'qwen2.5:7b'))).toBe('llama3.2:3b')
    expect(openaiProvider.pickDefaultModel([])).toBe('')
  })
})

describe('openaiProvider.generate', () => {
  it('POSTs a strict json_schema chat request', async () => {
    const fn = stubFetch(chat('{"a":"x"}'))
    const text = await openaiProvider.generate(req())
    expect(text).toBe('{"a":"x"}')
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn.mock.calls[0][0]).toBe('https://api.openai.com/v1/chat/completions')
    expect(fn.mock.calls[0][1]!.method).toBe('POST')
    expect(headersOf(fn)).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer sk-test' })
    expect(bodyOf(fn)).toEqual({
      model: 'gpt-4o-mini',
      messages: [{ role: 'system', content: 'SYS' }, { role: 'user', content: 'USER' }],
      temperature: 0.4,
      max_tokens: 1000,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'result', schema: { strict: true, of: SCHEMA }, strict: true },
      },
    })
  })

  it('omits unset sampling fields and the key for a local server', async () => {
    const fn = stubFetch(chat('{}'))
    await openaiProvider.generate(req({
      key: LOCAL_KEY, baseUrl: 'http://localhost:11434/v1', temperature: undefined, maxTokens: undefined,
    }))
    expect(headersOf(fn)).toEqual({ 'Content-Type': 'application/json' })
    const body = bodyOf(fn)
    expect(body).not.toHaveProperty('temperature')
    expect(body).not.toHaveProperty('max_tokens')
  })

  it('sends images as data-URL image_url parts', async () => {
    const fn = stubFetch(chat('{}'))
    await openaiProvider.generate(req({ images: [{ mimeType: 'image/jpeg', data: 'QUJD' }] }))
    expect(bodyOf(fn).messages[1]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'USER' },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,QUJD' } },
      ],
    })
  })

  it('downgrades json_schema → json_object → prompt-only on response_format 400s', async () => {
    const fn = stubFetch(
      err400("Invalid parameter: 'response_format' of type 'json_schema' is not supported with this model."),
      err400('response_format json_object is unsupported'),
      chat('{"a":"y"}'),
    )
    const text = await openaiProvider.generate(req())
    expect(text).toBe('{"a":"y"}')
    expect(fn).toHaveBeenCalledTimes(3)
    const second = bodyOf(fn, 1)
    expect(second.response_format).toEqual({ type: 'json_object' })
    expect(second.messages[0].content).toBe('SYS\n\nReply with JSON matching SCHEMA.')
    const third = bodyOf(fn, 2)
    expect(third).not.toHaveProperty('response_format')
    expect(third.messages[0].content).toBe('SYS\n\nReply with JSON matching SCHEMA.')
  })

  it('gives up after the prompt-only attempt also fails', async () => {
    const fn = stubFetch(err400('strict schema unsupported'))
    const e = await caught(openaiProvider.generate(req()))
    expect(fn).toHaveBeenCalledTimes(3)
    expect(e.kind).toBe('other')
    expect(e.status).toBe(400)
  })

  it('does not downgrade on an unrelated 400', async () => {
    const fn = stubFetch(err400('The model `nope` does not exist', 'model_not_found'))
    const e = await caught(openaiProvider.generate(req()))
    expect(fn).toHaveBeenCalledTimes(1)
    expect(e.kind).toBe('other')
    expect(e.message).toContain('does not exist')
  })

  it('maps a 400 invalid_api_key to bad-key without retrying', async () => {
    const fn = stubFetch(err400('Incorrect API key provided: sk-bad.', 'invalid_api_key'))
    const e = await caught(openaiProvider.generate(req()))
    expect(fn).toHaveBeenCalledTimes(1)
    expect(e.kind).toBe('bad-key')
  })

  it('switches to max_completion_tokens when the model asks for it', async () => {
    const fn = stubFetch(
      err400("Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead."),
      chat('{}'),
    )
    await openaiProvider.generate(req({ model: 'gpt-5-mini' }))
    const second = bodyOf(fn, 1)
    expect(second).not.toHaveProperty('max_tokens')
    expect(second.max_completion_tokens).toBe(1000)
    expect(second.response_format.type).toBe('json_schema')
  })

  it('drops temperature when the model only accepts the default', async () => {
    const fn = stubFetch(
      err400("Unsupported value: 'temperature' does not support 0.4 with this model. Only the default (1) value is supported."),
      chat('{}'),
    )
    await openaiProvider.generate(req({ model: 'o4-mini' }))
    const second = bodyOf(fn, 1)
    expect(second).not.toHaveProperty('temperature')
    expect(second.response_format.type).toBe('json_schema')
  })

  it('joins content parts and strips fences', async () => {
    stubFetch(chat([{ type: 'text', text: '```json\n{"a":' }, { type: 'text', text: '"z"}\n```' }]))
    expect(await openaiProvider.generate(req())).toBe('{"a":"z"}')
  })

  it('maps content_filter and refusals to blocked', async () => {
    stubFetch(chat(null, 'content_filter'))
    expect((await caught(openaiProvider.generate(req()))).kind).toBe('blocked')
    stubFetch({ body: { choices: [{ finish_reason: 'stop', message: { content: null, refusal: 'I cannot help' } }] } })
    expect((await caught(openaiProvider.generate(req()))).kind).toBe('blocked')
  })

  it('maps a truncated answer (finish_reason length) to other instead of returning it', async () => {
    stubFetch(chat('{"a":"tr', 'length'))
    const e = await caught(openaiProvider.generate(req()))
    expect(e).toBeInstanceOf(AiError)
    expect(e.kind).toBe('other')
    expect(e.status).toBe(200)
  })

  it('maps an empty answer to other', async () => {
    stubFetch(chat('  '))
    const e = await caught(openaiProvider.generate(req()))
    expect(e).toBeInstanceOf(AiError)
    expect(e.kind).toBe('other')
    stubFetch({ body: { choices: [] } })
    expect((await caught(openaiProvider.generate(req()))).kind).toBe('other')
  })

  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [429, 'rate-limit'],
    [500, 'other'],
    [503, 'other'],
  ])('maps HTTP %i to %s', async (status, kind) => {
    const fn = stubFetch({ ok: false, status, body: { error: { message: 'nope' } } })
    const e = await caught(openaiProvider.generate(req()))
    expect(fn).toHaveBeenCalledTimes(1)
    expect(e.kind).toBe(kind)
    expect(e.status).toBe(status)
  })

  it('maps a fetch failure (offline or CORS) to network', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    const e = await caught(openaiProvider.generate(req()))
    expect(e).toBeInstanceOf(AiError)
    expect(e.kind).toBe('network')
  })

  it('rethrows an abort as is', async () => {
    const abort = new DOMException('The operation was aborted.', 'AbortError')
    vi.stubGlobal('fetch', vi.fn(async () => { throw abort }))
    const e = await caught(openaiProvider.generate(req({ signal: new AbortController().signal })))
    expect(e).toBe(abort)
  })
})

describe('extractText', () => {
  it('handles strings, part arrays, reasoning blocks and missing content', () => {
    expect(extractText(' {"a":1} ')).toBe('{"a":1}')
    expect(extractText('```\n{"a":1}\n```')).toBe('{"a":1}')
    expect(extractText('<think>hmm</think>\n{"a":1}')).toBe('{"a":1}')
    expect(extractText([{ type: 'text', text: '{"a"' }, { type: 'text', text: ':1}' }])).toBe('{"a":1}')
    expect(extractText(null)).toBe('')
    expect(extractText(undefined)).toBe('')
  })
})
