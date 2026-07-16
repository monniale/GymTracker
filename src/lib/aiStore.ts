import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** Selectable Gemini free-tier models. IDs may shift over time — the dropdown
 * keeps changing the default trivial. Verify against current free-tier docs. */
export const AI_MODELS = [
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (recommended)' },
  { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite (faster, higher limits)' },
] as const

export const DEFAULT_AI_MODEL = AI_MODELS[0].id

/**
 * Device-local AI settings. Cloned from useSyncStore: the API key is persisted
 * to localStorage (`gymtracker-ai`) but lives ONLY on this device — it is never
 * written to Dexie, so the sync snapshot (which serializes Dexie tables) can
 * never carry it. Same trust model as the GitHub PAT.
 */
export interface AiStore {
  apiKey: string | null
  model: string
  setKey: (key: string) => void
  setModel: (model: string) => void
  clear: () => void
}

export const useAiStore = create<AiStore>()(
  persist(
    set => ({
      apiKey: null,
      model: DEFAULT_AI_MODEL,
      setKey: key => set({ apiKey: key }),
      setModel: model => set({ model }),
      clear: () => set({ apiKey: null }),
    }),
    {
      name: 'gymtracker-ai',
      partialize: s => ({ apiKey: s.apiKey, model: s.model }),
    },
  ),
)
