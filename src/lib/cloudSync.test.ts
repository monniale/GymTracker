import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db, deleteWithTombstone, withSyncTrackingSuspended } from '../db/db'
import { ensureSeeded } from '../db/seed'
import { ackOutbox, clearOutbox, pendingOutbox, queueOutbox } from '../db/outbox'
import { useUiStore } from './uiStore'
import {
  cloudTables, applyCloudRows, cloudSignIn, activePendingSignIn, cancelPendingSignIn, cloudSignOut, PENDING_SIGN_IN_MS, cloudInitialSync, cloudSyncNow, cloudVerify, keyFromCloudId, useCloudStore,
} from './cloudSync'
import { parseSignInLink, type CloudRow } from './supabaseApi'

vi.mock('./supabaseConfig', () => ({
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
  cloudConfigured: () => true,
}))

/* ---------- a tiny in-memory Supabase: push_rows LWW + pull by server_seq ---------- */

interface Stored extends CloudRow { server_seq: number }
let cloud: Map<string, Stored>
let seq: number
let requests: Array<{ path: string; body: unknown }>
let failNext: { status: number; body?: unknown } | null
let permissions: string[] | null // null: the project lacks my_permissions (404)
let season: { id: number; startedOn: string; endsOn: string } | null // null: no 0003_social.sql
let published: unknown[]

const SESSION = { access_token: 'tok', refresh_token: 'ref', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'u1', email: 'f@x.it' } }

function pushToCloud(rows: CloudRow[]): number {
  for (const r of rows) {
    const k = `${r.tbl}\u0000${r.id}`
    const cur = cloud.get(k)
    if (cur && !(cur.updated_at < r.updated_at || (cur.updated_at === r.updated_at && r.deleted && !cur.deleted))) continue
    cloud.set(k, { ...r, server_seq: ++seq })
  }
  return seq
}

function installFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.replace('https://test.supabase.co', '')
    const body = init?.body ? JSON.parse(init.body as string) : undefined
    requests.push({ path, body })
    if (failNext) {
      const f = failNext
      failNext = null
      return { ok: false, status: f.status, json: async () => f.body ?? {}, text: async () => '' }
    }
    const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) })
    if (path === '/auth/v1/otp') return ok({})
    if (path === '/auth/v1/verify') return ok(SESSION)
    if (path.startsWith('/auth/v1/token')) return ok({ ...SESSION, access_token: 'tok2' })
    if (path === '/auth/v1/logout') return ok({})
    if (path === '/rest/v1/rpc/push_rows') return ok(pushToCloud(body.p))
    const notFound = { ok: false, status: 404, json: async () => ({ message: 'not found' }), text: async () => '' }
    if (path === '/rest/v1/rpc/current_season') return season ? ok(season) : notFound
    if (path === '/rest/v1/rpc/publish_stats') {
      published.push(body.s)
      return ok(null)
    }
    if (path === '/rest/v1/rpc/my_permissions') {
      return permissions ? ok(permissions) : { ok: false, status: 404, json: async () => ({ message: 'not found' }), text: async () => '' }
    }
    if (path.startsWith('/rest/v1/rows?select=tbl,id,updated_at&')) {
      return ok([...cloud.values()].filter(r => !r.deleted).map(r => ({ tbl: r.tbl, id: r.id, updated_at: r.updated_at })))
    }
    if (path.startsWith('/rest/v1/rows?')) {
      const after = Number(/server_seq=gt\.(\d+)/.exec(path)![1])
      const limit = Number(/limit=(\d+)/.exec(path)![1])
      return ok([...cloud.values()].filter(r => r.server_seq > after).sort((a, b) => a.server_seq - b.server_seq).slice(0, limit))
    }
    throw new Error(`unexpected ${path}`)
  }))
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

const cloudRow = (tbl: string, data: Record<string, unknown>, updated_at: number, deleted = false): CloudRow =>
  ({ tbl, id: String(data.id ?? data.date ?? data.weekKey), data, updated_at, deleted })

beforeEach(async () => {
  vi.stubGlobal('localStorage', memoryStorage())
  cloud = new Map()
  seq = 0
  requests = []
  failNext = null
  permissions = []
  season = null
  published = []
  installFetch()
  db.close()
  await Dexie.delete('gymtracker')
  await db.open()
  clearOutbox()
  useCloudStore.setState({ session: { ...SESSION }, lastSeq: 0, lastSyncAt: null, lastError: null, syncing: false, permissions: [] })
  useUiStore.setState({ demoLoaded: false })
  await ensureSeeded()
})

afterEach(() => vi.unstubAllGlobals())

const session = (over: Partial<{ id: string; name: string }> = {}) =>
  ({ name: 'Push', startedAt: 1_700_000_000_000, templateId: null, bodyweightKg: 80, ...over })

describe('outbox', () => {
  it('queues tracked adds, puts and deletes by primary key, not suspended or local-only writes', async () => {
    const id = await db.sessions.add(session() as never)
    await db.bodyLog.put({ date: '2026-10-28', weightKg: 80.5 } as never)
    await db.settings.update(1, { bodyweightKg: 81 })
    await db.coachNotes.put({ sessionId: 'x', note: {} } as never)
    await withSyncTrackingSuspended(() => db.sessions.add(session({ id: 'suspended' }) as never))
    await deleteWithTombstone('sessions', id)
    const pending = pendingOutbox().filter(e => e.table !== 'exercises')
    expect(pending.map(e => [e.table, e.key, e.deleted])).toEqual([
      ['sessions', id, true], ['bodyLog', '2026-10-28', false], ['settings', 1, false],
    ])
    expect(pending.every(e => e.updatedAt > 0)).toBe(true)
  })

  it('keeps an entry re-queued during the push (newer updatedAt)', () => {
    clearOutbox()
    const old = { table: 'sessions', key: 'a', updatedAt: 10, deleted: false }
    queueOutbox('sessions', 'a', 10, false)
    queueOutbox('sessions', 'a', 20, false) // written again while the push was in flight
    ackOutbox([old])
    expect(pendingOutbox()).toEqual([{ table: 'sessions', key: 'a', updatedAt: 20, deleted: false }])
  })
})

describe('cloudSyncNow', () => {
  it('pushes the outbox as cloud rows and leaves it empty', async () => {
    clearOutbox()
    const id = await db.sessions.add(session() as never)
    expect(await cloudSyncNow('test')).toBe('synced')
    expect(pendingOutbox()).toEqual([])
    const stored = cloud.get(`sessions\u0000${id}`)!
    expect(stored.deleted).toBe(false)
    expect(stored.data).toMatchObject({ id, name: 'Push' })
    expect(stored.updated_at).toBe((await db.sessions.get(id))!.updatedAt)
    // the cursor moved past our own rows: a second pass fetches nothing new
    expect(await cloudSyncNow('test')).toBe('up-to-date')
    expect(useCloudStore.getState().lastSeq).toBe(seq)
  })

  it('pulls new rows, applies deletes with a tombstone, and keeps a newer local row', async () => {
    clearOutbox()
    await db.sessions.put(session({ id: 'mine', name: 'Local newer' }) as never)
    const mineTs = (await db.sessions.get('mine'))!.updatedAt!
    pushToCloud([
      cloudRow('sessions', session({ id: 'theirs', name: 'From phone' }), mineTs - 5),
      cloudRow('sessions', session({ id: 'mine', name: 'Cloud older' }), mineTs - 1),
      cloudRow('bodyLog', { date: '2026-10-20', weightKg: 79 }, mineTs),
      cloudRow('exercises', { id: 1 }, mineTs + 1, true),
    ])
    expect(await cloudSyncNow('test')).toBe('synced')
    expect((await db.sessions.get('theirs'))!).toMatchObject({ name: 'From phone', updatedAt: mineTs - 5 })
    expect((await db.sessions.get('mine'))!.name).toBe('Local newer')
    expect(await db.bodyLog.get('2026-10-20')).toMatchObject({ weightKg: 79 })
    expect(await db.exercises.get(1)).toBeUndefined()
    expect((await db.tombstones.toArray()).filter(t => t.rowId === 1 && t.table === 'exercises')).toHaveLength(1)
    // the pulled rows did not enter the outbox (applied suspended); the local one was pushed
    expect(pendingOutbox()).toEqual([])
    expect(cloud.get('sessions\u0000mine')!.data).toMatchObject({ name: 'Local newer' })
  })

  it('refreshes an expiring token and records errors without throwing', async () => {
    useCloudStore.setState({ session: { ...SESSION, expires_at: Math.floor(Date.now() / 1000) + 10 } })
    expect(await cloudSyncNow('test')).toBe('up-to-date')
    expect(requests.some(r => r.path.startsWith('/auth/v1/token'))).toBe(true)
    expect(useCloudStore.getState().session!.access_token).toBe('tok2')

    failNext = { status: 540 }
    expect(await cloudSyncNow('test')).toBe('error')
    expect(useCloudStore.getState().lastError).toMatch(/paused/i)
  })

  it('does nothing while demo data is loaded or signed out', async () => {
    useUiStore.setState({ demoLoaded: true })
    expect(await cloudSyncNow('test')).toBe('demo')
    useUiStore.setState({ demoLoaded: false })
    useCloudStore.setState({ session: null })
    expect(await cloudSyncNow('test')).toBe('disconnected')
    expect(requests).toEqual([])
  })

  it('runs the cross-row fix-ups after a pull: barcode duplicates, award duplicates, rank points', async () => {
    clearOutbox()
    const now = Date.now()
    const foodA = await db.foods.add({ source: 'off', offId: '123', name: 'Bar', nameLower: 'bar', kcal100: 1, protein100: 0, carbs100: 0, fat100: 0, userOverridden: false, lastUsedAt: now, useCount: 1 } as never)
    await db.foodLogs.add({ date: '2026-10-28', meal: 'lunch', foodId: foodA, grams: 50, loggedAt: now } as never)
    const rank = (await db.rankState.get(1))!
    pushToCloud([
      cloudRow('foods', { id: 'b', source: 'off', offId: '123', name: 'Bar (phone)', nameLower: 'bar (phone)', kcal100: 1, protein100: 0, carbs100: 0, fat100: 0, userOverridden: true, lastUsedAt: now, useCount: 1 }, now + 1),
      cloudRow('scoreEvents', { id: 'e1', date: rank.seasonStart, total: 15, label: 'Quest: 3 sessions', sessionId: null, breakdown: {} }, now + 1),
      cloudRow('scoreEvents', { id: 'e2', date: rank.seasonStart, total: 15, label: 'Quest: 3 sessions', sessionId: null, breakdown: {} }, now + 2),
      cloudRow('scoreEvents', { id: 'e3', date: rank.seasonStart, total: 40, sessionId: 's', breakdown: {} }, now + 3),
    ])
    expect([await cloudSyncNow('test'), useCloudStore.getState().lastError]).toEqual(['synced', null])
    expect(await db.foods.count()).toBe(1)
    expect((await db.foods.toCollection().first())!.name).toBe('Bar (phone)')
    expect((await db.foodLogs.toCollection().first())!.foodId).toBe('b')
    expect(await db.scoreEvents.count()).toBe(2)
    expect((await db.rankState.get(1))!.points).toBe(55)
    // and the fix-ups reached the cloud
    expect(cloud.get(`foods\u0000${foodA}`)!.deleted).toBe(true)
    expect(cloud.get('rankState\u00001')!.data).toMatchObject({ points: 55 })
  })
})

describe('shared season and friends stats', () => {
  it('follows the server season and pushes the rollover in the same sync', async () => {
    season = { id: 7, startedOn: '2020-01-01', endsOn: '2020-03-24' }
    expect(await cloudSyncNow('test')).toBe('synced')
    const rank = (await db.rankState.get(1))!
    expect(rank).toMatchObject({ seasonId: 7, sharedSeason: true, seasonEndsOn: '2020-03-24' })
    expect(cloud.get('rankState\u00001')!.data).toMatchObject({ seasonId: 7, sharedSeason: true })
  })

  it('publishes the workout stats once per change', async () => {
    await cloudSyncNow('test')
    expect(published).toHaveLength(1)
    expect(published[0]).toMatchObject({ seasonId: 1, points: 0, sessionsSeason: 0, bestLifts: [] })
    await cloudSyncNow('test')
    expect(published).toHaveLength(1)
    await db.rankState.update(1, { points: 42 })
    await cloudSyncNow('test')
    expect(published).toHaveLength(2)
    expect(published[1]).toMatchObject({ points: 42 })
  })
})

describe('permissions', () => {
  it('refreshes them on every sync, keeps them when the check fails, drops them on sign-out', async () => {
    permissions = ['end_season']
    expect(await cloudSyncNow('test')).toBe('up-to-date')
    expect(useCloudStore.getState().permissions).toEqual(['end_season'])

    permissions = null // a project without 0002: the sync still works, the cached answer stays
    expect(await cloudSyncNow('test')).toBe('up-to-date')
    expect(useCloudStore.getState().permissions).toEqual(['end_season'])

    permissions = [] // revoked on the server
    await cloudSyncNow('test')
    expect(useCloudStore.getState().permissions).toEqual([])

    useCloudStore.setState({ permissions: ['end_season'] })
    await cloudSignOut()
    expect(useCloudStore.getState().permissions).toEqual([])
  })

  it('forgets the previous account\'s permissions when another one signs in', async () => {
    useCloudStore.setState({ permissions: ['end_season'] })
    await cloudVerify('other@x.it', '123456')
    expect(useCloudStore.getState().permissions).toEqual([])
  })
})

describe('applyCloudRows / ids', () => {
  it('maps cloud ids back to typed keys', () => {
    expect(keyFromCloudId('42')).toBe(42)
    expect(keyFromCloudId('2026-10-28')).toBe('2026-10-28')
    expect(keyFromCloudId('6f1c…')).toBe('6f1c…')
  })

  it('ignores unknown tables and returns the touched ones', async () => {
    const touched = await applyCloudRows([
      cloudRow('coachNotes', { sessionId: 'x' }, 5),
      cloudRow('dayTypes', { date: '2026-10-28', type: 'rest' }, 5),
    ])
    expect([...touched]).toEqual(['dayTypes'])
    expect(cloudTables()).not.toContain('tombstones')
  })
})

describe('cloudInitialSync', () => {
  it('merge: every local row reaches the cloud; use-cloud: local rows are replaced', async () => {
    const id = await db.sessions.add(session() as never)
    expect(await cloudInitialSync('merge')).toBe('synced')
    expect(cloud.has(`sessions\u0000${id}`)).toBe(true)
    expect(cloud.has('exercises\u00001')).toBe(true) // the seed catalog too (updated_at 0)

    await db.sessions.add(session({ id: 'local-only' }) as never)
    useCloudStore.setState({ lastSeq: 0 })
    expect(await cloudInitialSync('use-cloud')).toBe('synced')
    expect(await db.sessions.get('local-only')).toBeUndefined()
    expect(await db.sessions.get(id)).toBeDefined()
    expect(await db.exercises.count()).toBeGreaterThan(0)
  })

  it('overwrite-cloud: local rows win and cloud-only rows are deleted', async () => {
    pushToCloud([cloudRow('sessions', session({ id: 'cloud-only' }), Date.now() + 10_000)])
    const id = await db.sessions.add(session({ name: 'Mine' }) as never)
    expect(await cloudInitialSync('overwrite-cloud')).toBe('synced')
    expect(cloud.get('sessions\u0000cloud-only')!.deleted).toBe(true)
    expect(cloud.get(`sessions\u0000${id}`)!.data).toMatchObject({ name: 'Mine' })
    expect(await db.sessions.get('cloud-only')).toBeUndefined()
  })

  it('verify accepts a pasted sign-in link (token hash) instead of a code', async () => {
    useCloudStore.setState({ session: null })
    await cloudVerify('f@x.it', 'Sign in: https://test.supabase.co/auth/v1/verify?token=pkce_abc123&type=magiclink&redirect_to=https%3A%2F%2Fx.github.io%2FGymTracker%2F')
    expect(requests.at(-1)).toMatchObject({ path: '/auth/v1/verify', body: { type: 'magiclink', token_hash: 'pkce_abc123' } })
    expect(parseSignInLink('123 456')).toBeNull()
  })

  it('remembers a sent sign-in until it is used, cancelled or an hour old', async () => {
    useCloudStore.setState({ session: null, pendingSignIn: null })
    await cloudSignIn(' f@x.it ')
    expect(activePendingSignIn()).toMatchObject({ email: 'f@x.it' })
    expect(activePendingSignIn(Date.now() + PENDING_SIGN_IN_MS + 1)).toBeNull()
    cancelPendingSignIn()
    expect(activePendingSignIn()).toBeNull()
    await cloudSignIn('f@x.it')
    await cloudVerify('f@x.it', '123456')
    expect(useCloudStore.getState().pendingSignIn).toBeNull()
  })

    it('verify stores the session and resets the cursor', async () => {
    useCloudStore.setState({ session: null, lastSeq: 99 })
    await cloudVerify('f@x.it', '123456')
    expect(useCloudStore.getState()).toMatchObject({ lastSeq: 0, session: { user: { id: 'u1' } } })
    expect(requests.at(-1)).toMatchObject({ path: '/auth/v1/verify', body: { type: 'email', email: 'f@x.it', token: '123456' } })
  })
})
