import type { Id } from '../types'

/**
 * Cloud-sync outbox: every tracked write (add/put/delete, see the DBCore middleware in db.ts)
 * leaves a `{table, key}` entry here until the cloud sync (lib/cloudSync.ts) has pushed it.
 * Row-level, so the sync sends deltas instead of the whole database. Device-local and tiny
 * (entries vanish on push), so it lives in localStorage like the dirty flag, not in Dexie —
 * a user transaction scoped to `sessions` + `sets` could not write an IndexedDB outbox table.
 * An entry re-queued while its push is in flight keeps its newer `updatedAt`, so
 * `ackOutbox` leaves it for the next pass (no lost writes).
 */
export interface OutboxEntry {
  table: string
  key: Id
  /** `updatedAt` stamped on the write, or the time of a delete. */
  updatedAt: number
  deleted: boolean
}

/** Tables never sent to the cloud: device-local AI caches, and tombstones (the cloud keeps deletes itself). */
export const LOCAL_ONLY_TABLES: ReadonlySet<string> = new Set([
  'coachNotes', 'dietNotes', 'workoutSuggestions', 'dietSuggestions', 'tombstones',
])

const STORAGE_KEY = 'gymtracker-cloud-outbox'
const entryKey = (table: string, key: Id) => `${table}\u0000${String(key)}`

let entries: Map<string, OutboxEntry> | null = null

function load(): Map<string, OutboxEntry> {
  if (entries) return entries
  entries = new Map()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) for (const e of JSON.parse(raw) as OutboxEntry[]) entries.set(entryKey(e.table, e.key), e)
  } catch {
    /* storage unavailable (tests) or corrupt: start empty */
  }
  return entries
}

function save(): void {
  try {
    if (entries && entries.size > 0) localStorage.setItem(STORAGE_KEY, JSON.stringify([...entries.values()]))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* storage unavailable (tests) */
  }
}

/** Record a tracked write. Ignored for local-only tables. */
export function queueOutbox(table: string, key: Id, updatedAt: number, deleted: boolean): void {
  if (LOCAL_ONLY_TABLES.has(table) || key === undefined || key === null) return
  load().set(entryKey(table, key), { table, key, updatedAt, deleted })
  save()
}

/** Everything waiting to be pushed. */
export function pendingOutbox(): OutboxEntry[] {
  return [...load().values()]
}

export function outboxSize(): number {
  return load().size
}

/** Drop the pushed entries, unless the row was written again meanwhile (a newer `updatedAt`). */
export function ackOutbox(pushed: OutboxEntry[]): void {
  const map = load()
  for (const e of pushed) {
    const k = entryKey(e.table, e.key)
    const current = map.get(k)
    if (current && current.updatedAt <= e.updatedAt && current.deleted === e.deleted) map.delete(k)
  }
  save()
}

export function clearOutbox(): void {
  load().clear()
  save()
}
