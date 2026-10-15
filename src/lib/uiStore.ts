import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Lang = 'en' | 'it'
export const LANGS: readonly Lang[] = ['en', 'it']

/** The device language when the app has no choice yet: Italian for an Italian phone, else English. */
export function defaultLang(): Lang {
  try {
    const nav = typeof navigator !== 'undefined' ? navigator.language : ''
    return /^it\b/i.test(nav ?? '') ? 'it' : 'en'
  } catch {
    return 'en'
  }
}

/**
 * Device-local UI preferences, persisted to localStorage ('gymtracker-ui'): never Dexie, so never
 * synced or backed up (ROUTEMAP invariant 3). Two devices can show different languages.
 */
export interface UiStore {
  language: Lang
  setLanguage: (lang: Lang) => void
}

export const useUiStore = create<UiStore>()(
  persist(
    set => ({
      language: defaultLang(),
      setLanguage: language => set({ language }),
    }),
    {
      name: 'gymtracker-ui',
      partialize: s => ({ language: s.language }),
      merge: (persisted, current) => {
        const lang = (persisted as Partial<UiStore> | undefined)?.language
        return { ...current, language: lang === 'en' || lang === 'it' ? lang : current.language }
      },
    },
  ),
)

/** The current UI language, for code outside React. */
export function getLang(): Lang {
  return useUiStore.getState().language
}
