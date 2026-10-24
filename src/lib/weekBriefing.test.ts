import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '../db/db'
import { ensureSeeded } from '../db/seed'
import {
  lastFinishedMonday, isWeekFinished, weekBounds, weekRangeLabel, weekBodyweight,
  gatherWeekBriefing, formatWeekBriefing, weekStats, WEEK_BRIEFING_MAX_CHARS, type WeekBriefing,
} from './weekBriefing'
import { questsForWeek } from './quests'
import { saveJudgement } from './coachHistory'
import type { CoachNote } from '../types'

const T = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime()
const HOUR = 3_600_000

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

describe('week helpers', () => {
  it('finds the last finished week and when a week is over', () => {
    expect(lastFinishedMonday('2026-10-15')).toBe('2026-10-05')
    expect(lastFinishedMonday('2026-10-12')).toBe('2026-10-05') // Monday: last week just ended
    expect(isWeekFinished('2026-10-05', '2026-10-11')).toBe(false) // its Sunday
    expect(isWeekFinished('2026-10-05', '2026-10-12')).toBe(true)
  })

  it('uses wall-clock bounds across DST (Europe/Rome)', () => {
    const spring = weekBounds('2026-03-23') // clocks go forward on Sun 29 Mar
    expect(spring.endMs - spring.startMs).toBe(7 * 24 * HOUR - HOUR)
    expect(spring.sunday).toBe('2026-03-29')
    const autumn = weekBounds('2026-10-19') // clocks go back on Sun 25 Oct
    expect(autumn.endMs - autumn.startMs).toBe(7 * 24 * HOUR + HOUR)
    expect(new Date(autumn.endMs).getHours()).toBe(0)
  })

  it('labels a week compactly', () => {
    expect(weekRangeLabel('2026-10-12', '2026')).toBe('12–18 Oct')
    expect(weekRangeLabel('2026-09-28', '2026')).toBe('28 Sep – 4 Oct')
    expect(weekRangeLabel('2025-12-29', '2026')).toBe('29 Dec 2025 – 4 Jan 2026')
    expect(weekRangeLabel('2025-10-13', '2026')).toBe('13–19 Oct 2025')
  })

  it('summarises the weigh-ins of the week', () => {
    const log = [
      { date: '2026-10-05', weightKg: 81 }, { date: '2026-10-08', weightKg: 80.6 },
      { date: '2026-10-12', weightKg: 80.4 }, { date: '2026-10-15', weightKg: 80 }, { date: '2026-10-18', weightKg: 79.9 },
    ]
    const bw = weekBodyweight(log, '2026-10-12')
    expect(bw.weekMean).toBe(80.1)
    expect(bw.prevMean).toBe(80.8)
    expect(bw.ratePerWeek).toBeLessThan(0)
  })
})

describe('gatherWeekBriefing', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T(2026, 10, 27, 12))
    vi.stubGlobal('localStorage', memoryStorage())
    db.close()
    await Dexie.delete('gymtracker')
    await db.open()
    await ensureSeeded()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  async function session(name: string, startedAt: number, sets: [number, number, number, boolean?][], points: number) {
    const id = await db.sessions.add({ name, startedAt, endedAt: startedAt + HOUR, bodyweightKg: 80, extraExerciseIds: [] })
    let k = 0
    for (const [exerciseId, weightKg, reps, isWarmup] of sets) {
      await db.sets.add({ sessionId: id, exerciseId, setNumber: ++k, weightKg, reps, isWarmup: !!isWarmup, completedAt: startedAt + k * 60_000, e1rm: weightKg * (1 + reps / 30) })
    }
    const d = new Date(startedAt)
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    await db.scoreEvents.add({
      sessionId: id, date, basePoints: points, prBonus: 0, streakMult: 1, dayFactor: 1, total: points,
      breakdown: [{ exerciseId: sets[0][0], exerciseName: 'Bench Press', setPoints: points, countedSets: 1, totalSets: 1, e1rmPr: true, volumePr: false, bestE1rm: 0 }],
    })
    return id
  }

  it('collects the DST week by wall-clock bounds without awarding anything', async () => {
    await session('Before', T(2026, 10, 18, 23, 30), [[1, 100, 5]], 50) // previous Sunday
    await session('Push', T(2026, 10, 19, 18), [[1, 40, 10, true], [1, 100, 5], [1, 95, 6]], 120)
    await session('Late', T(2026, 10, 25, 23, 30), [[21, 50, 8]], 80) // Sunday after the clocks went back
    await session('After', T(2026, 10, 26, 0, 30), [[1, 105, 5]], 70) // next Monday
    await db.scoreEvents.add({ label: 'Quest: Finish 3 sessions', date: '2026-10-22', basePoints: 15, prBonus: 0, streakMult: 1, dayFactor: 1, total: 15, breakdown: [] })
    const quests = questsForWeek('2026-10-19')
    await db.quests.put({ weekKey: '2026-10-19', quests: [{ id: quests[0].id, done: true }, { id: quests[1].id, done: false }] })
    await saveJudgement({ kind: 'diet', date: '2026-10-21', note: { headline: 'Protein on point', tone: 'positive', insights: [] } as CoachNote, model: 'm' })
    const eventsBefore = await db.scoreEvents.count()

    const b = await gatherWeekBriefing('2026-10-19', '2026-10-27')
    expect(b.finished).toBe(true)
    expect(b.sessions.map(s => s.name)).toEqual(['Push', 'Late'])
    expect(b.sessions[0]).toMatchObject({ workingSets: 2, volumeKg: 1070, points: 120, durationMin: 60 })
    expect(b.sessions[0].exercises).toEqual([{ name: 'Bench Press', sets: 2, best: '100 kg × 5' }])
    expect(b.points).toBe(120 + 80 + 15)
    expect(b.questBonus).toBe(15)
    expect(b.prs).toEqual([{ exercise: 'Bench Press', kind: 'e1RM' }, { exercise: 'Bench Press', kind: 'e1RM' }])
    // Muscle volume stops at the week's end: Monday 00:30's bench set is not in it.
    expect(b.muscles.find(m => m.group === 'chest')?.sets).toBe(2)
    expect(b.quests).toEqual([
      { label: quests[0].label, labelEn: quests[0].labelEn, done: true },
      { label: quests[1].label, labelEn: quests[1].labelEn, done: false },
    ])
    expect(b.verdicts).toEqual([{ kind: 'diet', date: '2026-10-21', headline: 'Protein on point' }])
    expect(await db.scoreEvents.count()).toBe(eventsBefore) // a read never awards quests
    expect(weekStats(b)).toMatchObject({ sessions: 2, points: 215, prs: 2, loggedDays: 0, proteinPerKg: null })
  })

  it('counts bodyweight in the volume of a stamped session only', async () => {
    const pullUp = (await db.exercises.where('nameLower').equals('pull-up').first())!
    const add = async (name: string, startedAt: number, bwScoring: boolean) => {
      const id = await db.sessions.add({
        name, startedAt, endedAt: startedAt + HOUR, bodyweightKg: 80, extraExerciseIds: [], ...(bwScoring ? { bwScoring: true as const } : {}),
      })
      // Stored e1RM as each build would write it: effective load for the stamped one, logged weight before.
      const rows: [number, number, number][] = bwScoring ? [[0, 10, 106.7], [10, 8, 114]] : [[0, 10, 0], [10, 8, 12.7]]
      for (const [k, [weightKg, reps, e1rm]] of rows.entries()) {
        await db.sets.add({ sessionId: id, exerciseId: pullUp.id!, setNumber: k + 1, weightKg, reps, isWarmup: false, completedAt: startedAt + (k + 1) * 60_000, e1rm })
      }
    }
    await add('Old pull', T(2026, 10, 19, 18), false)
    await add('New pull', T(2026, 10, 21, 18), true)
    const b = await gatherWeekBriefing('2026-10-19', '2026-10-27')
    const [old, fresh] = b.sessions
    expect(old).toMatchObject({ name: 'Old pull', volumeKg: 10 * 8 })
    expect(old.exercises).toEqual([{ name: 'Pull-Up', sets: 2, best: '10 kg × 8' }])
    expect(fresh).toMatchObject({ name: 'New pull', volumeKg: 80 * 10 + 90 * 8 })
    expect(fresh.exercises).toEqual([{ name: 'Pull-Up', sets: 2, best: 'BW+10 kg × 8' }])
  })

  it('marks the current week as not finished', async () => {
    const b = await gatherWeekBriefing('2026-10-26', '2026-10-27')
    expect(b.finished).toBe(false)
    expect(b.sessions).toHaveLength(1 - 1)
  })
})

describe('formatWeekBriefing', () => {
  const big: WeekBriefing = {
    monday: '2026-10-12', sunday: '2026-10-18', finished: true, bodyweightKg: 80, weeklyTarget: 4,
    sessions: Array.from({ length: 15 }, (_, i) => ({
      id: i, name: `Session ${i} with a fairly long descriptive name`, date: '2026-10-12', durationMin: 75, points: 120,
      workingSets: 24, volumeKg: 12000,
      exercises: Array.from({ length: 12 }, (_, j) => ({ name: `Exercise number ${j} (machine variant)`, sets: 3, best: '100 kg × 8' })),
    })),
    points: 1800, questBonus: 30,
    prs: Array.from({ length: 12 }, (_, i) => ({ exercise: `Lift ${i}`, kind: 'e1RM' as const })),
    muscles: [], nutrition: { loggedDays: 6, avgKcal: 2400, avgProtein: 170, avgCarbs: 250, avgFat: 70, proteinPerKg: 2.1, adherent: 4, trainingDays: 4 },
    bodyweight: { weekMean: 80.2, prevMean: 80.5, ratePerWeek: -0.3 },
    quests: [{ label: 'Finish 3 sessions', labelEn: 'Finish 3 sessions', done: true }],
    verdicts: [],
  }

  it('stays under the cap and always ends with the instruction', () => {
    const text = formatWeekBriefing(big)
    expect(text.length).toBeLessThanOrEqual(WEEK_BRIEFING_MAX_CHARS)
    expect(text.endsWith("Review THIS WEEK as a whole, then give NEXT WEEK's focus (2–3 concrete actions).")).toBe(true)
    expect(text).toContain('Week: Monday 2026-10-12 to Sunday 2026-10-18')
  })

  it('lists fewer exercises per session before dropping nutrition or bodyweight', () => {
    const text = formatWeekBriefing(big)
    expect(text).toContain('Nutrition: logged 6/7 days')
    expect(text).toContain('4-week trend -0.3 kg/week')
    expect(text).toContain('…and 5 more sessions')
  })

  it('caps sessions, exercises and PRs', () => {
    const small = { ...big, sessions: big.sessions.slice(0, 3).map(s => ({ ...s, name: 'S', exercises: s.exercises.map(e => ({ ...e, name: 'E' })) })) }
    const text = formatWeekBriefing(small)
    expect(text).toContain('…and 4 more exercises')
    expect(formatWeekBriefing({ ...small, sessions: big.sessions.slice(0, 11) })).toContain('…and 1 more sessions')
    expect(text.match(/\(e1RM\)/g)).toHaveLength(8)
    expect(text).toContain('4-week trend -0.3 kg/week')
  })

  it('says when nothing was eaten-logged or weighed', () => {
    const text = formatWeekBriefing({ ...big, sessions: [], prs: [], nutrition: null, bodyweight: { weekMean: null, prevMean: null, ratePerWeek: null }, finished: false })
    expect(text).toContain('(still in progress)')
    expect(text).toContain('Nutrition: no food logged this week')
    expect(text).toContain('Bodyweight: no weigh-ins')
    expect(text).toContain('PRs: none')
  })
})
