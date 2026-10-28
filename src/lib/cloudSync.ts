/**
 * Cloud sync (Supabase) — row-level deltas with server-side last-write-wins:
 * - every tracked write queues `{table, key}` in the outbox (db/outbox.ts);
 * - push: the queued rows go to `push_rows` (an upsert that keeps the newer `updatedAt`);
 * - pull: rows with `server_seq` past our cursor come back and are applied under the same
 *   rule (a local row written later than the cloud's stays and is still in the outbox);
 * - the cross-row rules (`cloudFixups.ts`) run after a pull touched foods/events/rank.
 * The GitHub snapshot (lib/sync.ts) stays as a backup. Both run on the same `withSyncLock`
 * chain, so a pull never interleaves with a backup, an import or the daily checks.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { db, withSyncTrackingSuspended, emitDataReplaced } from '../db/db'
import { TABLES } from '../db/backup'
import { ensureSeeded } from '../db/seed'
import { ackOutbox, clearOutbox, pendingOutbox, queueOutbox, LOCAL_ONLY_TABLES, type OutboxEntry } from '../db/outbox'
import { withSyncLock } from './sync'
import { fixAfterPull, remapFoodIds } from './cloudFixups'
import { dedupFoodsByOffId } from './merge'
import { cloudConfigured } from './supabaseConfig'
import {
  SbError, getUser, listLiveIds, pullRows, pushRows, refreshSession, requestOtp, signOutRemote, verifyOtp,
  type CloudRow, type SbSession,
} from './supabaseApi'
import { demoLoadedAnyTab } from './uiStore'
import { t } from '../i18n'
import type { Food, Id } from '../types'

/** Tables that sync row by row (the backup allow-list minus tombstones: the cloud keeps deletes itself).
 * Computed on first use: `backup.ts` sits in an import cycle with this module (via demoData → sync). */
let cloudTablesCache: readonly string[] | null = null
export function cloudTables(): readonly string[] {
  cloudTablesCache ??= TABLES.filter(name => !LOCAL_ONLY_TABLES.has(name))
  return cloudTablesCache
}

const PUSH_CHUNK = 500
const PULL_PAGE = 1000
/** Refresh the access token this long before it expires. */
const REFRESH_MARGIN_S = 60

/* ------------------------------ store ------------------------------ */

export interface CloudStore {
  session: SbSession | null
  /** The highest `server_seq` applied locally: the pull cursor. */
  lastSeq: number
  lastSyncAt: number | null
  lastError: string | null
  syncing: boolean
  setSession: (s: SbSession | null) => void
}

/** Device-local (invariant 3): the session and cursor never enter Dexie or a backup. */
export const useCloudStore = create<CloudStore>()(
  persist(
    set => ({
      session: null,
      lastSeq: 0,
      lastSyncAt: null,
      lastError: null,
      syncing: false,
      setSession: session => set({ session, lastError: null }),
    }),
    {
      name: 'gymtracker-cloud',
      partialize: s => ({ session: s.session, lastSeq: s.lastSeq, lastSyncAt: s.lastSyncAt }),
    },
  ),
)

export function isCloudSignedIn(): boolean {
  return cloudConfigured() && useCloudStore.getState().session !== null
}

/* ------------------------------ auth ------------------------------ */

/** Step 1: email a code. Refused while demo data is loaded (lib/demoData.ts). */
export async function cloudSignIn(email: string): Promise<void> {
  if (demoLoadedAnyTab()) throw new Error(t('data.cloud.demoLoaded'))
  await requestOtp(email.trim())
}

/** Step 2: the code → a session on this device. The cursor starts at 0: the first sync pulls everything. */
export async function cloudVerify(email: string, code: string): Promise<SbSession> {
  const session = await verifyOtp(email.trim(), code)
  useCloudStore.setState({ session, lastSeq: 0, lastError: null })
  return session
}

/**
 * A magic link clicked in the browser lands on the Site URL with the tokens in the hash
 * (`#access_token=…&refresh_token=…&expires_at=…`). Called before the router mounts: turns them
 * into a session, then replaces the hash with the Settings route. Returns whether it did.
 */
export async function consumeAuthRedirect(): Promise<boolean> {
  if (!cloudConfigured() || typeof window === 'undefined') return false
  const hash = window.location.hash.replace(/^#\/?/, '')
  if (!/(^|&)access_token=/.test(hash)) return false
  const q = new URLSearchParams(hash)
  const access = q.get('access_token')
  const refresh = q.get('refresh_token')
  window.location.replace(`${window.location.pathname}${window.location.search}#/settings`)
  if (!access || !refresh) return false
  try {
    const user = await getUser(access)
    const expiresAt = Number(q.get('expires_at')) || Math.floor(Date.now() / 1000) + (Number(q.get('expires_in')) || 3600)
    useCloudStore.setState({ session: { access_token: access, refresh_token: refresh, expires_at: expiresAt, user }, lastSeq: 0, lastError: null })
    return true
  } catch (e) {
    useCloudStore.setState({ lastError: (e as Error).message })
    return false
  }
}

export async function cloudSignOut(): Promise<void> {
  const { session } = useCloudStore.getState()
  if (session) await signOutRemote(session.access_token)
  useCloudStore.setState({ session: null, lastSeq: 0, lastSyncAt: null, lastError: null })
  clearOutbox()
}

/** A valid access token, refreshed when it is about to expire. */
async function accessToken(): Promise<string> {
  const { session } = useCloudStore.getState()
  if (!session) throw new SbError(t('data.cloud.notSignedIn'), 0, 'auth')
  if (session.expires_at - REFRESH_MARGIN_S > Date.now() / 1000) return session.access_token
  try {
    const fresh = await refreshSession(session.refresh_token)
    useCloudStore.setState({ session: fresh })
    return fresh.access_token
  } catch (e) {
    // A rejected refresh token means the session is gone for good; anything else may be transient.
    if (e instanceof SbError && e.kind === 'auth') useCloudStore.setState({ session: null })
    throw e
  }
}

/* ------------------------------ rows ------------------------------ */

/** The cloud id of a row: its primary key as text. */
function keyOf(table: string, row: Record<string, unknown>): Id {
  const keyPath = db.table(table).schema.primKey.keyPath
  return row[typeof keyPath === 'string' ? keyPath : 'id'] as Id
}

/** The typed primary key behind a cloud `id` (legacy integer rows keep their numbers). */
export function keyFromCloudId(id: string): Id {
  return /^\d+$/.test(id) ? Number(id) : id
}

async function rowsFor(entries: OutboxEntry[]): Promise<CloudRow[]> {
  const out: CloudRow[] = []
  for (const e of entries) {
    if (!cloudTables().includes(e.table)) continue
    const row = e.deleted ? undefined : ((await db.table(e.table).get(e.key)) as Record<string, unknown> | undefined)
    out.push(row
      ? { tbl: e.table, id: String(e.key), data: row, updated_at: Number(row.updatedAt ?? e.updatedAt), deleted: false }
      : { tbl: e.table, id: String(e.key), data: {}, updated_at: e.updatedAt, deleted: true })
  }
  return out
}

/** Push the outbox in chunks; acknowledged entries leave it unless re-queued meanwhile. */
async function pushOutbox(token: string): Promise<boolean> {
  const pending = pendingOutbox()
  if (pending.length === 0) return false
  for (let i = 0; i < pending.length; i += PUSH_CHUNK) {
    const chunk = pending.slice(i, i + PUSH_CHUNK)
    const rows = await rowsFor(chunk)
    if (rows.length > 0) await pushRows(token, rows)
    ackOutbox(chunk)
  }
  return true
}

/**
 * Apply one page of cloud rows: a row wins locally when it is at least as new as ours (ties go
 * to the cloud: an echo of our own push is identical anyway); a tombstone deletes under the same
 * rule and leaves a local tombstone so a GitHub backup stays consistent. Returns the tables changed.
 *
 * Barcode duplicates (a food with the same `offId` saved on both devices under different ids)
 * are settled here, because the unique `offId` index cannot hold both: the winner follows
 * `dedupFoodsByOffId` (the same rule on every device, so they converge), the loser is deleted
 * on the cloud too, and the loser's logs/plans/meals are remapped (tracked, so they sync back).
 */
export async function applyCloudRows(rows: CloudRow[]): Promise<Set<string>> {
  const touched = new Set<string>()
  const byTable = new Map<string, CloudRow[]>()
  for (const r of rows) {
    if (!cloudTables().includes(r.tbl)) continue
    const list = byTable.get(r.tbl) ?? []
    list.push(r)
    byTable.set(r.tbl, list)
  }
  if (byTable.size === 0) return touched
  const remap = new Map<string, Id>()
  const cloudDeletes: Array<{ key: Id; updatedAt: number }> = []
  await withSyncTrackingSuspended(() =>
    db.transaction('rw', [...[...byTable.keys()].map(n => db.table(n)), db.foods, db.tombstones], async () => {
      for (const [name, list] of byTable) {
        const table = db.table(name)
        for (const r of list) {
          const key = keyFromCloudId(r.id)
          const local = (await table.get(key)) as { updatedAt?: number } | undefined
          if (local && (local.updatedAt ?? 0) > r.updated_at) continue
          if (r.deleted) {
            if (!local) continue
            await table.delete(key)
            await db.tombstones.add({ table: name, rowId: key, deletedAt: r.updated_at })
          } else {
            const incoming = { ...r.data, updatedAt: r.updated_at }
            if (name === 'foods' && !(await settleBarcodeClash(incoming as Food, r, remap, cloudDeletes))) continue
            await table.put(incoming)
          }
          touched.add(name)
        }
      }
    }),
  )
  // Outside the suspended transaction: these must reach the cloud.
  for (const d of cloudDeletes) queueOutbox('foods', d.key, d.updatedAt, true)
  await remapFoodIds(remap)
  return touched
}

/**
 * A food about to be written whose `offId` another local food already holds. Returns whether the
 * incoming row should be written (it won) — the local loser is then deleted here and its deletion
 * pushed; else the incoming loser's deletion is pushed and the local row stays.
 */
async function settleBarcodeClash(
  incoming: Food,
  r: CloudRow,
  remap: Map<string, Id>,
  cloudDeletes: Array<{ key: Id; updatedAt: number }>,
): Promise<boolean> {
  if (!incoming.offId) return true
  const other = await db.foods.where('offId').equals(incoming.offId).first()
  if (!other || String(other.id) === r.id) return true
  const { dropped } = dedupFoodsByOffId([other, incoming])
  const stamp = Math.max(Date.now(), r.updated_at + 1, (other.updatedAt ?? 0) + 1)
  if (dropped.has(String(other.id))) {
    await db.foods.delete(other.id!)
    await db.tombstones.add({ table: 'foods', rowId: other.id!, deletedAt: stamp })
    cloudDeletes.push({ key: other.id!, updatedAt: stamp })
    remap.set(String(other.id), incoming.id!)
    return true
  }
  cloudDeletes.push({ key: incoming.id!, updatedAt: stamp })
  remap.set(String(incoming.id), other.id!)
  return false
}

async function pullAll(token: string): Promise<Set<string>> {
  const touched = new Set<string>()
  for (;;) {
    const { lastSeq } = useCloudStore.getState()
    const page = await pullRows(token, lastSeq, PULL_PAGE)
    if (page.length === 0) return touched
    for (const name of await applyCloudRows(page)) touched.add(name)
    useCloudStore.setState({ lastSeq: Math.max(lastSeq, ...page.map(r => r.server_seq ?? 0)) })
    if (page.length < PULL_PAGE) return touched
  }
}

/** Whether the account already holds rows (asked before the first sync on a device with data). */
export async function cloudHasData(): Promise<boolean> {
  const token = await accessToken()
  return (await pullRows(token, 0, 1)).length > 0
}

/* ------------------------------ engine ------------------------------ */

export type CloudOutcome = 'disconnected' | 'demo' | 'up-to-date' | 'synced' | 'error'

async function doCloudSync(): Promise<CloudOutcome> {
  if (demoLoadedAnyTab()) return 'demo'
  if (!isCloudSignedIn()) return 'disconnected'
  const store = useCloudStore
  store.setState({ syncing: true, lastError: null })
  try {
    const token = await accessToken()
    const touched = await pullAll(token)
    if (touched.size > 0) {
      emitDataReplaced()
      await fixAfterPull(touched)
    }
    const pushed = await pushOutbox(token)
    if (pushed) {
      // Our push bumped server_seq: read it back so the next pull doesn't re-fetch our own rows.
      for (const name of await pullAll(token)) touched.add(name)
    }
    store.setState({ lastSyncAt: Date.now() })
    return touched.size > 0 || pushed ? 'synced' : 'up-to-date'
  } catch (e) {
    store.setState({ lastError: (e as Error).message })
    return 'error'
  } finally {
    store.setState({ syncing: false })
  }
}

/** Pull → push → pull, on the shared sync chain. Never rejects. */
export function cloudSyncNow(reason: string): Promise<CloudOutcome> {
  void reason
  return withSyncLock(doCloudSync).catch((): CloudOutcome => 'error')
}

/* ------------------------------ first sync on a device ------------------------------ */

export type InitialChoice = 'merge' | 'use-cloud' | 'overwrite-cloud'

/** Every local synced row, as cloud rows; `stamp` (overwrite) gives each one a clock that beats the cloud's. */
async function allLocalRows(stamp: ((tbl: string, id: string) => number) | null): Promise<CloudRow[]> {
  const out: CloudRow[] = []
  for (const name of cloudTables()) {
    for (const row of (await db.table(name).toArray()) as Record<string, unknown>[]) {
      const id = String(keyOf(name, row))
      const updatedAt = stamp ? stamp(name, id) : Number(row.updatedAt ?? 0)
      out.push({ tbl: name, id, data: stamp ? { ...row, updatedAt } : row, updated_at: updatedAt, deleted: false })
    }
  }
  return out
}

async function pushAll(token: string, rows: CloudRow[]): Promise<void> {
  for (let i = 0; i < rows.length; i += PUSH_CHUNK) await pushRows(token, rows.slice(i, i + PUSH_CHUNK))
}

/**
 * What to do with the data already on this device when it signs in:
 * - merge: send every local row (the cloud keeps the newer copy per row), then sync;
 * - use-cloud: drop the local rows and pull the cloud;
 * - overwrite-cloud: every local row wins (stamped now) and cloud rows this device lacks are deleted.
 */
export function cloudInitialSync(choice: InitialChoice): Promise<CloudOutcome> {
  return withSyncLock(async (): Promise<CloudOutcome> => {
    if (demoLoadedAnyTab()) return 'demo'
    if (!isCloudSignedIn()) return 'disconnected'
    const store = useCloudStore
    store.setState({ syncing: true, lastError: null })
    try {
      const token = await accessToken()
      if (choice === 'use-cloud') {
        await withSyncTrackingSuspended(() =>
          db.transaction('rw', cloudTables().map(n => db.table(n)), async () => {
            for (const name of cloudTables()) await db.table(name).clear()
          }))
        clearOutbox()
        store.setState({ lastSeq: 0 })
      } else {
        let rows: CloudRow[]
        if (choice === 'overwrite-cloud') {
          // Beat every cloud clock, even one from a device whose time ran ahead.
          const now = Date.now()
          const live = await listLiveIds(token)
          const cloudTs = new Map(live.map(r => [`${r.tbl}\u0000${r.id}`, r.updated_at]))
          const beat = (tbl: string, id: string) => Math.max(now, (cloudTs.get(`${tbl}\u0000${id}`) ?? 0) + 1)
          rows = await allLocalRows(beat)
          const mine = new Set(rows.map(r => `${r.tbl}\u0000${r.id}`))
          rows.push(...live
            .filter(r => !mine.has(`${r.tbl}\u0000${r.id}`))
            .map((r): CloudRow => ({ tbl: r.tbl, id: r.id, data: {}, updated_at: beat(r.tbl, r.id), deleted: true })))
        } else {
          rows = await allLocalRows(null)
        }
        await pushAll(token, rows)
        clearOutbox()
      }
      store.setState({ syncing: false })
    } catch (e) {
      store.setState({ lastError: (e as Error).message, syncing: false })
      return 'error'
    }
    const outcome = await doCloudSync()
    // A fresh device that chose the cloud copy of an empty account still needs the catalog.
    await ensureSeeded()
    return outcome
  }).catch((): CloudOutcome => 'error')
}
