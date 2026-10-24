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
  /** Show the exercise library's animations/thumbnails (loaded from the dataset repo). Off by default. */
  showExerciseMedia: boolean
  setShowExerciseMedia: (on: boolean) => void
  /**
   * The demo backup (lib/demoData.ts) is what the database holds right now. While true, sync is
   * blocked (doSync returns 'demo', connect() refuses) so made-up data never reaches a sync repo.
   * Cleared by clearDemoData() and by importing a real backup.
   */
  demoLoaded: boolean
  setDemoLoaded: (v: boolean) => void
}

const UI_KEY = 'gymtracker-ui'

export const useUiStore = create<UiStore>()(
  persist(
    set => ({
      language: defaultLang(),
      setLanguage: language => set({ language }),
      showExerciseMedia: false,
      setShowExerciseMedia: showExerciseMedia => set({ showExerciseMedia }),
      demoLoaded: false,
      setDemoLoaded: demoLoaded => set({ demoLoaded }),
    }),
    {
      name: UI_KEY,
      partialize: s => ({
        language: s.language,
        showExerciseMedia: s.showExerciseMedia,
        demoLoaded: s.demoLoaded,
      }),
      merge: (persisted, current) => {
        const p = persisted as Partial<UiStore> | undefined
        const lang = p?.language
        return {
          ...current,
          language: lang === 'en' || lang === 'it' ? lang : current.language,
          showExerciseMedia: p?.showExerciseMedia === true,
          demoLoaded: p?.demoLoaded === true,
        }
      },
    },
  ),
)

/**
 * Pure: what this tab does when another tab saved `gymtracker-ui` (`raw`, the new value). A new
 * language reloads, as it does in the tab that changed it: module-level constants are built with
 * `t()` at load (src/i18n/index.ts), so switching in place would mix two languages. Anything else
 * is rehydrated.
 */
export function crossTabUiAction(raw: string | null, current: Lang): 'reload' | 'rehydrate' {
  try {
    const lang = (JSON.parse(raw ?? 'null') as { state?: { language?: unknown } } | null)?.state?.language
    return (lang === 'en' || lang === 'it') && lang !== current ? 'reload' : 'rehydrate'
  } catch {
    return 'rehydrate'
  }
}

/**
 * Another tab of the app shares the same IndexedDB but keeps its own in-memory store: pick up the
 * flags that tab saved (above all `demoLoaded`, which guards sync), so this tab's UI and sync
 * guards follow the demo being loaded or cleared there. A language change reloads this tab
 * (`crossTabUiAction`).
 */
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', e => {
    if (e.key !== UI_KEY) return
    if (crossTabUiAction(e.newValue, useUiStore.getState().language) === 'reload') window.location.reload()
    else void useUiStore.persist.rehydrate()
  })
}

/**
 * True when this tab's store, or the value last saved by any tab, says the demo is loaded. The sync
 * guards read this at check time, so a tab whose store has not caught up yet (the storage event is
 * asynchronous) still never pushes the demo rows another tab wrote.
 */
export function demoLoadedAnyTab(): boolean {
  if (useUiStore.getState().demoLoaded) return true
  try {
    const raw = localStorage.getItem(UI_KEY)
    if (!raw) return false
    const saved = JSON.parse(raw) as { state?: { demoLoaded?: unknown } } | null
    return saved?.state?.demoLoaded === true
  } catch {
    return false
  }
}

/** The current UI language, for code outside React. */
export function getLang(): Lang {
  return useUiStore.getState().language
}
