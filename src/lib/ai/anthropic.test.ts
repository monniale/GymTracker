import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AiError, type JsonSchema, type StructuredRequest } from './provider'

/** A fake @anthropic-ai/sdk: records constructor options and request params. */
const fake = vi.hoisted(() => {
  class APIError extends Error {
    constructor(public status: number | undefined, message = 'api error') { super(message) }
  }
  class APIUserAbortError extends APIError { constructor() { super(undefined, 'aborted') } }
  class APIConnectionError extends APIError { constructor() { super(undefined, 'connection') } }
  class APIConnectionTimeoutError extends APIConnectionError {}
  class BadRequestError extends APIError {}
  class AuthenticationError extends APIError {}
  class PermissionDeniedError extends APIError {}
  class NotFoundError extends APIError {}
  class RateLimitError extends APIError {}
  class InternalServerError extends APIError {}

  const state = {
    ctorOpts: [] as unknown[],
    create: [] as { params: Record<string, any>; opts: unknown }[],
    betaCreate: [] as { params: Record<string, any>; opts: unknown }[],
    listCalls: [] as { params: unknown; opts: unknown }[],
    response: null as unknown,
    error: null as unknown,
    models: [] as { id: string; display_name: string }[],
  }
  const respond = () => {
    if (state.error) throw state.error
    return state.response
  }

  class Anthropic {
    messages = { create: async (params: Record<string, any>, opts: unknown) => { state.create.push({ params, opts }); return respond() } }
    beta = { messages: { create: async (params: Record<string, any>, opts: unknown) => { state.betaCreate.push({ params, opts }); return respond() } } }
    models = {
      list: (params: unknown, opts: unknown) => {
        state.listCalls.push({ params, opts })
        return (async function* () {
          if (state.error) throw state.error
          yield* state.models
        })()
      },
    }
    constructor(opts: unknown) { state.ctorOpts.push(opts) }
  }

  return {
    state,
    module: {
      default: Anthropic, Anthropic, APIError, APIUserAbortError, APIConnectionError, APIConnectionTimeoutError,
      BadRequestError, AuthenticationError, PermissionDeniedError, NotFoundError, RateLimitError, InternalServerError,
    },
  }
})

vi.mock('@anthropic-ai/sdk', () => fake.module)

const { anthropicProvider, supportsEffort, usesServerFallback } = await import('./anthropic')
const E = fake.module

const SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    items: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  },
  required: ['headline'],
}

function req(over: Partial<StructuredRequest> = {}): StructuredRequest {
  return { system: 'SYS', user: 'USER', schema: SCHEMA, model: 'claude-haiku-4-5', key: 'sk-ant-test', ...over }
}

function message(over: Record<string, unknown> = {}) {
  return {
    model: 'claude-haiku-4-5',
    stop_reason: 'end_turn',
    stop_details: null,
    content: [{ type: 'text', text: '{"headline":"ok"}' }],
    ...over,
  }
}

/** Every object in a schema tree, for asserting the strict-schema invariants. */
function objects(s: any, out: any[] = []): any[] {
  if (!s || typeof s !== 'object') return out
  if (s.properties) out.push(s)
  for (const v of Object.values(s.properties ?? {})) objects(v, out)
  if (s.items) objects(s.items, out)
  return out
}

beforeEach(() => {
  const s = fake.state
  s.ctorOpts = []; s.create = []; s.betaCreate = []; s.listCalls = []
  s.response = message(); s.error = null; s.models = []
})

describe('anthropicProvider.generate', () => {
  it('builds the client for browser use with the SDK retries off', async () => {
    await anthropicProvider.generate(req())
    expect(fake.state.ctorOpts).toEqual([{ apiKey: 'sk-ant-test', dangerouslyAllowBrowser: true, maxRetries: 0 }])
  })

  it('sends a json_schema output format with additionalProperties false on every object', async () => {
    const text = await anthropicProvider.generate(req())
    expect(text).toBe('{"headline":"ok"}')
    const { params } = fake.state.create[0]
    expect(params.model).toBe('claude-haiku-4-5')
    expect(params.max_tokens).toBe(16000)
    expect(params.system).toBe('SYS')
    expect(params.output_config.format.type).toBe('json_schema')
    const objs = objects(params.output_config.format.schema)
    expect(objs.length).toBe(2)
    for (const o of objs) {
      expect(o.additionalProperties).toBe(false)
      expect([...o.required].sort()).toEqual(Object.keys(o.properties).sort())
    }
  })

  it('never sends tools, thinking or sampling params', async () => {
    await anthropicProvider.generate(req({ temperature: 0.2, maxTokens: 900 }))
    const { params } = fake.state.create[0]
    expect(params.max_tokens).toBe(900)
    for (const k of ['tools', 'tool_choice', 'thinking', 'temperature', 'top_p', 'top_k']) expect(params).not.toHaveProperty(k)
  })

  it('passes the abort signal through the request options', async () => {
    const ctl = new AbortController()
    await anthropicProvider.generate(req({ signal: ctl.signal }))
    expect(fake.state.create[0].opts).toEqual({ signal: ctl.signal })
  })

  it('puts image blocks before the text block', async () => {
    await anthropicProvider.generate(req({ images: [{ mimeType: 'image/jpeg', data: 'AAA' }, { mimeType: 'image/png', data: 'BBB' }] }))
    const [msg] = fake.state.create[0].params.messages
    expect(msg.role).toBe('user')
    expect(msg.content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAA' } },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'BBB' } },
      { type: 'text', text: 'USER' },
    ])
  })

  it('sets effort low only on models that support it', async () => {
    await anthropicProvider.generate(req({ model: 'claude-haiku-5-5' }))
    await anthropicProvider.generate(req({ model: 'claude-sonnet-4-5' }))
    expect(fake.state.create[0].params.output_config.effort).toBe('low')
    expect(fake.state.create[1].params.output_config).not.toHaveProperty('effort')
  })

  it.each(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5'])(
    'uses the beta endpoint with server-side fallbacks on %s',
    async model => {
      await anthropicProvider.generate(req({ model }))
      expect(fake.state.create).toHaveLength(0)
      const { params, opts } = fake.state.betaCreate[0]
      expect(params.betas).toEqual(['server-side-fallback-2026-07-01'])
      expect(params.fallbacks).toBe('default')
      expect(params.model).toBe(model)
      expect(params.output_config.format.type).toBe('json_schema')
      expect(params.output_config.effort).toBe('low')
      expect(opts).toEqual({ signal: undefined })
    },
  )

  it.each(['claude-haiku-5-5', 'claude-sonnet-5', 'claude-opus-4-8', 'claude-haiku-4-5'])(
    'uses the plain endpoint without fallbacks on %s',
    async model => {
      await anthropicProvider.generate(req({ model }))
      expect(fake.state.betaCreate).toHaveLength(0)
      expect(fake.state.create[0].params).not.toHaveProperty('fallbacks')
      expect(fake.state.create[0].params).not.toHaveProperty('betas')
    },
  )

  it('reads the first text block, skipping other block types', async () => {
    fake.state.response = message({
      content: [{ type: 'thinking', thinking: '' }, { type: 'fallback' }, { type: 'text', text: '{"a":1}' }, { type: 'text', text: 'x' }],
    })
    expect(await anthropicProvider.generate(req())).toBe('{"a":1}')
  })

  it('maps a refusal to blocked, with the category when present', async () => {
    fake.state.response = message({ stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber' }, content: [] })
    const e = await anthropicProvider.generate(req()).catch(x => x)
    expect(e).toBeInstanceOf(AiError)
    expect(e.kind).toBe('blocked')
    expect(e.message).toContain('cyber')
  })

  it('maps a refusal without stop_details to blocked', async () => {
    fake.state.response = message({ stop_reason: 'refusal', stop_details: null, content: [{ type: 'text', text: '{"partial"' }] })
    await expect(anthropicProvider.generate(req())).rejects.toMatchObject({ kind: 'blocked' })
  })

  it('maps max_tokens to other instead of returning truncated JSON', async () => {
    fake.state.response = message({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"headline":"o' }] })
    await expect(anthropicProvider.generate(req())).rejects.toMatchObject({ name: 'AiError', kind: 'other' })
  })

  it('maps an empty answer to other', async () => {
    fake.state.response = message({ content: [{ type: 'text', text: '  ' }] })
    await expect(anthropicProvider.generate(req())).rejects.toMatchObject({ kind: 'other', status: 200 })
  })

  it.each([
    ['AuthenticationError', () => new E.AuthenticationError(401), 'bad-key', 401],
    ['PermissionDeniedError', () => new E.PermissionDeniedError(403), 'auth', 403],
    ['RateLimitError', () => new E.RateLimitError(429), 'rate-limit', 429],
    ['APIConnectionError', () => new E.APIConnectionError(), 'network', 0],
    ['APIConnectionTimeoutError', () => new E.APIConnectionTimeoutError(), 'network', 0],
    ['InternalServerError 500', () => new E.InternalServerError(500), 'other', 500],
    ['InternalServerError 529', () => new E.InternalServerError(529), 'other', 529],
    ['BadRequestError', () => new E.BadRequestError(400), 'other', 400],
    ['NotFoundError', () => new E.NotFoundError(404), 'other', 404],
  ] as const)('maps %s to %s', async (_name, make, kind, status) => {
    fake.state.error = make()
    const e = await anthropicProvider.generate(req()).catch(x => x)
    expect(e).toBeInstanceOf(AiError)
    expect(e).toMatchObject({ kind, status })
  })

  it('rethrows an abort as an AbortError', async () => {
    fake.state.error = new E.APIUserAbortError()
    const e = await anthropicProvider.generate(req()).catch(x => x)
    expect(e).not.toBeInstanceOf(AiError)
    expect(e.name).toBe('AbortError')
  })
})

describe('anthropicProvider.listModels / pickDefaultModel', () => {
  it('lists models with display names as labels', async () => {
    fake.state.models = [
      { id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5' },
      { id: 'claude-haiku-5-5', display_name: 'Claude Haiku 5.5' },
    ]
    const ctl = new AbortController()
    const models = await anthropicProvider.listModels('sk-ant-test', undefined, ctl.signal)
    expect(models).toEqual([
      { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
      { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
    ])
    expect(fake.state.listCalls[0].opts).toEqual({ signal: ctl.signal })
    expect(fake.state.ctorOpts[0]).toMatchObject({ apiKey: 'sk-ant-test', dangerouslyAllowBrowser: true, maxRetries: 0 })
  })

  it('maps a rejected key while listing', async () => {
    fake.state.error = new E.AuthenticationError(401)
    await expect(anthropicProvider.listModels('bad')).rejects.toMatchObject({ kind: 'bad-key', status: 401 })
  })

  it('prefers Opus 5.5, then Sonnet 5.5, then Haiku 5.5, else the first model', () => {
    const m = (...ids: string[]) => ids.map(id => ({ id, label: id }))
    expect(anthropicProvider.pickDefaultModel(m('claude-haiku-5-5', 'claude-opus-5-5', 'claude-sonnet-5-5'))).toBe('claude-opus-5-5')
    expect(anthropicProvider.pickDefaultModel(m('claude-haiku-5-5', 'claude-sonnet-5-5'))).toBe('claude-sonnet-5-5')
    expect(anthropicProvider.pickDefaultModel(m('claude-opus-4-8', 'claude-haiku-5-5'))).toBe('claude-haiku-5-5')
    expect(anthropicProvider.pickDefaultModel(m('claude-opus-4-8', 'claude-sonnet-4-6'))).toBe('claude-opus-4-8')
    expect(anthropicProvider.pickDefaultModel([])).toBe('')
  })
})

describe('supportsEffort', () => {
  it.each([
    'claude-fable-5-1', 'claude-fable-5', 'claude-mythos-5-1', 'claude-opus-5-5', 'claude-opus-5',
    'claude-sonnet-5-5', 'claude-sonnet-5', 'claude-haiku-5-5', 'claude-opus-4-8', 'claude-opus-4-7',
    'claude-opus-4-6', 'claude-sonnet-4-6', 'claude-opus-4-5', 'claude-opus-4-5-20251101',
  ])('is true for %s', model => expect(supportsEffort(model)).toBe(true))

  it.each([
    'claude-sonnet-4-5', 'claude-sonnet-4-5-20250929', 'claude-haiku-4-5', 'claude-haiku-4-5-20251001',
    'claude-opus-4-1', 'claude-sonnet-4-20250514', 'claude-3-5-sonnet-20241022', 'gpt-5', '',
  ])('is false for %s', model => expect(supportsEffort(model)).toBe(false))
})

describe('usesServerFallback', () => {
  it('covers exactly the four fallback models', () => {
    for (const m of ['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']) expect(usesServerFallback(m)).toBe(true)
    for (const m of ['claude-fable-5', 'claude-sonnet-5', 'claude-haiku-5-5', 'claude-opus-4-8']) expect(usesServerFallback(m)).toBe(false)
  })
})

describe('through the engine', () => {
  it('sends 16000 max_tokens, not a Gemini-sized cap, when the caller sets none', async () => {
    const { generateStructured } = await import('./engine')
    const value = await generateStructured('u', 'sys', { schema: SCHEMA, parse: JSON.parse }, {
      provider: 'anthropic', apiKey: 'sk-ant-test', model: 'claude-opus-5-5',
    })
    expect(value).toEqual({ headline: 'ok' })
    expect(fake.state.betaCreate[0].params.max_tokens).toBe(16000)
  })

  it('keeps a cap the caller asked for', async () => {
    const { generateStructured } = await import('./engine')
    await generateStructured('u', 'sys', { schema: SCHEMA, parse: JSON.parse, maxOutputTokens: 4000 }, {
      provider: 'anthropic', apiKey: 'sk-ant-test', model: 'claude-haiku-4-5',
    })
    expect(fake.state.create[0].params.max_tokens).toBe(4000)
  })
})

// Last: it swaps the SDK mock for one whose chunk fails to load (offline, or a replaced deploy).
describe('SDK chunk load failure', () => {
  it('is a network AiError for generate and listModels, never a raw TypeError', async () => {
    vi.resetModules()
    vi.doMock('@anthropic-ai/sdk', () => {
      throw new TypeError('Failed to fetch dynamically imported module')
    })
    const fresh = await import('./anthropic')
    await expect(fresh.anthropicProvider.generate(req())).rejects.toMatchObject({ name: 'AiError', kind: 'network' })
    await expect(fresh.anthropicProvider.listModels('sk-ant-test')).rejects.toMatchObject({ name: 'AiError', kind: 'network' })
    vi.doUnmock('@anthropic-ai/sdk')
  })
})
