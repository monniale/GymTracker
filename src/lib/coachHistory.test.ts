import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db, onSyncDirty, withSyncTrackingSuspended } from '../db/db'
import { applyTables, collectTables } from '../db/backup'
import { mergeSnapshots, type SnapshotTables, type SyncPayload } from './merge'
import { backfillCoachHistory, currentNote, deleteJudgement, judgementsFor, saveJudgement } from './coachHistory'
import type { CoachNote } from '../types'

const note = (headline: string): CoachNote => ({ headline, tone: 'positive', insights: [{ category: 'verdict', tone: 'positive', message: 'ok' }] })
const T = (y: number, m: number, d: number, h = 0) => new Date(y, m - 1, d, h).getTime()

/** Node has no localStorage; the backfill marker and the dirty flag live there. */
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

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T(2026, 10, 14, 18))
  vi.stubGlobal('localStorage', memoryStorage())
  db.close()
  await Dexie.delete('gymtracker')
  await db.open()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function addSession(name: string, startedAt: number) {
  return db.sessions.add({ name, startedAt, endedAt: startedAt + 3_600_000, bodyweightKg: 80, extraExerciseIds: [] })
}

describe('stored verdicts', () => {
  it('appends on every save, keeps earlier verdicts and shows the newest', async () => {
    const sid = await addSession('Push', T(2026, 10, 13, 18))
    await saveJudgement({ kind: 'workout', sessionId: sid, note: note('First take'), model: 'gemini-a' })
    vi.setSystemTime(T(2026, 10, 14, 19))
    await saveJudgement({ kind: 'workout', sessionId: sid, note: note('Second take'), model: 'gemini-b' })

    const rows = await judgementsFor('workout', sid)
    expect(rows).toHaveLength(2)
    expect(rows.every(r => r.date === '2026-10-13' && r.title === 'Push')).toBe(true)
    expect(typeof rows[0].id).toBe('string') // UUID: syncs without colliding
    expect((await currentNote('workout', sid))?.headline).toBe('Second take')
  })

  it('is a tracked write, so it syncs like user data', async () => {
    let dirty = 0
    const off = onSyncDirty(() => dirty++)
    await saveJudgement({ kind: 'diet', date: '2026-10-14', note: note('Good day'), model: 'm' })
    off()
    expect(dirty).toBe(1)
    expect((await db.coachHistory.toArray())[0].updatedAt).toBeGreaterThan(0)
    expect((await collectTables()).coachHistory).toHaveLength(1)
  })

  it('falls back to a legacy cached note until one is stored', async () => {
    await withSyncTrackingSuspended(() =>
      db.dietNotes.put({ date: '2026-10-10', note: note('Cached'), model: 'm', generatedAt: 1 }))
    expect((await currentNote('diet', '2026-10-10'))?.headline).toBe('Cached')
    expect(await currentNote('diet', '2026-10-11')).toBeNull()
  })

  it('deletes a verdict with a tombstone and drops the cache row it came from', async () => {
    const sid = await addSession('Pull', T(2026, 10, 12, 18))
    await withSyncTrackingSuspended(() =>
      db.coachNotes.put({ sessionId: sid, note: note('Old'), model: 'm', generatedAt: 42 }))
    await backfillCoachHistory()
    const [row] = await judgementsFor('workout', sid)
    await deleteJudgement(row)
    expect(await currentNote('workout', sid)).toBeNull()
    expect(await db.tombstones.where('deletedAt').above(0).count()).toBe(1)
  })
})

describe('backfillCoachHistory', () => {
  it("copies this device's cached notes once, with their model, time and session", async () => {
    const sid = await addSession('Legs', T(2026, 9, 30, 9))
    await withSyncTrackingSuspended(async () => {
      await db.coachNotes.put({ sessionId: sid, note: note('Leg day'), model: 'gemini-x', generatedAt: 100 })
      await db.dietNotes.put({ date: '2026-10-01', note: note('Diet'), model: 'gemini-y', generatedAt: 200 })
    })
    let dirty = 0
    const off = onSyncDirty(() => dirty++)
    expect(await backfillCoachHistory()).toBe(2)
    off()
    expect(dirty).toBeGreaterThan(0)
    const [w] = await judgementsFor('workout', sid)
    expect(w).toMatchObject({ date: '2026-09-30', title: 'Legs', model: 'gemini-x', generatedAt: 100 })
    const [d] = await judgementsFor('diet', '2026-10-01')
    expect(d).toMatchObject({ model: 'gemini-y', generatedAt: 200 })

    expect(await backfillCoachHistory()).toBe(0) // marker set
    localStorage.clear()
    expect(await backfillCoachHistory()).toBe(0) // idempotent without the marker too
    expect(await db.coachHistory.count()).toBe(2)
  })
})

describe('sync with a build that predates the history', () => {
  const payload = (deviceId: string, tables: SnapshotTables): SyncPayload =>
    ({ app: 'gymtracker', version: 2, exportedAt: Date.now(), deviceId, tables })

  it('keeps local verdicts when a pulled snapshot has no coachHistory, and reports it', async () => {
    await saveJudgement({ kind: 'diet', date: '2026-10-14', note: note('Keep me'), model: 'm' })
    const old = (await collectTables()) as Partial<SnapshotTables>
    delete old.coachHistory
    expect(await applyTables(old as never)).toBe(true)
    expect(await db.coachHistory.count()).toBe(1)
  })

  it('replaces local verdicts when the snapshot carries the table', async () => {
    await saveJudgement({ kind: 'diet', date: '2026-10-14', note: note('Local'), model: 'm' })
    const tables = await collectTables()
    expect(await applyTables({ ...tables, coachHistory: [] })).toBe(false)
    expect(await db.coachHistory.count()).toBe(0)
  })

  it('a merge with a snapshot lacking the table keeps both sides', async () => {
    await saveJudgement({ kind: 'diet', date: '2026-10-14', note: note('Mine'), model: 'm' })
    const local = payload('phone', (await collectTables()) as unknown as SnapshotTables)
    const remoteTables = { ...local.tables, coachHistory: undefined }
    const merged = mergeSnapshots(local, payload('pwa', remoteTables), Date.now())
    expect(merged.tables.coachHistory).toHaveLength(1)
    const back = mergeSnapshots(payload('pwa', remoteTables), local, Date.now())
    expect(back.tables.coachHistory).toHaveLength(1)
  })
})
