import { describe, it, expect, vi, afterEach } from 'vitest'
import { parseCoachNote, generateCoachNote, listModels, pickDefaultModel, GeminiError } from './gemini'

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

describe('pickDefaultModel', () => {
  it('returns the first (best-ranked) model id', () => {
    expect(pickDefaultModel([{ id: 'gemini-3.5-flash', label: 'a' }, { id: 'gemini-2.5-pro', label: 'b' }])).toBe('gemini-3.5-flash')
  })
  it('returns empty string for no models', () => {
    expect(pickDefaultModel([])).toBe('')
  })
})
