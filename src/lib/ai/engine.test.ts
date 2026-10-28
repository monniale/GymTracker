import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { generateStructured, ITALIAN_OUTPUT_LINE, RETRY_DELAY_MS, type GenerateOpts } from './engine'
import { AiError, PROVIDERS, type AiProvider, type AiProviderId, type StructuredRequest } from './provider'
import { useUiStore } from '../uiStore'

/** A provider whose answers (text or error) are played back in order. */
function fakeProvider(id: AiProviderId, answers: (string | Error)[]) {
  const requests: StructuredRequest[] = []
  const provider: AiProvider = {
    id,
    listModels: async () => [],
    pickDefaultModel: () => '',
    generate: vi.fn(async (req: StructuredRequest) => {
      requests.push(req)
      const a = answers[Math.min(requests.length - 1, answers.length - 1)]
      if (a instanceof Error) throw a
      return a
    }),
  }
  vi.spyOn(PROVIDERS, id).mockResolvedValue(provider)
  return requests
}

const parse = (text: string) => JSON.parse(text) as { ok: boolean }
const config = { schema: { type: 'object' }, parse }
const opts = (provider: AiProviderId, extra: Partial<GenerateOpts> = {}): GenerateOpts =>
  ({ provider, apiKey: 'k', model: 'm1', ...extra })
const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' })

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  useUiStore.setState({ language: 'en' })
})

/** Runs a call to completion while the fake clock passes the retry delay. */
async function settle<T>(p: Promise<T>): Promise<T> {
  const done = p.then(v => ({ v }), e => ({ e }))
  await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS)
  const r = await done
  if ('e' in r) throw r.e
  return r.v
}

describe('non-Gemini single retry', () => {
  it('retries once after the delay on a quota error, then succeeds and reports the model', async () => {
    const reqs = fakeProvider('openai', [new AiError('quota', 'rate-limit', 429), '{"ok":true}'])
    const onModel = vi.fn()
    const p = generateStructured('u', 'sys', config, opts('openai', { onModel }))
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS - 1)
    expect(reqs).toHaveLength(1)
    await expect(settle(p)).resolves.toEqual({ ok: true })
    expect(reqs).toHaveLength(2)
    expect(reqs.map(r => r.model)).toEqual(['m1', 'm1'])
    expect(onModel).toHaveBeenCalledWith('m1')
  })

  it('retries a 5xx, a blocked and an empty answer, but only once', async () => {
    for (const first of [new AiError('down', 'other', 503), new AiError('no', 'blocked', 200), '  ']) {
      const reqs = fakeProvider('anthropic', [first, new AiError('again', 'rate-limit', 429)])
      await expect(settle(generateStructured('u', 'sys', config, opts('anthropic')))).rejects.toMatchObject({ kind: 'rate-limit' })
      expect(reqs).toHaveLength(2)
    }
  })

  it('retries an answer the parser rejects', async () => {
    const reqs = fakeProvider('openai', ['not json {', '{"ok":true}'])
    await expect(settle(generateStructured('u', 'sys', config, opts('openai')))).resolves.toEqual({ ok: true })
    expect(reqs).toHaveLength(2)
  })

  it('never retries auth, bad-key, network, a 4xx or an abort', async () => {
    const errors = [
      new AiError('a', 'auth', 401), new AiError('b', 'bad-key', 400),
      new AiError('n', 'network'), new AiError('nf', 'other', 404), abortError(),
    ]
    for (const err of errors) {
      const reqs = fakeProvider('openai', [err, '{"ok":true}'])
      await expect(settle(generateStructured('u', 'sys', config, opts('openai')))).rejects.toBe(err)
      expect(reqs).toHaveLength(1)
    }
  })

  it('stops waiting when the caller aborts during the delay', async () => {
    const reqs = fakeProvider('openai', [new AiError('quota', 'rate-limit', 429), '{"ok":true}'])
    const ctrl = new AbortController()
    const p = generateStructured('u', 'sys', config, opts('openai', { signal: ctrl.signal }))
    const done = p.catch(e => e)
    await vi.advanceTimersByTimeAsync(10)
    ctrl.abort()
    expect(await done).toMatchObject({ name: 'AbortError' })
    expect(reqs).toHaveLength(1)
  })

  it('ignores Gemini fallbacks', async () => {
    const reqs = fakeProvider('openai', [new AiError('q', 'rate-limit', 429)])
    await expect(settle(generateStructured('u', 'sys', config, opts('openai', { fallbacks: ['x', 'y'] })))).rejects.toBeInstanceOf(AiError)
    expect(reqs.map(r => r.model)).toEqual(['m1', 'm1'])
  })
})

describe('Gemini chain', () => {
  it('is the default provider and walks the fallbacks without waiting', async () => {
    const reqs = fakeProvider('gemini', [new AiError('q', 'rate-limit', 429), 'garbage', '{"ok":true}'])
    const onModel = vi.fn()
    const value = await generateStructured('u', 'sys', config, { apiKey: 'k', model: 'm1', fallbacks: ['m2', 'm3'], onModel })
    expect(value).toEqual({ ok: true })
    expect(reqs.map(r => r.model)).toEqual(['m1', 'm2', 'm3'])
    expect(onModel).toHaveBeenCalledWith('m3')
  })
})

describe('request', () => {
  it('passes key, base URL, schema, images and defaults to the provider', async () => {
    const reqs = fakeProvider('openai', ['{"ok":true}'])
    const images = [{ mimeType: 'image/png', data: 'AA' }]
    await generateStructured('user text', 'sys', { ...config, images }, opts('openai', { baseUrl: 'http://localhost:11434/v1' }))
    expect(reqs[0]).toMatchObject({
      system: 'sys', user: 'user text', key: 'k', model: 'm1', baseUrl: 'http://localhost:11434/v1',
      schema: { type: 'object' }, images, temperature: 0.6,
    })
    // No cap unless the caller sets one: each provider owns its default.
    expect(reqs[0].maxTokens).toBeUndefined()
  })

  it('adds the Italian line to the system prompt for every provider, and nothing in English', async () => {
    for (const id of ['gemini', 'openai', 'anthropic'] as const) {
      useUiStore.setState({ language: 'it' })
      let reqs = fakeProvider(id, ['{"ok":true}'])
      await generateStructured('u', 'sys', config, opts(id))
      expect(reqs[0].system).toBe(`sys\n${ITALIAN_OUTPUT_LINE}`)

      useUiStore.setState({ language: 'en' })
      reqs = fakeProvider(id, ['{"ok":true}'])
      await generateStructured('u', 'sys', config, opts(id))
      expect(reqs[0].system).toBe('sys')
    }
  })
})
