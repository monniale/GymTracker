import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../db/db'
import { ensureSeeded } from '../db/seed'
import { ADJUSTMENT_LABEL, isAdjustment } from './pointsAdjust'
import { fixAfterPull } from './cloudFixups'
import { displayEventLabel } from './quests'

beforeEach(async () => {
  db.close()
  await Dexie.delete('gymtracker')
  await db.open()
  await ensureSeeded()
})

const event = (id: string, date: string, total: number, label?: string) =>
  ({ id, date, total, label, basePoints: 0, prBonus: 0, streakMult: 1, dayFactor: 1, breakdown: [] })

describe('points adjustments', () => {
  it('are told apart from session scores and quest awards', () => {
    expect(isAdjustment({ label: ADJUSTMENT_LABEL })).toBe(true)
    expect(isAdjustment({ label: 'Quest: Finish 3 sessions' })).toBe(false)
    expect(isAdjustment({ sessionId: 's1' })).toBe(false)
  })

  it('show the stored English label in the UI language', () => {
    expect(displayEventLabel(ADJUSTMENT_LABEL)).toBe('Points adjustment')
  })

  it('pulled from the admin: two on one day both count, and the points follow', async () => {
    await db.rankState.update(1, { seasonStart: '2026-10-01', points: 383 })
    await db.scoreEvents.bulkAdd([
      event('a', '2026-10-05', 383),
      event('b', '2026-10-29', 697, ADJUSTMENT_LABEL),
      event('c', '2026-10-29', -80, ADJUSTMENT_LABEL),
    ] as never)
    await fixAfterPull(new Set(['scoreEvents']))
    expect(await db.scoreEvents.count()).toBe(3)
    expect((await db.rankState.get(1))!.points).toBe(1000)
  })
})
