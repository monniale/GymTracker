import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReleaseInfo } from '../lib/updateCheck'

const R: ReleaseInfo = {
  tag: 'v1.0.0+131',
  versionName: '1.0.0',
  versionCode: 131,
  apkUrl: 'https://github.com/monniale/GymTracker/releases/download/v1.0.0%2B131/gymtracker-1.0.0-131-release.apk',
  idsigUrl: 'https://github.com/monniale/GymTracker/releases/download/v1.0.0%2B131/gymtracker-1.0.0-131-release.apk.idsig',
  htmlUrl: 'https://github.com/monniale/GymTracker/releases/tag/v1.0.0%2B131',
  publishedAt: '2026-10-20T18:01:10Z',
}

function memoryStorage(): Storage {
  const m = new Map<string, string>()
  return {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: k => m.get(k) ?? null,
    key: i => [...m.keys()][i] ?? null,
    removeItem: k => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  }
}

let storage: Storage

beforeEach(() => {
  storage = memoryStorage()
  vi.stubGlobal('localStorage', storage)
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const load = () => import('./updateStore')

describe('useUpdateStore.save', () => {
  it('a failed check keeps the last good latest', async () => {
    const { useUpdateStore } = await load()
    const s = () => useUpdateStore.getState()
    s().save({ latest: R }, 1000)
    s().save({ error: 'network' }, 2000)
    expect(s()).toMatchObject({ latest: R, error: 'network', errorStatus: 0, lastCheckAt: 2000 })
    s().save({ error: 'rate-limit', status: 403 }, 3000)
    expect(s()).toMatchObject({ latest: R, error: 'rate-limit', errorStatus: 403, lastCheckAt: 3000 })
  })

  it('a successful check clears the error, also when no release exists', async () => {
    const { useUpdateStore } = await load()
    const s = () => useUpdateStore.getState()
    s().save({ latest: R }, 1000)
    s().save({ error: 'http', status: 500 }, 2000)
    s().save({ latest: null }, 3000)
    expect(s()).toMatchObject({ latest: null, error: null, errorStatus: 0, lastCheckAt: 3000 })
  })

  it('persists to gymtracker-update and rehydrates it', async () => {
    const first = await load()
    first.useUpdateStore.getState().save({ latest: R }, 1000)
    expect(JSON.parse(storage.getItem('gymtracker-update') ?? '{}').state).toMatchObject({ latest: R, lastCheckAt: 1000 })
    vi.resetModules()
    const second = await load()
    expect(second.useUpdateStore.getState()).toMatchObject({ latest: R, lastCheckAt: 1000, error: null })
  })

  it('rehydrates junk storage to the safe defaults', async () => {
    storage.setItem('gymtracker-update', JSON.stringify({
      state: { error: 'boom', lastCheckAt: 'x', latest: {}, errorStatus: 'y' },
      version: 1,
    }))
    const { useUpdateStore } = await load()
    expect(useUpdateStore.getState()).toMatchObject({ lastCheckAt: null, latest: null, error: null, errorStatus: 0 })
  })
})

describe('asReleaseInfo', () => {
  it('round-trips a valid release', async () => {
    const { asReleaseInfo } = await load()
    expect(asReleaseInfo(R)).toEqual(R)
    expect(asReleaseInfo(JSON.parse(JSON.stringify(R)))).toEqual(R)
  })

  it.each([['131'], [1.5], [Number.NaN]])('rejects versionCode %s', async (versionCode) => {
    const { asReleaseInfo } = await load()
    expect(asReleaseInfo({ ...R, versionCode })).toBeNull()
  })

  it('rejects a missing apkUrl or a non-object', async () => {
    const { asReleaseInfo } = await load()
    const { apkUrl: _drop, ...noApk } = R
    expect(asReleaseInfo(noApk)).toBeNull()
    expect(asReleaseInfo(null)).toBeNull()
    expect(asReleaseInfo('v1.0.0+131')).toBeNull()
  })

  it('drops a non-string idsigUrl', async () => {
    const { asReleaseInfo } = await load()
    const r = asReleaseInfo({ ...R, idsigUrl: 7 })
    expect(r).not.toBeNull()
    expect(r).not.toHaveProperty('idsigUrl')
  })
})

describe('mergePersisted', () => {
  const current = { lastCheckAt: null, latest: null, error: null, errorStatus: 0, extra: 'kept' }

  it('falls back to the defaults for junk', async () => {
    const { mergePersisted } = await load()
    for (const junk of [null, undefined, 'x', 42, { error: 'boom', lastCheckAt: 'x', latest: {}, errorStatus: Number.NaN }]) {
      expect(mergePersisted(junk, current)).toEqual(current)
    }
  })

  it('keeps valid fields and the non-persisted ones', async () => {
    const { mergePersisted } = await load()
    expect(mergePersisted({ lastCheckAt: 5, latest: R, error: 'rate-limit', errorStatus: 429 }, current)).toEqual({
      ...current,
      lastCheckAt: 5,
      latest: R,
      error: 'rate-limit',
      errorStatus: 429,
    })
  })
})
