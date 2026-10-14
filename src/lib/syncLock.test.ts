import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { db, emitDataReplaced, onDataReplaced } from '../db/db'
import { runDailyChecksOnce } from './season'
import { syncNow, withSyncLock } from './sync'
import { addDays, localDateStr } from './dates'

/** Concurrency helpers added for the Android resume/midnight paths (amendment A7). */

describe('withSyncLock', () => {
  it('runs on the sync chain: a sync queued behind it waits, and vice versa', async () => {
    const order: string[] = []
    let release!: () => void
    const lock = withSyncLock(() => new Promise<string>(r => { release = () => { order.push('lock'); r('done') } }))
    const sync = syncNow('test').then(o => { order.push(`sync:${o}`) })
    await new Promise(r => setTimeout(r, 10))
    expect(order).toEqual([]) // the sync is parked behind the lock
    release()
    expect(await lock).toBe('done')
    await sync
    expect(order).toEqual(['lock', 'sync:disconnected'])
    // …and a lock queued behind a sync runs after it.
    const order2: string[] = []
    const s2 = syncNow('test').then(() => order2.push('sync'))
    const l2 = withSyncLock(async () => { order2.push('lock') })
    await Promise.all([s2, l2])
    expect(order2).toEqual(['sync', 'lock'])
  })

  it('a failing fn rejects to its caller but never poisons the chain', async () => {
    await expect(withSyncLock(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
    // 'disconnected' (not 'error') proves doSync really ran after the failed lock.
    expect(await syncNow('after')).toBe('disconnected')
  })
})

describe('runDailyChecksOnce', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  it('overlapping callers share one run (no duplicate season rollover)', async () => {
    const today = localDateStr()
    await db.rankState.put({
      id: 1, seasonId: 1, seasonStart: addDays(today, -90), points: 1000, streakWeeks: 0, lastStreakWeek: '',
      lastSessionDate: today, idleDecayTaken: 0, lastDecayCheckDate: addDays(today, -1),
    })
    const a = runDailyChecksOnce()
    const b = runDailyChecksOnce()
    expect(b).toBe(a)
    await Promise.all([a, b, runDailyChecksOnce()])
    expect(await db.seasons.count()).toBe(1)
    const st = await db.rankState.get(1)
    expect(st?.seasonId).toBe(2)
    expect(st?.lastDecayCheckDate).toBe(today)
    // Sequential calls still run (and stay idempotent).
    const c = runDailyChecksOnce()
    expect(c).not.toBe(a)
    await c
    expect(await db.seasons.count()).toBe(1)
  })
})

describe('onDataReplaced', () => {
  it('notifies listeners, survives a throwing one, and unsubscribes', () => {
    const calls: string[] = []
    const offA = onDataReplaced(() => calls.push('a'))
    const offBad = onDataReplaced(() => {
      throw new Error('listener bug')
    })
    const offB = onDataReplaced(() => calls.push('b'))
    expect(() => emitDataReplaced()).not.toThrow()
    expect(calls).toEqual(['a', 'b'])
    offA()
    offBad()
    emitDataReplaced()
    expect(calls).toEqual(['a', 'b', 'b'])
    offB()
  })
})
