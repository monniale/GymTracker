import { describe, it, expect, beforeEach, vi } from 'vitest'
import { aiRequestOpts, migrateAi, useAiStore } from './aiStore'
import { AiError, LOCAL_KEY } from './ai/provider'

/** Node has no localStorage; zustand persist reads and writes 'gymtracker-ai' there. Installed before
 * the store is imported. */
vi.hoisted(() => {
  const m = new Map<string, string>()
  const storage: Storage = {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: k => m.get(k) ?? null,
    key: i => [...m.keys()][i] ?? null,
    removeItem: k => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  }
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true })
})

const KEY = 'gymtracker-ai'
const FLASH = { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' }
const LITE = { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite' }
const saved = () => JSON.parse(localStorage.getItem(KEY) ?? 'null') as { state: Record<string, unknown>; version: number }

describe('aiStore persistence', () => {
  beforeEach(() => {
    useAiStore.getState().clear()
    localStorage.clear()
  })

  it('migrates a v0 entry (Gemini only, no version) to a Gemini connection without a base URL', async () => {
    localStorage.setItem(KEY, JSON.stringify({ state: { apiKey: 'AIzaKEY', model: FLASH.id, models: [FLASH, LITE] }, version: 0 }))
    await useAiStore.persist.rehydrate()
    const s = useAiStore.getState()
    expect(s.provider).toBe('gemini')
    expect(s.apiKey).toBe('AIzaKEY')
    expect(s.model).toBe(FLASH.id)
    expect(s.models).toEqual([FLASH, LITE])
    expect(s.baseUrl).toBe('')
  })

  it('migrateAi ignores a provider or base URL a v0 entry could not have held', () => {
    expect(migrateAi({ apiKey: 'k', model: 'm', models: [], provider: 'openai', baseUrl: 'x' }, 0)).toEqual({
      provider: 'gemini', apiKey: 'k', model: 'm', models: [], baseUrl: '',
    })
    expect(migrateAi(null, 0)).toEqual({ provider: 'gemini', apiKey: null, model: '', models: [], baseUrl: '' })
  })

  it('writes version 1 with the provider and the base URL', () => {
    useAiStore.getState().connect('openai', 'sk-1', [{ id: 'gpt-4o-mini', label: 'gpt-4o-mini' }], 'gpt-4o-mini', 'https://api.openai.com/v1')
    const s = saved()
    expect(s.version).toBe(1)
    expect(s.state).toEqual({
      provider: 'openai',
      apiKey: 'sk-1',
      model: 'gpt-4o-mini',
      models: [{ id: 'gpt-4o-mini', label: 'gpt-4o-mini' }],
      baseUrl: 'https://api.openai.com/v1',
    })
  })

  it('clear forgets the key and the models but keeps the provider and base URL', () => {
    useAiStore.getState().connect('openai', LOCAL_KEY, [], 'llama3.2', 'http://localhost:11434/v1')
    useAiStore.getState().clear()
    const s = useAiStore.getState()
    expect(s.apiKey).toBeNull()
    expect(s.models).toEqual([])
    expect(s.model).toBe('')
    expect(s.provider).toBe('openai')
    expect(s.baseUrl).toBe('http://localhost:11434/v1')
  })
})

describe('aiRequestOpts', () => {
  beforeEach(() => useAiStore.getState().clear())

  it('throws an auth AiError when no key is connected', () => {
    expect(() => aiRequestOpts()).toThrow(AiError)
    try {
      aiRequestOpts()
    } catch (e) {
      expect((e as AiError).kind).toBe('auth')
    }
  })

  it('Gemini: key, model and the free fallback chain', () => {
    const onModel = vi.fn()
    useAiStore.getState().connect('gemini', 'AIzaKEY', [FLASH, LITE], FLASH.id)
    const opts = aiRequestOpts(onModel)
    expect(opts.provider).toBe('gemini')
    expect(opts.apiKey).toBe('AIzaKEY')
    expect(opts.model).toBe(FLASH.id)
    expect(opts.fallbacks).toEqual([LITE.id])
    expect(opts.onModel).toBe(onModel)
  })

  it('OpenAI-compatible: base URL, no fallbacks', () => {
    useAiStore.getState().connect('openai', LOCAL_KEY, [], 'llama3.2', 'http://localhost:11434/v1')
    const opts = aiRequestOpts()
    expect(opts).toMatchObject({ provider: 'openai', apiKey: LOCAL_KEY, model: 'llama3.2', baseUrl: 'http://localhost:11434/v1' })
    expect(opts.fallbacks).toBeUndefined()
  })

  it('Anthropic: no fallbacks and no base URL', () => {
    useAiStore.getState().connect('anthropic', 'sk-ant-1', [{ id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' }], 'claude-haiku-4-5', 'https://ignored')
    const opts = aiRequestOpts()
    expect(opts).toMatchObject({ provider: 'anthropic', apiKey: 'sk-ant-1', model: 'claude-haiku-4-5', baseUrl: '' })
    expect(opts.fallbacks).toBeUndefined()
  })
})
