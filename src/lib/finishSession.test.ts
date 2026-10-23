import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '../db/db'
import { ensureSeeded } from '../db/seed'
import { finishSession, rescoreSession, gatherSeasonPriorBests, refreshStampedE1rm } from './finishSession'
import { scoreSession, epley, SCORING } from './scoring'
import { setE1rm, toScoreSets } from './load'
import type { Exercise, Id, Session, SetRow } from '../types'

const T = (y: number, m: number, d: number, h = 18) => new Date(y, m - 1, d, h).getTime()

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

let pullUp: Exercise
let bench: Exercise

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T(2026, 10, 15, 12))
  vi.stubGlobal('localStorage', memoryStorage())
  db.close()
  await Dexie.delete('gymtracker')
  await db.open()
  await ensureSeeded()
  await db.rankState.update(1, { seasonStart: '2026-10-01', points: 500 })
  pullUp = (await db.exercises.where('nameLower').equals('pull-up').first())!
  bench = (await db.exercises.where('nameLower').equals('bench press').first())!
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/** A session with its sets; e1rm stored the way the logging screens store it (setE1rm). */
async function addSession(
  id: string,
  startedAt: number,
  rows: [ex: Exercise, weightKg: number, reps: number][],
  opts: { bwScoring?: true; endedAt?: number } = {},
): Promise<Session> {
  const session: Session = {
    id, name: id, startedAt, bodyweightKg: 80, extraExerciseIds: [], endedAt: opts.endedAt,
    ...(opts.bwScoring ? { bwScoring: true as const } : {}),
  }
  await db.sessions.put(session)
  const sets: SetRow[] = rows.map(([ex, weightKg, reps], i) => ({
    id: `${id}-${i}`, sessionId: id, exerciseId: ex.id!, setNumber: i + 1, weightKg, reps, isWarmup: false,
    completedAt: startedAt + i * 60_000, e1rm: setE1rm({ weightKg, reps }, ex, session),
  }))
  await db.sets.bulkPut(sets)
  return session
}

const breakdownOf = async (sid: Id, ex: Exercise) =>
  (await db.scoreEvents.where('sessionId').equals(sid).first())!.breakdown.find(b => b.exerciseId === ex.id)

describe('bodyweight load in finishSession', () => {
  it('a first stamped pull-up session after old 0-kg rows scores but fires no PR', async () => {
    await addSession('old1', T(2026, 10, 2), [[pullUp, 0, 10], [pullUp, 0, 10]], { endedAt: T(2026, 10, 2, 19) })
    await addSession('old2', T(2026, 10, 5), [[pullUp, 0, 12]], { endedAt: T(2026, 10, 5, 19) })
    await addSession('new', T(2026, 10, 15, 10), [[pullUp, 0, 8], [pullUp, 0, 8], [pullUp, 0, 8]], { bwScoring: true })

    const priors = await gatherSeasonPriorBests('new', await db.sets.where('sessionId').equals('new').toArray())
    expect(priors.e1rm.has(pullUp.id!)).toBe(false)
    expect(priors.volume.has(pullUp.id!)).toBe(false)

    const total = await finishSession('new')
    expect(total).toBeGreaterThan(0)
    const b = await breakdownOf('new', pullUp)
    expect(b).toMatchObject({ e1rmPr: false, volumePr: false, countedSets: 3 })
    expect(b!.bestE1rm).toBeCloseTo(epley(80, 8), 1)
    expect((await db.scoreEvents.where('sessionId').equals('new').first())!.prBonus).toBe(0)
  })

  it('old weighted rows of an unstamped session never set a bar for a stamped one', async () => {
    // Before this feature "10 kg" on a pull-up meant 10 kg scored, not bodyweight + 10.
    await addSession('old', T(2026, 10, 2), [[pullUp, 10, 8]], { endedAt: T(2026, 10, 2, 19) })
    await addSession('new', T(2026, 10, 15, 10), [[pullUp, 0, 8]], { bwScoring: true })
    await finishSession('new')
    expect(await breakdownOf('new', pullUp)).toMatchObject({ e1rmPr: false, volumePr: false })
  })

  it('BW 80 × 8 at factor 1.0 scores, and a heavier second stamped session sets an e1RM PR', async () => {
    await addSession('s1', T(2026, 10, 13, 10), [[pullUp, 0, 8], [pullUp, 0, 8]], { bwScoring: true })
    const first = await finishSession('s1')
    expect(first).toBeGreaterThan(0)
    expect(await breakdownOf('s1', pullUp)).toMatchObject({ e1rmPr: false, volumePr: false })

    await addSession('s2', T(2026, 10, 15, 10), [[pullUp, 5, 8], [pullUp, 5, 8]], { bwScoring: true })
    const priors = await gatherSeasonPriorBests('s2', await db.sets.where('sessionId').equals('s2').toArray())
    expect(priors.e1rm.get(pullUp.id!)).toBeCloseTo(epley(80, 8))
    expect(priors.volume.get(pullUp.id!)).toBe(80 * 8 * 2)
    await finishSession('s2')
    const b = await breakdownOf('s2', pullUp)
    expect(b).toMatchObject({ e1rmPr: true, volumePr: true })
    expect(b!.bestE1rm).toBeCloseTo(epley(85, 8), 1)
  })

  it('rescoring an unstamped session reproduces its old total (0-kg pull-ups never score)', async () => {
    await addSession('prev', T(2026, 10, 2), [[bench, 75, 8], [bench, 75, 8], [pullUp, 0, 10]], { endedAt: T(2026, 10, 2, 19) })
    // A stamped session in the same season must not leak into the old one's priors.
    await addSession('later', T(2026, 10, 12), [[pullUp, 10, 10], [bench, 70, 8]], { bwScoring: true, endedAt: T(2026, 10, 12, 19) })
    const rows: [Exercise, number, number][] = [[bench, 80, 8], [bench, 80, 8], [bench, 80, 6], [pullUp, 0, 10], [pullUp, 0, 8]]
    await addSession('old', T(2026, 10, 7), rows, { endedAt: T(2026, 10, 7, 19) })
    await db.scoreEvents.add({
      sessionId: 'old', date: '2026-10-07', basePoints: 0, prBonus: 0, streakMult: 1.05, dayFactor: 1, total: 0, breakdown: [],
    })

    // The old (pre-bodyweight-load) computation: raw weightKg, priors from every other row.
    const sets = await db.sets.where('sessionId').equals('old').toArray()
    const expected = scoreSession({
      sets,
      bodyweightKg: 80,
      priorBestE1rm: new Map<Id, number>([[bench.id!, epley(75, 8)], [pullUp.id!, 0]]),
      priorBestVolume: new Map<Id, number>([[bench.id!, 75 * 8 * 2], [pullUp.id!, 0]]),
      streakWeeks: 1,
      isFirstSessionOfDay: true,
      exerciseNames: new Map<Id, string>([[bench.id!, 'Bench Press'], [pullUp.id!, 'Pull-Up']]),
    })
    expect(expected.total).toBeGreaterThan(0)
    expect(expected.breakdown.map(b => b.exerciseId)).toEqual([bench.id])

    const total = await rescoreSession('old')
    expect(total).toBe(expected.total)
    const ev = (await db.scoreEvents.where('sessionId').equals('old').first())!
    expect(ev.breakdown).toEqual(expected.breakdown)
    expect(ev.basePoints).toBe(expected.basePoints)
    expect(ev.prBonus).toBe(expected.prBonus)
  })

  it('rescoring an unstamped session keeps the PR its weighted pull-ups earned over 0-kg rows', async () => {
    // Before this feature a 0-kg prior row was a best of 0, so the first weighted
    // pull-up session fired a PR; re-scoring that old session must keep it.
    await addSession('prev', T(2026, 10, 2), [[pullUp, 0, 10]], { endedAt: T(2026, 10, 2, 19) })
    await addSession('old', T(2026, 10, 7), [[pullUp, 10, 8], [pullUp, 10, 6]], { endedAt: T(2026, 10, 7, 19) })
    await db.scoreEvents.add({
      sessionId: 'old', date: '2026-10-07', basePoints: 0, prBonus: 0, streakMult: 1, dayFactor: 1, total: 0, breakdown: [],
    })
    const sets = await db.sets.where('sessionId').equals('old').toArray()
    const expected = scoreSession({
      sets,
      bodyweightKg: 80,
      priorBestE1rm: new Map<Id, number>([[pullUp.id!, 0]]),
      priorBestVolume: new Map<Id, number>([[pullUp.id!, 0]]),
      streakWeeks: 0,
      isFirstSessionOfDay: true,
      exerciseNames: new Map<Id, string>([[pullUp.id!, 'Pull-Up']]),
    })
    expect(expected.breakdown[0]).toMatchObject({ e1rmPr: true, volumePr: true })
    const total = await rescoreSession('old')
    expect(total).toBe(expected.total)
    const ev = (await db.scoreEvents.where('sessionId').equals('old').first())!
    expect(ev.breakdown).toEqual(expected.breakdown)
    expect(ev.prBonus).toBe(expected.prBonus)
  })

  it('a stamped session ignores 0-e1RM priors of a loaded exercise (no fake first PR)', async () => {
    // Not a bodyweight move, so the same-stamp filter does not apply: only the e1rm > 0 guard does.
    const machine = (await db.exercises.where('nameLower').equals('chest press machine').first())!
    await addSession('zeroOld', T(2026, 10, 2), [[machine, 0, 10]], { endedAt: T(2026, 10, 2, 19) })
    await addSession('zeroNew', T(2026, 10, 5), [[machine, 0, 12]], { bwScoring: true, endedAt: T(2026, 10, 5, 19) })
    await addSession('new', T(2026, 10, 15, 10), [[machine, 20, 10]], { bwScoring: true })
    const priors = await gatherSeasonPriorBests('new', await db.sets.where('sessionId').equals('new').toArray())
    expect(priors.e1rm.has(machine.id!)).toBe(false)
    expect(priors.volume.has(machine.id!)).toBe(false)
    await finishSession('new')
    expect(await breakdownOf('new', machine)).toMatchObject({ e1rmPr: false, volumePr: false })
  })

  it('a stamped assisted row whose load floors to 0 is no prior best', async () => {
    await addSession('assisted', T(2026, 10, 5), [[pullUp, -80, 8]], { bwScoring: true, endedAt: T(2026, 10, 5, 19) })
    await addSession('new', T(2026, 10, 15, 10), [[pullUp, -60, 8]], { bwScoring: true })
    const priors = await gatherSeasonPriorBests('new', await db.sets.where('sessionId').equals('new').toArray())
    expect(priors.e1rm.has(pullUp.id!)).toBe(false)
    expect(priors.volume.has(pullUp.id!)).toBe(false)
  })
})

describe('changing a bodyweight share', () => {
  it('fires no fake PR: prior bests read the same factor as the session scored', async () => {
    const pushUp = (await db.exercises.where('nameLower').equals('push-up').first())!
    await addSession('past', T(2026, 10, 10), [[pushUp, 0, 15]], { bwScoring: true, endedAt: T(2026, 10, 10, 19) })
    await finishSession('past')
    // Factor 0.64 → 1.0 without refreshing the stored e1rm (e.g. synced from another device).
    await db.exercises.update(pushUp.id!, { bwFactor: 1 })
    await addSession('new', T(2026, 10, 15, 10), [[pushUp, 0, 15]], { bwScoring: true })
    const priors = await gatherSeasonPriorBests('new', await db.sets.where('sessionId').equals('new').toArray())
    expect(priors.e1rm.get(pushUp.id!)).toBeCloseTo(epley(80, 15))
    expect(priors.volume.get(pushUp.id!)).toBe(80 * 15)
    await finishSession('new')
    expect(await breakdownOf('new', pushUp)).toMatchObject({ e1rmPr: false, volumePr: false })
  })

  it('refreshes the stored e1rm of stamped sets only, and an edit re-scores at the new share', async () => {
    const pushUp = (await db.exercises.where('nameLower').equals('push-up').first())!
    await addSession('unstamped', T(2026, 10, 3), [[pushUp, 0, 20]], { endedAt: T(2026, 10, 3, 19) })
    await addSession('past', T(2026, 10, 10), [[pushUp, 0, 15], [pushUp, 0, 15]], { bwScoring: true, endedAt: T(2026, 10, 10, 19) })
    await finishSession('past')
    const before = (await db.scoreEvents.where('sessionId').equals('past').first())!
    expect((await db.sets.get('past-0'))!.e1rm).toBeCloseTo(epley(51.2, 15))

    const next = { ...pushUp, bwFactor: 1 }
    await db.exercises.update(pushUp.id!, { bwFactor: 1 })
    expect(await refreshStampedE1rm(next)).toBe(2)
    expect((await db.sets.get('past-0'))!.e1rm).toBeCloseTo(epley(80, 15))
    expect((await db.sets.get('unstamped-0'))!.e1rm).toBe(0)
    // Points already earned stay until the workout is edited.
    expect((await db.scoreEvents.where('sessionId').equals('past').first())!.total).toBe(before.total)

    const sets = await db.sets.where('sessionId').equals('past').toArray()
    const session = (await db.sessions.get('past'))!
    const expected = scoreSession({
      sets: toScoreSets(sets, new Map([[pushUp.id!, next]]), session),
      bodyweightKg: 80,
      priorBestE1rm: new Map(),
      priorBestVolume: new Map(),
      streakWeeks: Math.round((before.streakMult - 1) / SCORING.streakStep),
      isFirstSessionOfDay: before.dayFactor === 1,
      exerciseNames: new Map<Id, string>([[pushUp.id!, 'Push-Up']]),
    })
    expect(expected.total).toBeGreaterThan(before.total)
    expect(await rescoreSession('past')).toBe(expected.total)
  })
})
