import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '../db/db'
import { ensureSeeded } from '../db/seed'
import { followGlobalSeason, runDailyChecks, seasonLastDay } from './season'
import { rankPointsFor } from './merge'
import type { RankState } from '../types'

/* Local times (Europe/Rome, pinned by `npm test`). Only Date is faked: fake-indexeddb needs real timers. */
const T = (y: number, m: number, d: number, h = 0) => new Date(y, m - 1, d, h).getTime()

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T(2026, 10, 28, 10))
  db.close()
  await Dexie.delete('gymtracker')
  await db.open()
  await ensureSeeded()
})

afterEach(() => {
  vi.useRealTimers()
})

const event = (date: string, total: number) =>
  ({ date, total, basePoints: total, prBonus: 0, streakMult: 1, dayFactor: 1, breakdown: [] })

async function rank(patch: Partial<RankState> = {}): Promise<RankState> {
  if (Object.keys(patch).length) await db.rankState.update(1, patch)
  return (await db.rankState.get(1))!
}

const G = { id: 3, startedOn: '2026-10-01', endsOn: '2026-12-23' }

describe('followGlobalSeason', () => {
  it('renumbers a season that started on or after the shared one, keeping its start and points', async () => {
    await rank({ seasonStart: '2026-10-20', points: 120 })
    expect(await followGlobalSeason(G)).toBe(true)
    expect(await rank()).toMatchObject({ seasonId: 3, seasonStart: '2026-10-20', points: 120, sharedSeason: true, seasonEndsOn: '2026-12-23' })
    expect(await db.seasons.count()).toBe(0)
  })

  it('archives a season that started earlier: events since the shared start move into it', async () => {
    await db.scoreEvents.bulkAdd([event('2026-09-10', 400), event('2026-10-05', 100)] as never)
    await rank({ seasonStart: '2026-09-01', points: 500, streakWeeks: 3 })
    expect(await followGlobalSeason(G)).toBe(true)

    const seasons = await db.seasons.toArray()
    expect(seasons).toEqual([expect.objectContaining({
      id: 'season-1-2026-09-01', seasonId: 1, startDate: '2026-09-01', endDate: '2026-09-30', finalPoints: 400,
    })])
    const state = await rank()
    expect(state).toMatchObject({ seasonId: 3, seasonStart: '2026-10-01', points: 80 + 100, streakWeeks: 0, sharedSeason: true })
    // The merge truth agrees, so a later pull's recompute changes nothing.
    expect(rankPointsFor(state, await db.scoreEvents.toArray(), seasons)).toBe(state.points)
  })

  it('on the same season only takes the end day; an older one is ignored', async () => {
    await rank({ seasonId: 3, seasonStart: '2026-10-01', sharedSeason: true, seasonEndsOn: '2026-12-31', points: 50 })
    expect(await followGlobalSeason(G)).toBe(true)
    expect((await rank()).seasonEndsOn).toBe('2026-12-23')
    expect(await followGlobalSeason(G)).toBe(false)
    expect(await followGlobalSeason({ id: 2, startedOn: '2026-07-09', endsOn: '2026-09-30' })).toBe(false)
    expect(await rank()).toMatchObject({ seasonId: 3, points: 50 })
  })

  it('a newer shared season (the admin ended it early) archives the running one', async () => {
    await rank({ seasonId: 3, seasonStart: '2026-10-01', sharedSeason: true, seasonEndsOn: '2026-12-23', points: 300 })
    await db.scoreEvents.add(event('2026-10-10', 300) as never)
    await followGlobalSeason({ id: 4, startedOn: '2026-10-28', endsOn: '2027-01-19' })
    expect(await rank()).toMatchObject({ seasonId: 4, seasonStart: '2026-10-28', seasonEndsOn: '2027-01-19', points: 60 })
    expect((await db.seasons.get('season-3-2026-10-01'))).toMatchObject({ endDate: '2026-10-27', finalPoints: 300 })
  })
})

describe('runDailyChecks on the shared season', () => {
  it('rolls over after the server end day to the season the server will start, skipping missed ones', async () => {
    await rank({
      seasonId: 3, seasonStart: '2026-04-01', sharedSeason: true, seasonEndsOn: '2026-06-23', points: 200,
      lastSessionDate: '2026-10-28',
    })
    await runDailyChecks()
    // 2026-06-24 + 84 = 2026-09-16 (season 5) is the one running on 2026-10-28.
    const state = await rank()
    expect(state).toMatchObject({ seasonId: 5, seasonStart: '2026-09-16', seasonEndsOn: '2026-12-08', points: 40, sharedSeason: true })
    expect(await db.seasons.get('season-3-2026-04-01')).toMatchObject({ endDate: '2026-06-23' })
    expect(seasonLastDay(state)).toBe('2026-12-08')
  })

  it('keeps a device-local season on its 12 weeks from the start', async () => {
    await rank({ seasonStart: '2026-08-01', points: 100, lastSessionDate: '2026-10-28' })
    await runDailyChecks()
    expect(await rank()).toMatchObject({ seasonId: 2, seasonStart: '2026-10-28', points: 20 })
    expect(seasonLastDay(await rank())).toBe('2027-01-19')
  })
})
