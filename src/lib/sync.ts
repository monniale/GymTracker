/**
 * GitHub Sync engine — "snapshot ping-pong with CAS":
 * - one JSON snapshot at data/current.json in a PRIVATE repo,
 * - Contents API PUT with the previous blob sha = compare-and-swap,
 * - fast-forward push/pull when only one side changed,
 * - row-level merge (lib/merge.ts) when both changed, with a best-effort
 *   pre-merge safety copy of the local snapshot under devices/.
 * Sync only runs while the app is open (iOS PWAs have no background sync).
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { db, isSyncDirty, setSyncDirty, onSyncDirty } from '../db/db'
import { collectTables, applyTables } from '../db/backup'
import { mergeSnapshots, TOMBSTONE_RETENTION_MS, type SyncPayload, type SnapshotTables } from './merge'
import {
  getFile, putFile, getAuthedUser, repoExists, repoIsPrivate,
  GhError, type GhConfig,
} from './githubApi'

export const DATA_PATH = 'data/current.json'

/* ------------------------------ sync store ------------------------------ */

export interface SyncStore {
  token: string | null
  owner: string | null
  repo: string | null
  deviceId: string
  lastSyncedSha: string | null
  lastSyncAt: number | null
  lastError: string | null
  syncing: boolean
  setConnection: (c: { token: string; owner: string; repo: string }) => void
  disconnect: () => void
}

export const useSyncStore = create<SyncStore>()(
  persist(
    set => ({
      token: null,
      owner: null,
      repo: null,
      deviceId: crypto.randomUUID(),
      lastSyncedSha: null,
      lastSyncAt: null,
      lastError: null,
      syncing: false,
      setConnection: c => set({ ...c, lastError: null, lastSyncedSha: null }),
      disconnect: () =>
        set({ token: null, owner: null, repo: null, lastSyncedSha: null, lastError: null }),
    }),
    {
      name: 'gymtracker-sync',
      partialize: s => ({
        token: s.token,
        owner: s.owner,
        repo: s.repo,
        deviceId: s.deviceId,
        lastSyncedSha: s.lastSyncedSha,
        lastSyncAt: s.lastSyncAt,
      }),
    },
  ),
)

function cfg(): GhConfig | null {
  const { token, owner, repo } = useSyncStore.getState()
  return token && owner && repo ? { token, owner, repo } : null
}

export function isConnected(): boolean {
  return cfg() !== null
}

/* ------------------------------ snapshots ------------------------------ */

async function buildPayload(): Promise<SyncPayload> {
  // Prune expired tombstones without marking the device dirty.
  const cutoff = Date.now() - TOMBSTONE_RETENTION_MS
  const old = await db.tombstones.where('deletedAt').below(cutoff).primaryKeys()
  if (old.length > 0) {
    const { withSyncTrackingSuspended } = await import('../db/db')
    await withSyncTrackingSuspended(() => db.tombstones.bulkDelete(old))
  }
  return {
    app: 'gymtracker',
    version: 2,
    exportedAt: Date.now(),
    deviceId: useSyncStore.getState().deviceId,
    tables: (await collectTables()) as unknown as SnapshotTables,
  }
}

function parseRemote(text: string): SyncPayload {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Remote data file is not valid JSON')
  }
  const p = parsed as SyncPayload
  if (p.app !== 'gymtracker' || !p.tables) throw new Error('Remote file is not a GymTracker snapshot')
  return p
}

async function applyRemote(payload: SyncPayload): Promise<void> {
  await applyTables(payload.tables as never)
  setSyncDirty(false)
}

/* ------------------------------ engine ------------------------------ */

export type SyncOutcome =
  | 'disconnected' | 'busy' | 'up-to-date' | 'pushed' | 'pulled' | 'merged' | 'error'

let syncChain: Promise<SyncOutcome> = Promise.resolve('up-to-date')

/** Serialized: concurrent callers wait for the running pass, then run. */
export function syncNow(reason: string): Promise<SyncOutcome> {
  const run = syncChain.then(() => doSync(reason)).catch((): SyncOutcome => 'error')
  syncChain = run
  return run
}

async function doSync(reason: string): Promise<SyncOutcome> {
  const config = cfg()
  if (!config) return 'disconnected'
  const store = useSyncStore

  store.setState({ syncing: true })
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const remote = await getFile(config, DATA_PATH)
      const dirty = isSyncDirty()
      const { lastSyncedSha, deviceId } = store.getState()

      // First contact: nothing remote yet -> publish this device.
      if (!remote) {
        const sha = await putFile(
          config, DATA_PATH, JSON.stringify(await buildPayload()),
          `sync: initial snapshot from ${deviceId.slice(0, 8)} (${reason})`,
        )
        store.setState({ lastSyncedSha: sha, lastSyncAt: Date.now(), lastError: null })
        setSyncDirty(false)
        return 'pushed'
      }

      if (remote.sha === lastSyncedSha) {
        if (!dirty) {
          store.setState({ lastSyncAt: Date.now(), lastError: null })
          return 'up-to-date'
        }
        try {
          const sha = await putFile(
            config, DATA_PATH, JSON.stringify(await buildPayload()),
            `sync: ${reason} from ${deviceId.slice(0, 8)}`, remote.sha,
          )
          store.setState({ lastSyncedSha: sha, lastSyncAt: Date.now(), lastError: null })
          setSyncDirty(false)
          return 'pushed'
        } catch (e) {
          if (e instanceof GhError && e.kind === 'conflict') continue // raced -> re-read
          throw e
        }
      }

      // Remote moved since our last sync.
      const remotePayload = parseRemote(remote.text)
      if (!dirty) {
        await applyRemote(remotePayload)
        store.setState({ lastSyncedSha: remote.sha, lastSyncAt: Date.now(), lastError: null })
        return 'pulled'
      }

      // Both sides changed -> merge. Keep a pre-merge copy of the local state
      // so no merge bug can destroy either input (best effort).
      const localPayload = await buildPayload()
      try {
        const backupPath = `devices/${deviceId.slice(0, 8)}-premerge.json`
        const prior = await getFile(config, backupPath)
        await putFile(config, backupPath, JSON.stringify(localPayload),
          'sync: pre-merge safety copy', prior?.sha)
      } catch {
        // Safety copy is best-effort; the merge itself is still CAS-protected.
      }
      const merged = mergeSnapshots(localPayload, remotePayload, Date.now())
      const mergedPayload: SyncPayload = { ...localPayload, exportedAt: Date.now(), tables: merged.tables }
      await applyRemote(mergedPayload)
      try {
        const sha = await putFile(
          config, DATA_PATH, JSON.stringify(mergedPayload),
          `sync: merge on ${deviceId.slice(0, 8)} (${merged.notes.length} notes)`, remote.sha,
        )
        store.setState({ lastSyncedSha: sha, lastSyncAt: Date.now(), lastError: null })
        return 'merged'
      } catch (e) {
        if (e instanceof GhError && e.kind === 'conflict') {
          setSyncDirty(true) // merged state is local-only until pushed
          continue
        }
        throw e
      }
    }
    throw new Error('Remote kept changing — try again')
  } catch (e) {
    const message = e instanceof GhError
      ? e.kind === 'auth'
        ? 'GitHub token rejected — it may have expired. Paste a fresh one in Settings.'
        : e.message
      : (e as Error).message
    useSyncStore.setState({ lastError: message })
    return 'error'
  } finally {
    useSyncStore.setState({ syncing: false })
  }
}

/* ------------------------------ connect flow ------------------------------ */

export interface ConnectPreview {
  owner: string
  repoPrivate: boolean
  remoteExists: boolean
  remoteSummary?: { exportedAt: number; sessions: number; foodLogs: number }
  localMeaningful: boolean
}

/** Validates token+repo and reports what exists on both sides, so the UI can
 * ask the bootstrap question (use cloud / merge / overwrite) when needed. */
export async function previewConnection(token: string, repoName: string): Promise<ConnectPreview> {
  const owner = await getAuthedUser(token)
  const config: GhConfig = { token, owner, repo: repoName }
  if (!(await repoExists(config))) {
    throw new Error(`Repository ${owner}/${repoName} not found. Create it as a PRIVATE repo on GitHub first.`)
  }
  const isPrivate = await repoIsPrivate(config)
  const remote = await getFile(config, DATA_PATH)
  let remoteSummary: ConnectPreview['remoteSummary']
  if (remote) {
    try {
      const p = parseRemote(remote.text)
      remoteSummary = {
        exportedAt: p.exportedAt,
        sessions: p.tables.sessions?.length ?? 0,
        foodLogs: p.tables.foodLogs?.length ?? 0,
      }
    } catch {
      remoteSummary = { exportedAt: 0, sessions: 0, foodLogs: 0 }
    }
  }
  const [sessions, foodLogs] = await Promise.all([db.sessions.count(), db.foodLogs.count()])
  return {
    owner,
    repoPrivate: isPrivate === true,
    remoteExists: remote !== null,
    remoteSummary,
    localMeaningful: sessions > 0 || foodLogs > 0,
  }
}

export type BootstrapChoice = 'use-remote' | 'merge' | 'overwrite-remote'

export async function connect(
  token: string,
  repoName: string,
  choice: BootstrapChoice,
): Promise<SyncOutcome> {
  const owner = await getAuthedUser(token)
  useSyncStore.getState().setConnection({ token, owner, repo: repoName })
  const config: GhConfig = { token, owner, repo: repoName }

  if (choice === 'use-remote') {
    const remote = await getFile(config, DATA_PATH)
    if (remote) {
      await applyRemote(parseRemote(remote.text))
      useSyncStore.setState({ lastSyncedSha: remote.sha, lastSyncAt: Date.now(), lastError: null })
      return 'pulled'
    }
    setSyncDirty(true)
    return syncNow('connect')
  }
  if (choice === 'overwrite-remote') {
    const remote = await getFile(config, DATA_PATH)
    const sha = await putFile(
      config, DATA_PATH, JSON.stringify(await buildPayload()),
      'sync: overwrite from connect', remote?.sha,
    )
    useSyncStore.setState({ lastSyncedSha: sha, lastSyncAt: Date.now(), lastError: null })
    setSyncDirty(false)
    return 'pushed'
  }
  // merge: leave lastSyncedSha null so the engine sees "remote moved + dirty".
  setSyncDirty(true)
  return syncNow('connect')
}

/* ------------------------------ triggers ------------------------------ */

let triggersInstalled = false

export function installSyncTriggers(): void {
  if (triggersInstalled) return
  triggersInstalled = true

  let debounce: ReturnType<typeof setTimeout> | undefined
  onSyncDirty(() => {
    if (!isConnected() || document.visibilityState !== 'visible') return
    clearTimeout(debounce)
    debounce = setTimeout(() => void syncNow('write'), 8000)
  })

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isConnected()) {
      void syncNow('foreground')
    }
  })
}
