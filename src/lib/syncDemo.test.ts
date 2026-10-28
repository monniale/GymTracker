import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '../db/db'
import { useUiStore } from './uiStore'
import { useSyncStore, syncNow, connect, previewConnection, installSyncTriggers } from './sync'
import { t } from '../i18n'

/** Demo data (lib/demoData.ts) must never reach a sync repo: every sync path refuses while it is loaded. */

type Listener = () => void
const visibilityListeners: Listener[] = []
const fakeDocument = {
  visibilityState: 'visible',
  addEventListener: (type: string, fn: Listener) => {
    if (type === 'visibilitychange') visibilityListeners.push(fn)
  },
}

describe('sync guard while demo data is loaded', () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchSpy = vi.fn(() => Promise.reject(new Error('fetch must not be called')))
    vi.stubGlobal('fetch', fetchSpy)
    vi.stubGlobal('document', fakeDocument)
    useSyncStore.setState({ token: 'github_pat_test_token_000000', owner: 'someone', repo: 'gymtracker-data' })
    useUiStore.getState().setDemoLoaded(true)
  })

  afterEach(() => {
    useUiStore.getState().setDemoLoaded(false)
    useSyncStore.getState().disconnect()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('syncNow returns demo without any network call, even when connected', async () => {
    expect(await syncNow('test')).toBe('demo')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(useSyncStore.getState().syncing).toBe(false)
    expect(useSyncStore.getState().lastError).toBeNull()
  })

  it('connect and previewConnection refuse before touching GitHub', async () => {
    const message = t('data.sync.demoLoaded')
    await expect(connect('github_pat_test_token_000000', 'gymtracker-data', 'overwrite-remote')).rejects.toThrow(message)
    await expect(previewConnection('github_pat_test_token_000000', 'gymtracker-data')).rejects.toThrow(message)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('the write and foreground triggers do nothing', async () => {
    // Only setTimeout is faked: fake-indexeddb schedules its own work with setImmediate.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    installSyncTriggers()
    // A tracked write fires the dirty listener; the debounced push must not be scheduled.
    await db.bodyLog.put({ date: '2026-01-05', weightKg: 80 })
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(10_000)
    expect(visibilityListeners.length).toBe(1)
    for (const fn of visibilityListeners) fn()
    // Turned off synchronously: a pass the foreground trigger queued anyway would now reach doSync
    // with the flag off and call fetch, so only the trigger's own guard keeps this at zero calls.
    useUiStore.getState().setDemoLoaded(false)
    await vi.runOnlyPendingTimersAsync()
    await new Promise(r => setImmediate(r))
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('a pass runs normally again once the flag is cleared', async () => {
    useUiStore.getState().setDemoLoaded(false)
    useSyncStore.getState().disconnect()
    expect(await syncNow('test')).toBe('disconnected')
  })
})
