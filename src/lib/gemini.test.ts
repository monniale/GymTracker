import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  parseCoachNote, generateCoachNote, generateDietNote, listModels, pickDefaultModel, fallbackModels, MAX_FALLBACKS,
  GeminiError, COACH_SYSTEM_PROMPT, ITALIAN_OUTPUT_LINE,
} from './gemini'
import { useUiStore } from './uiStore'

afterEach(() => vi.unstubAllGlobals())

function stubFetch(res: { ok: boolean; status: number; body: unknown }) {
  const fn = vi.fn(async () => ({
    ok: res.ok,
    status: res.status,
    json: async () => res.body,
  }))
  vi.stubGlobal('fetch', fn)
  return fn
}

const okResponse = (obj: unknown, finishReason = 'STOP') => ({
  ok: true,
  status: 200,
  body: { candidates: [{ finishReason, content: { parts: [{ text: JSON.stringify(obj) }] } }] },
})

const VALID_NOTE = {
  headline: 'Strong session',
  tone: 'celebratory',
  insights: [{ category: 'pr', tone: 'celebratory', message: 'New bench PR at 101 kg.' }],
}

describe('parseCoachNote', () => {
  it('parses a valid note', () => {
    const n = parseCoachNote(JSON.stringify(VALID_NOTE))
    expect(n.headline).toBe('Strong session')
    expect(n.tone).toBe('celebratory')
    expect(n.insights).toHaveLength(1)
  })

  it('coerces unknown enums and drops empty-message insights', () => {
    const n = parseCoachNote(
      JSON.stringify({
        headline: 'H',
        tone: 'weird',
        insights: [
          { category: 'nope', tone: 'bad', message: 'kept' },
          { category: 'pr', tone: 'positive', message: '   ' },
        ],
      }),
    )
    expect(n.tone).toBe('neutral')
    expect(n.insights).toHaveLength(1)
    expect(n.insights[0].category).toBe('verdict')
    expect(n.insights[0].tone).toBe('neutral')
    expect(n.insights[0].message).toBe('kept')
  })

  it('degrades fully unparseable output to a salvage note', () => {
    const n = parseCoachNote('this is not json {')
    expect(n.tone).toBe('neutral')
    expect(n.headline).toBe('Session reviewed')
    expect(n.insights).toHaveLength(1)
    expect(n.insights[0].message).toMatch(/Regenerate/i)
  })

  it('salvages the headline from truncated JSON (no messages yet)', () => {
    const n = parseCoachNote('{ "headline": "Short session, volume on track", "tone": "')
    expect(n.headline).toBe('Short session, volume on track')
    expect(n.insights).toHaveLength(1)
    expect(n.insights[0].message).toMatch(/Regenerate/i)
  })

  it('salvages headline and complete messages from truncated JSON', () => {
    const n = parseCoachNote('{"headline":"Solid day","insights":[{"message":"Add 2.5 kg next time"},{"message":"Nice streak"')
    expect(n.headline).toBe('Solid day')
    expect(n.insights.map(i => i.message)).toEqual(['Add 2.5 kg next time', 'Nice streak'])
  })

  it('defaults a missing headline', () => {
    const n = parseCoachNote(JSON.stringify({ tone: 'positive', insights: [] }))
    expect(n.headline).toBe('Session reviewed')
    expect(n.insights).toEqual([])
  })
})

describe('generateCoachNote', () => {
  it('returns a parsed CoachNote on success', async () => {
    stubFetch(okResponse(VALID_NOTE))
    const note = await generateCoachNote('prompt', { apiKey: 'k', model: 'gemini-2.5-flash' })
    expect(note.headline).toBe('Strong session')
    expect(note.insights[0].category).toBe('pr')
  })

  it('sends the model in the URL, the key in the header, and the prompt + schema in the body', async () => {
    const fn = stubFetch(okResponse(VALID_NOTE))
    await generateCoachNote('the prompt text', { apiKey: 'secret-key', model: 'gemini-2.5-flash' })
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('gemini-2.5-flash:generateContent')
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('secret-key')
    const body = JSON.parse(init.body as string)
    expect(body.contents[0].parts[0].text).toBe('the prompt text')
    expect(body.generationConfig.responseMimeType).toBe('application/json')
    expect(body.generationConfig.responseSchema).toBeTruthy()
    // Thinking disabled + generous cap so structured output isn't truncated.
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 })
    expect(body.generationConfig.maxOutputTokens).toBe(2048)
  })

  it('maps HTTP 401 to an auth error', async () => {
    stubFetch({ ok: false, status: 401, body: { error: { message: 'API key not valid' } } })
    await expect(generateCoachNote('p', { apiKey: 'k', model: 'm' })).rejects.toMatchObject({
      name: 'GeminiError',
      kind: 'auth',
    })
  })

  it('maps HTTP 400 to a bad-key error', async () => {
    stubFetch({ ok: false, status: 400, body: { error: { message: 'API key not valid' } } })
    await expect(generateCoachNote('p', { apiKey: 'k', model: 'm' })).rejects.toMatchObject({ kind: 'bad-key' })
  })

  it('maps HTTP 429 to a rate-limit error', async () => {
    stubFetch({ ok: false, status: 429, body: {} })
    await expect(generateCoachNote('p', { apiKey: 'k', model: 'm' })).rejects.toMatchObject({ kind: 'rate-limit' })
  })

  it('maps a fetch rejection to a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    await expect(generateCoachNote('p', { apiKey: 'k', model: 'm' })).rejects.toMatchObject({ kind: 'network' })
  })

  it('treats a safety-blocked finishReason as a blocked error', async () => {
    stubFetch({
      ok: true,
      status: 200,
      body: { candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }] },
    })
    await expect(generateCoachNote('p', { apiKey: 'k', model: 'm' })).rejects.toMatchObject({ kind: 'blocked' })
  })

  it('errors on an empty response body', async () => {
    stubFetch({ ok: true, status: 200, body: { candidates: [{ finishReason: 'STOP', content: { parts: [] } }] } })
    await expect(generateCoachNote('p', { apiKey: 'k', model: 'm' })).rejects.toBeInstanceOf(GeminiError)
  })

  it('does not swallow abort errors', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' })
    vi.stubGlobal('fetch', vi.fn(async () => { throw abort }))
    await expect(generateCoachNote('p', { apiKey: 'k', model: 'm' })).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('listModels', () => {
  const MODELS_BODY = {
    models: [
      { name: 'models/embedding-001', supportedGenerationMethods: ['embedContent'] },
      { name: 'models/gemini-3.1-flash-lite', displayName: 'Gemini 3.1 Flash-Lite', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-3.5-flash', displayName: 'Gemini 3.5 Flash', supportedGenerationMethods: ['generateContent', 'countTokens'] },
      { name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemma-3-27b', supportedGenerationMethods: ['generateContent'] },
    ],
  }

  it('keeps only generateContent-capable gemini models, strips the prefix, and ranks flash first', async () => {
    stubFetch({ ok: true, status: 200, body: MODELS_BODY })
    const models = await listModels('key')
    // embedding (no generateContent) and gemma (not gemini) dropped; flash < flash-lite < pro.
    expect(models.map(m => m.id)).toEqual(['gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-2.5-pro'])
    expect(models[0].label).toBe('Gemini 3.5 Flash')
  })

  it('sends the key in the header', async () => {
    const fn = stubFetch({ ok: true, status: 200, body: MODELS_BODY })
    await listModels('secret-key')
    const [, init] = fn.mock.calls[0] as unknown as [string, RequestInit]
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('secret-key')
  })

  it('maps an unauthorized key to an auth error', async () => {
    stubFetch({ ok: false, status: 401, body: {} })
    await expect(listModels('bad')).rejects.toMatchObject({ kind: 'auth' })
  })

  it('maps a fetch rejection to a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    await expect(listModels('k')).rejects.toMatchObject({ kind: 'network' })
  })
})

describe('generateDietNote', () => {
  it('uses a nutrition-focused system prompt and the given prompt', async () => {
    const fn = stubFetch(okResponse(VALID_NOTE))
    await generateDietNote('diet prompt text', { apiKey: 'k', model: 'gemini-2.5-flash' })
    const [, init] = fn.mock.calls[0] as unknown as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.systemInstruction.parts[0].text).toMatch(/nutrition/i)
    expect(body.contents[0].parts[0].text).toBe('diet prompt text')
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 })
  })
})

describe('UI language', () => {
  afterEach(() => useUiStore.setState({ language: 'en' }))

  async function systemText(): Promise<string> {
    const fn = stubFetch(okResponse(VALID_NOTE))
    await generateCoachNote('p', { apiKey: 'k', model: 'm' })
    const [, init] = fn.mock.calls[0] as unknown as [string, RequestInit]
    return JSON.parse(init.body as string).systemInstruction.parts[0].text as string
  }

  it('asks for Italian prose when the UI is Italian, and nothing extra in English', async () => {
    useUiStore.setState({ language: 'it' })
    const italian = await systemText()
    expect(italian.startsWith(COACH_SYSTEM_PROMPT)).toBe(true)
    expect(italian.endsWith(`\n${ITALIAN_OUTPUT_LINE}`)).toBe(true)
    useUiStore.setState({ language: 'en' })
    expect(await systemText()).toBe(COACH_SYSTEM_PROMPT)
  })

  it('adds the line to every structured call (diet note too)', async () => {
    useUiStore.setState({ language: 'it' })
    const fn = stubFetch(okResponse(VALID_NOTE))
    await generateDietNote('p', { apiKey: 'k', model: 'm' })
    const [, init] = fn.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string).systemInstruction.parts[0].text).toContain(ITALIAN_OUTPUT_LINE)
  })
})

describe('pickDefaultModel', () => {
  it('returns the first (best-ranked) model id', () => {
    expect(pickDefaultModel([{ id: 'gemini-3.5-flash', label: 'a' }, { id: 'gemini-2.5-pro', label: 'b' }])).toBe('gemini-3.5-flash')
  })
  it('returns empty string for no models', () => {
    expect(pickDefaultModel([])).toBe('')
  })
})

describe('model fallback', () => {
  type Res = { ok: boolean; status: number; body: unknown }
  /** One canned response per call, in order; records the model of each call. */
  function stubSequence(responses: Res[]) {
    const models: string[] = []
    let i = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      models.push(/models\/([^:]+):/.exec(url)![1])
      const res = responses[Math.min(i++, responses.length - 1)]
      return { ok: res.ok, status: res.status, json: async () => res.body }
    }))
    return models
  }
  const quota: Res = { ok: false, status: 429, body: { error: { message: 'Quota exceeded' } } }
  const opts = (fallbacks: string[], onModel?: (m: string) => void) =>
    ({ apiKey: 'k', model: 'gemini-a-flash', fallbacks, onModel })

  it('retries a quota error on the next free model and reports which one answered', async () => {
    const calls = stubSequence([quota, okResponse(VALID_NOTE)])
    const onModel = vi.fn()
    const note = await generateCoachNote('p', opts(['gemini-b-flash-lite', 'gemini-c-flash'], onModel))
    expect(note.headline).toBe('Strong session')
    expect(calls).toEqual(['gemini-a-flash', 'gemini-b-flash-lite'])
    expect(onModel).toHaveBeenCalledWith('gemini-b-flash-lite')
  })

  it('reports the chosen model when it answers first', async () => {
    const calls = stubSequence([okResponse(VALID_NOTE)])
    const onModel = vi.fn()
    await generateCoachNote('p', opts(['gemini-b-flash-lite'], onModel))
    expect(calls).toEqual(['gemini-a-flash'])
    expect(onModel).toHaveBeenCalledWith('gemini-a-flash')
  })

  it('falls back on an overloaded/retired model and on a request the model rejects', async () => {
    const calls = stubSequence([
      { ok: false, status: 503, body: { error: { message: 'The model is overloaded.' } } },
      { ok: false, status: 400, body: { error: { message: 'Budget 0 is invalid. This model only works in thinking mode.' } } },
      okResponse(VALID_NOTE),
    ])
    await generateCoachNote('p', opts(['gemini-b', 'gemini-c']))
    expect(calls).toEqual(['gemini-a-flash', 'gemini-b', 'gemini-c'])
  })

  it('falls back on an empty or blocked answer', async () => {
    const calls = stubSequence([
      { ok: true, status: 200, body: { candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }] } },
      okResponse(VALID_NOTE),
    ])
    await generateCoachNote('p', opts(['gemini-b']))
    expect(calls).toHaveLength(2)
  })

  it('never falls back on a rejected key, an auth error or no network', async () => {
    let calls = stubSequence([{ ok: false, status: 400, body: { error: { message: 'API key not valid. Please pass a valid API key.' } } }])
    await expect(generateCoachNote('p', opts(['gemini-b']))).rejects.toMatchObject({ kind: 'bad-key' })
    expect(calls).toHaveLength(1)

    calls = stubSequence([{ ok: false, status: 403, body: {} }])
    await expect(generateCoachNote('p', opts(['gemini-b']))).rejects.toMatchObject({ kind: 'auth' })
    expect(calls).toHaveLength(1)

    const fetchFn = vi.fn(async () => { throw new Error('offline') })
    vi.stubGlobal('fetch', fetchFn)
    await expect(generateCoachNote('p', opts(['gemini-b']))).rejects.toMatchObject({ kind: 'network' })
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('skips a fallback model the key may not use and keeps going', async () => {
    const calls = stubSequence([quota, { ok: false, status: 403, body: {} }, okResponse(VALID_NOTE)])
    await generateCoachNote('p', opts(['gemini-b', 'gemini-c']))
    expect(calls).toEqual(['gemini-a-flash', 'gemini-b', 'gemini-c'])
  })

  it('throws the quota error when every model fails', async () => {
    stubSequence([
      { ok: false, status: 404, body: { error: { message: 'models/gemini-a-flash is not found' } } },
      quota,
      { ok: false, status: 500, body: {} },
    ])
    await expect(generateCoachNote('p', opts(['gemini-b', 'gemini-c']))).rejects.toMatchObject({ kind: 'rate-limit' })
  })

  it("throws the chosen model's error when no model hit a quota", async () => {
    stubSequence([
      { ok: false, status: 503, body: { error: { message: 'overloaded' } } },
      { ok: false, status: 404, body: { error: { message: 'not found' } } },
    ])
    await expect(generateCoachNote('p', opts(['gemini-b']))).rejects.toMatchObject({ kind: 'other', status: 503 })
  })

  it('does not call the same model twice', async () => {
    const calls = stubSequence([quota])
    await expect(generateCoachNote('p', opts(['gemini-a-flash', 'gemini-a-flash']))).rejects.toBeInstanceOf(GeminiError)
    expect(calls).toEqual(['gemini-a-flash'])
  })

  it('does not swallow an abort between attempts', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' })
    let n = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      if (n++ === 0) return { ok: false, status: 429, json: async () => ({}) }
      throw abort
    }))
    await expect(generateCoachNote('p', opts(['gemini-b', 'gemini-c']))).rejects.toMatchObject({ name: 'AbortError' })
    expect(n).toBe(2)
  })
})

describe('fallbackModels', () => {
  const m = (...ids: string[]) => ids.map(id => ({ id, label: id }))

  it('keeps the free Flash family: stable before preview, newest first, never the primary or Pro', () => {
    const models = m(
      'gemini-2.5-flash', 'gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-2.5-pro',
      'gemini-3-flash-preview', 'gemini-2.5-flash-image', 'gemini-2.5-flash-preview-tts',
    )
    expect(fallbackModels(models, 'gemini-3.5-flash')).toEqual([
      'gemini-2.5-flash', 'gemini-3.1-flash-lite', 'gemini-3-flash-preview',
    ])
  })

  it('caps the chain at MAX_FALLBACKS', () => {
    const models = m('gemini-1-flash', 'gemini-2-flash', 'gemini-3-flash', 'gemini-4-flash', 'gemini-5-flash', 'gemini-pro')
    expect(fallbackModels(models, 'gemini-pro')).toHaveLength(MAX_FALLBACKS)
    expect(fallbackModels(models, 'gemini-pro')[0]).toBe('gemini-5-flash')
  })

  it('uses the free "latest" aliases when the key has no discovered model list', () => {
    expect(fallbackModels([], 'gemini-2.5-flash')).toEqual(['gemini-flash-latest', 'gemini-flash-lite-latest'])
    expect(fallbackModels([], 'gemini-flash-latest')).toEqual(['gemini-flash-lite-latest'])
  })
})
