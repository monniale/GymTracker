import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AiModel } from './gemini'

/**
 * Device-local AI settings. Cloned from useSyncStore: the API key is persisted
 * to localStorage ('gymtracker-ai') but lives ONLY on this device — it is never
 * written to Dexie, so the sync snapshot (which serializes Dexie tables) can
 * never carry it. Same trust model as the GitHub PAT.
 *
 * `models` is the list of generateContent-capable models the key can actually
 * call, discovered from the Gemini ListModels API on connect — so a model being
 * retired for new free-tier users can't hard-code the app into a broken state.
 */
export interface AiStore {
  apiKey: string | null
  model: string
  models: AiModel[]
  connect: (apiKey: string, models: AiModel[], model: string) => void
  setModel: (model: string) => void
  clear: () => void
}

export const useAiStore = create<AiStore>()(
  persist(
    set => ({
      apiKey: null,
      model: '',
      models: [],
      connect: (apiKey, models, model) => set({ apiKey, models, model }),
      setModel: model => set({ model }),
      clear: () => set({ apiKey: null, models: [], model: '' }),
    }),
    {
      name: 'gymtracker-ai',
      partialize: s => ({ apiKey: s.apiKey, model: s.model, models: s.models }),
    },
  ),
)
