import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { fallbackModels, type AiModel, type GenerateOpts } from './gemini'
import { AiError, type AiProviderId } from './ai/provider'
import { t } from '../i18n'

/**
 * Device-local AI settings. Cloned from useSyncStore: the API key is persisted
 * to localStorage ('gymtracker-ai') but lives ONLY on this device — it is never
 * written to Dexie, so the sync snapshot (which serializes Dexie tables) can
 * never carry it. Same trust model as the GitHub PAT. The base URL of an
 * OpenAI-compatible server stays here too.
 *
 * `provider` picks the client: Gemini, any OpenAI-compatible server (`baseUrl`)
 * or Anthropic. `models` is the list of models the key can actually call,
 * discovered from the provider's model list on connect — so a model being
 * retired can't hard-code the app into a broken state. It may be empty when an
 * OpenAI-compatible server has no model list and the user typed a model id.
 * A keyless local server stores `LOCAL_KEY` as the key, so every `!!apiKey`
 * gate keeps working.
 */
export interface AiPersisted {
  provider: AiProviderId
  apiKey: string | null
  model: string
  models: AiModel[]
  baseUrl: string
}

export interface AiStore extends AiPersisted {
  connect: (provider: AiProviderId, apiKey: string, models: AiModel[], model: string, baseUrl?: string) => void
  setModel: (model: string) => void
  /** Forgets the key and the models; the provider and base URL stay as the next connect's default. */
  clear: () => void
}

const PROVIDER_IDS: readonly AiProviderId[] = ['gemini', 'openai', 'anthropic']

/**
 * v0 (no version, before the provider choice) held `{ apiKey, model, models }`
 * for Gemini only; it becomes a Gemini connection with no base URL.
 */
export function migrateAi(persisted: unknown, version: number): AiPersisted {
  const p = (typeof persisted === 'object' && persisted !== null ? persisted : {}) as Partial<Record<keyof AiPersisted, unknown>>
  const provider = version >= 1 && PROVIDER_IDS.includes(p.provider as AiProviderId) ? (p.provider as AiProviderId) : 'gemini'
  return {
    provider,
    apiKey: typeof p.apiKey === 'string' && p.apiKey ? p.apiKey : null,
    model: typeof p.model === 'string' ? p.model : '',
    models: Array.isArray(p.models) ? (p.models as AiModel[]) : [],
    baseUrl: version >= 1 && typeof p.baseUrl === 'string' ? p.baseUrl : '',
  }
}

export const useAiStore = create<AiStore>()(
  persist(
    set => ({
      provider: 'gemini',
      apiKey: null,
      model: '',
      models: [],
      baseUrl: '',
      connect: (provider, apiKey, models, model, baseUrl = '') =>
        set({ provider, apiKey, models, model, baseUrl: provider === 'openai' ? baseUrl : '' }),
      setModel: model => set({ model }),
      clear: () => set({ apiKey: null, models: [], model: '' }),
    }),
    {
      name: 'gymtracker-ai',
      version: 1,
      migrate: (persisted, version) => migrateAi(persisted, version),
      partialize: (s): AiPersisted => ({
        provider: s.provider,
        apiKey: s.apiKey,
        model: s.model,
        models: s.models,
        baseUrl: s.baseUrl,
      }),
    },
  ),
)

/**
 * Options for an AI call: the stored provider, key, model and base URL. Gemini
 * also gets its free fallback chain (`fallbackModels`); the other providers
 * retry once on the same model in the engine. `onModel` learns which model
 * answered, so a saved result can record it. Throws when no key is connected.
 */
export function aiRequestOpts(onModel?: (model: string) => void): GenerateOpts {
  const { provider, apiKey, model, models, baseUrl } = useAiStore.getState()
  if (!apiKey) throw new AiError(t('ai.provider.noKey'), 'auth')
  if (provider === 'gemini') return { provider, apiKey, model, baseUrl, fallbacks: fallbackModels(models, model), onModel }
  return { provider, apiKey, model, baseUrl, onModel }
}
