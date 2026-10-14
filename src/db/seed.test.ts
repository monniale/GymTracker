import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db, onSyncDirty } from './db'
import { ensureSeeded, DEFAULT_SETTINGS } from './seed'
import { collectTables } from './backup'
import { mergeSnapshots, type SnapshotTables, type SyncPayload } from '../lib/merge'
import { runDailyChecks, registerSessionForStreak } from '../lib/season'

/* Local times (Europe/Rome, pinned by `npm test`). Only Date is faked: fake-indexeddb needs real timers. */
const T = (y: number, m: number, d: number, h = 0) => new Date(y, m - 1, d, h).getTime()

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T(2026, 10, 12, 10))
  db.close()
  await Dexie.delete('gymtracker')
  await db.open()
})

afterEach(() => {
  vi.useRealTimers()
})

const snapshot = (deviceId: string, tables: SnapshotTables): SyncPayload =>
  ({ app: 'gymtracker', version: 2, exportedAt: Date.now(), deviceId, tables })

describe('ensureSeeded', () => {
  it('writes the defaults unstamped (updatedAt 0) and does not mark the device dirty', async () => {
    let dirty = 0
    const off = onSyncDirty(() => dirty++)
    await ensureSeeded()
    off()
    const exercises = await db.exercises.toArray()
    expect(exercises.length).toBeGreaterThan(10)
    expect(exercises.every(e => e.updatedAt === 0)).toBe(true)
    expect((await db.settings.get(1))?.updatedAt).toBe(0)
    expect((await db.rankState.get(1))?.updatedAt).toBe(0)
    expect(dirty).toBe(0)
  })

  it("a fresh install's 'Merge both' keeps the other device's real rows", async () => {
    await ensureSeeded()
    await db.foodLogs.add({ date: '2026-10-12', meal: 'lunch', foodId: 'f-1', grams: 100, loggedAt: Date.now() })
    const local = snapshot('phone', (await collectTables()) as unknown as SnapshotTables)

    const real = T(2026, 9, 1)
    const bench = (await db.exercises.get(1))!
    const remote = snapshot('pwa', {
      ...(await collectTables()) as unknown as SnapshotTables,
      exercises: local.tables.exercises
        .filter(e => e.id !== 2)
        .map(e => (e.id === 1 ? { ...bench, defaultRestSec: 210, updatedAt: real } : { ...e, updatedAt: real - 1000 })),
      settings: [{ ...DEFAULT_SETTINGS, kcalTarget: 3100, updatedAt: real }],
      rankState: [{
        id: 1, seasonId: 1, seasonStart: '2026-08-31', points: 0, streakWeeks: 6, lastStreakWeek: '2026-10-05',
        lastSessionDate: '2026-10-09', idleDecayTaken: 0, lastDecayCheckDate: '2026-10-09', updatedAt: real,
      }],
      tombstones: [{ id: 't-1', table: 'exercises', rowId: 2, deletedAt: real }],
      foodLogs: [],
    })

    const m = mergeSnapshots(local, remote, Date.now()).tables
    expect(m.settings[0].kcalTarget).toBe(3100)
    expect(m.exercises.find(e => e.id === 1)?.defaultRestSec).toBe(210)
    expect(m.exercises.some(e => e.id === 2)).toBe(false)
    expect(m.rankState[0]).toMatchObject({ seasonStart: '2026-08-31', streakWeeks: 6, lastStreakWeek: '2026-10-05' })
    expect(m.foodLogs).toHaveLength(1)
  })

  it('the daily checks leave the untouched seed rank state unstamped, a real one is stamped as before', async () => {
    await ensureSeeded()
    vi.setSystemTime(T(2026, 10, 13, 10))
    await runDailyChecks()
    expect((await db.rankState.get(1))?.updatedAt).toBe(0)

    await registerSessionForStreak(Date.now())
    const touched = (await db.rankState.get(1))!.updatedAt
    expect(touched).toBeGreaterThan(0)
    vi.setSystemTime(T(2026, 10, 14, 10))
    await runDailyChecks()
    const after = (await db.rankState.get(1))!
    expect(after.lastDecayCheckDate).toBe('2026-10-14')
    expect(after.updatedAt).toBeGreaterThan(touched!)
  })
})
