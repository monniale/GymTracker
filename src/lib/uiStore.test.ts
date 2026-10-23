import { describe, it, expect, beforeEach, vi } from 'vitest'
import { demoLoadedAnyTab, useUiStore } from './uiStore'

/** Node has no localStorage; zustand persist reads and writes 'gymtracker-ui' there. Installed before
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

const KEY = 'gymtracker-ui'
const saved = () => JSON.parse(localStorage.getItem(KEY) ?? 'null') as { state: Record<string, unknown> }
const writeSaved = (state: Record<string, unknown>) => localStorage.setItem(KEY, JSON.stringify({ state, version: 0 }))

describe('uiStore demoLoaded (the flag that blocks sync while the demo is loaded)', () => {
  beforeEach(() => {
    useUiStore.getState().setDemoLoaded(false)
  })

  it('is persisted in gymtracker-ui', () => {
    useUiStore.getState().setDemoLoaded(true)
    expect(saved().state.demoLoaded).toBe(true)
    useUiStore.getState().setDemoLoaded(false)
    expect(saved().state.demoLoaded).toBe(false)
  })

  it('survives a reload, and only a literal true turns it on', async () => {
    writeSaved({ demoLoaded: true })
    await useUiStore.persist.rehydrate()
    expect(useUiStore.getState().demoLoaded).toBe(true)
    writeSaved({ demoLoaded: 'yes' })
    await useUiStore.persist.rehydrate()
    expect(useUiStore.getState().demoLoaded).toBe(false)
    writeSaved({})
    await useUiStore.persist.rehydrate()
    expect(useUiStore.getState().demoLoaded).toBe(false)
  })

  it('demoLoadedAnyTab also sees a value another tab saved', () => {
    expect(demoLoadedAnyTab()).toBe(false)
    // Another tab loaded the demo: this tab's store has not caught up yet.
    writeSaved({ demoLoaded: true })
    expect(useUiStore.getState().demoLoaded).toBe(false)
    expect(demoLoadedAnyTab()).toBe(true)
    writeSaved({ demoLoaded: false })
    expect(demoLoadedAnyTab()).toBe(false)
    localStorage.setItem(KEY, '{not json')
    expect(demoLoadedAnyTab()).toBe(false)
  })
})
