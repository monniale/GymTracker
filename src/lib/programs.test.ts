import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { readFileSync } from 'node:fs'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '../db/db'
import { ensureSeeded } from '../db/seed'
import { applyTables, collectTables } from '../db/backup'
import {
  activeProgram, applySessionProgression, installPreset, lastProgramSession, loadPrograms,
  nextProgramTemplate, presetProgramFile, programForTemplate,
} from './programs'
import type { Id, Session, SetRow, WorkoutTemplate } from '../types'

const T = (y: number, m: number, d: number, h = 0) => new Date(y, m - 1, d, h).getTime()
const NOW = T(2026, 10, 23, 18) // Friday; that week's Monday is 2026-10-19

const PUBLIC = new URL('../../public/', import.meta.url)
/** Served at `${BASE_URL}<name>`. */
const files: Record<string, string> = {
  'programs.json': readFileSync(new URL('programs.json', PUBLIC), 'utf8'),
  'exercise-library.json': readFileSync(new URL('exercise-library.json', PUBLIC), 'utf8'),
}

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

async function freshDb() {
  db.close()
  await Dexie.delete('gymtracker')
  await db.open()
  await ensureSeeded()
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('fetch', async (url: string) => {
    const u = String(url)
    const body = u.startsWith(import.meta.env.BASE_URL) ? files[u.slice(import.meta.env.BASE_URL.length)] : undefined
    return body === undefined ? new Response('', { status: 404 }) : new Response(body, { status: 200 })
  })
  await freshDb()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function templatesOf(programId: Id): Promise<WorkoutTemplate[]> {
  const p = (await db.programs.get(programId))!
  return (await db.templates.bulkGet(p.templateIds)) as WorkoutTemplate[]
}

async function exerciseIdByName(name: string): Promise<Id> {
  return (await db.exercises.where('nameLower').equals(name.toLowerCase()).first())!.id!
}

let setSeq = 0
function sets(sessionId: Id, exerciseId: Id, weightKg: number, reps: number[], extra: Partial<SetRow> = {}): SetRow[] {
  return reps.map((r, i) => ({
    id: `set-${++setSeq}`, sessionId, exerciseId, setNumber: i + 1, weightKg, reps: r,
    isWarmup: false, completedAt: NOW + i * 60_000, e1rm: weightKg * (1 + r / 30), ...extra,
  }))
}

async function finishedSession(id: string, templateId: Id | undefined, startedAt = NOW, extra: Partial<Session> = {}): Promise<Id> {
  await db.sessions.add({
    id, ...(templateId !== undefined ? { templateId } : {}), name: 'Workout', startedAt, endedAt: startedAt + 3_600_000,
    bodyweightKg: 80, extraExerciseIds: [], bwScoring: true, ...extra,
  })
  return id
}

/** Logs the prescribed reps of every set of a percent line at its % of `tm` (whole kg). */
function prescribedRows(sessionId: Id, exerciseId: Id, plan: { pct?: number; reps: number }[], tm: number): SetRow[] {
  return plan.map((p, i) => ({
    id: `set-${++setSeq}`, sessionId, exerciseId, setNumber: i + 1, weightKg: Math.round((p.pct ?? 0) * tm), reps: p.reps,
    isWarmup: false, completedAt: NOW + i * 60_000, e1rm: 1,
  }))
}

describe('presets file', () => {
  it('loads the bundled presets with both languages', async () => {
    const presets = await loadPrograms()
    expect(presets.map(p => p.id)).toEqual(expect.arrayContaining([
      'starting-strength', 'stronglifts-5x5', 'gzclp', '531-bbb', 'nsuns-5day', 'reddit-ppl', 'phul',
      'upper-lower-4day', 'full-body-3x',
    ]))
    for (const p of presets) {
      expect(p.name.en && p.name.it && p.description.en && p.description.it).toBeTruthy()
      for (const t of p.templates) expect(t.name.en && t.name.it).toBeTruthy()
    }
    const it = presetProgramFile(presets.find(p => p.id === 'gzclp')!, 'it')
    expect(it.schema).toBe('gymtracker-program/v1')
    expect(it.templates[0].name).toBe('Giorno A1')
  })
})

describe('installPreset', () => {
  it('reuses catalog and library rows: two installs share every exercise, each gets its own program', async () => {
    const before = await db.exercises.count()
    await db.templates.add({ id: 'mine', name: 'Mine', position: 4, items: [], updatedAt: 1 })

    const first = await installPreset('starting-strength', 'en')
    const afterFirst = await db.exercises.count()
    // Every Starting Strength lift is in the catalog except the power clean (a library row).
    expect(afterFirst).toBe(before + 1)
    expect(await db.exercises.get('lib-0648')).toMatchObject({ name: 'Power Clean', libraryId: '0648' })

    const second = await installPreset('starting-strength', 'en')
    expect(second).not.toBe(first)
    expect(await db.exercises.count()).toBe(afterFirst)
    expect(await db.programs.count()).toBe(2)

    const a = await templatesOf(first)
    const b = await templatesOf(second)
    expect(a.map(t => t.name)).toEqual(['Workout A', 'Workout B'])
    expect(b.map(t => t.items.map(i => i.exerciseId))).toEqual(a.map(t => t.items.map(i => i.exerciseId)))
    // Positions follow the existing templates.
    expect([...a, ...b].map(t => t.position)).toEqual([5, 6, 7, 8])
    expect(a[0].items[0]).toMatchObject({ exerciseId: await exerciseIdByName('Squat'), targetSets: 3, targetReps: 5 })
    expect(a[0].items[0].scheme).toEqual({ kind: 'linear', stepKg: 5, failsToDeload: 3, deloadPct: 0.1 })

    // The new install is the active one; the earlier one is stopped.
    const p1 = (await db.programs.get(first))!
    const p2 = (await db.programs.get(second))!
    expect(p1.endedAt).toBeDefined()
    expect(p2).toMatchObject({ presetId: 'starting-strength', cycleStartDate: '2026-10-19', name: 'Starting Strength' })
    expect(p2.endedAt).toBeUndefined()
    expect((await activeProgram())?.id).toBe(second)
  })

  it('gives the same exercise ids on another device', async () => {
    const ids = async () => {
      const p = await installPreset('starting-strength', 'en')
      return (await templatesOf(p)).flatMap(t => t.items.map(i => i.exerciseId))
    }
    const here = await ids()
    await freshDb()
    expect(await ids()).toEqual(here)
  })

  it('names the program and templates in the UI language, keeps cycle weeks and notes', async () => {
    const id = await installPreset('531-bbb', 'it')
    const p = (await db.programs.get(id))!
    expect(p.cycleWeeks).toBe(4)
    expect(p.notes).toMatch(/massimale/)
    expect((await templatesOf(id)).map(t => t.name)[0]).toBe('Giorno lento avanti')
    // Stored exercise names stay English.
    const ohp = (await db.exercises.get((await templatesOf(id))[0].items[0].exerciseId))!
    expect(ohp.name).toBe('Overhead Press')
  })

  it('rejects an unknown preset', async () => {
    await expect(installPreset('nope', 'en')).rejects.toThrow(/nope/)
  })
})

describe('programForTemplate', () => {
  it('finds the program listing a template, the active one first', async () => {
    const t = { id: 'ta', name: 'A', position: 0, items: [], updatedAt: 1 }
    await db.templates.add(t)
    await db.programs.add({ id: 'old', name: 'Old', templateIds: ['ta'], cycleStartDate: '2026-09-07', endedAt: 5 })
    await db.programs.add({ id: 'run', name: 'Run', templateIds: ['ta'], cycleStartDate: '2026-10-19' })
    expect((await programForTemplate('ta'))?.id).toBe('run')
    expect(await programForTemplate('other')).toBeUndefined()
  })
})

describe('nextProgramTemplate', () => {
  const tpl = (id: string, position: number, weekdays?: number[]) => ({ id, position, ...(weekdays ? { weekdays } : {}) })
  // Program order differs from the template list order.
  const templates = [tpl('a', 0), tpl('b', 1), tpl('c', 2), tpl('x', 3)]
  const program = { templateIds: ['c', 'a', 'b'] }
  const done = (templateId: string) => ({ templateId, startedAt: T(2026, 10, 21, 18) })

  it('rotates in program order and wraps', () => {
    expect(nextProgramTemplate(program, templates, undefined, '2026-10-23')?.template.id).toBe('c')
    expect(nextProgramTemplate(program, templates, done('c'), '2026-10-23')?.template.id).toBe('a')
    expect(nextProgramTemplate(program, templates, done('a'), '2026-10-23')?.template.id).toBe('b')
    expect(nextProgramTemplate(program, templates, done('b'), '2026-10-23')).toEqual({ template: templates[2], reason: 'rotation' })
  })

  it('skips templates outside the program or deleted, restarts after a foreign session', () => {
    expect(nextProgramTemplate({ templateIds: ['gone', 'b'] }, templates, undefined, '2026-10-23')?.template.id).toBe('b')
    expect(nextProgramTemplate(program, templates, done('x'), '2026-10-23')?.template.id).toBe('c')
    expect(nextProgramTemplate({ templateIds: ['gone'] }, templates, undefined, '2026-10-23')).toBeNull()
  })

  it('a template scheduled today wins', () => {
    const scheduled = [tpl('a', 0), tpl('b', 1, [5]), tpl('c', 2)] // 5 = Friday
    expect(nextProgramTemplate(program, scheduled, done('c'), '2026-10-23')).toEqual({ template: scheduled[1], reason: 'today' })
  })

  it('lastProgramSession ignores sessions of other templates and unfinished ones', async () => {
    await finishedSession('s1', 'a', T(2026, 10, 19, 18))
    await finishedSession('s2', 'x', T(2026, 10, 21, 18))
    await db.sessions.add({ id: 's3', templateId: 'b', name: 'B', startedAt: T(2026, 10, 22, 18), bodyweightKg: 80, extraExerciseIds: [] })
    expect((await lastProgramSession(program))?.id).toBe('s1')
  })
})

describe('applySessionProgression', () => {
  it('writes linear progress once per session', async () => {
    const pid = await installPreset('stronglifts-5x5', 'en')
    const [a] = await templatesOf(pid)
    const squat = await exerciseIdByName('Squat')
    const bench = await exerciseIdByName('Bench Press')
    const sid = await finishedSession('s1', a.id!)
    await db.sets.bulkAdd([
      ...sets(sid, squat, 20, [5], { isWarmup: true }),
      ...sets(sid, squat, 100, [5, 5, 5, 5, 5]),
      ...sets(sid, bench, 60, [5, 5, 5, 4, 3]),
      // The row is left out of this workout.
    ])

    await applySessionProgression(sid)
    const t1 = (await db.templates.get(a.id!))!
    expect(t1.items[0].progress).toMatchObject({ lastSessionId: 's1', lastOutcome: 'pass', failStreak: 0, nextWeightKg: 102.5 })
    expect(t1.items[1].progress).toMatchObject({ lastSessionId: 's1', lastOutcome: 'fail', failStreak: 1, nextWeightKg: 60 })
    expect(t1.items[2].progress).toBeUndefined()

    // A second call is a no-op: no write at all.
    vi.setSystemTime(NOW + 60_000)
    await applySessionProgression(sid)
    const t2 = (await db.templates.get(a.id!))!
    expect(t2.updatedAt).toBe(t1.updatedAt)
    expect(t2.items).toEqual(t1.items)
  })

  it('ignores freestyle sessions and items swapped for another exercise', async () => {
    const pid = await installPreset('stronglifts-5x5', 'en')
    const [a] = await templatesOf(pid)
    const squat = await exerciseIdByName('Squat')
    const front = await exerciseIdByName('Front Squat')
    // A real freestyle session (no template) writes nothing at all.
    await finishedSession('free', undefined)
    await db.sets.bulkAdd(sets('free', squat, 100, [5, 5, 5, 5, 5]))
    const before = await db.templates.toArray()
    const squatBefore = await db.exercises.get(squat)
    vi.setSystemTime(NOW + 60_000)
    await applySessionProgression('free')
    expect(await db.templates.toArray()).toEqual(before)
    expect(await db.exercises.get(squat)).toEqual(squatBefore)
    const sid = await finishedSession('s1', a.id!, NOW, { swaps: [{ from: squat, to: front }] })
    await db.sets.bulkAdd([...sets(sid, front, 80, [5, 5, 5, 5, 5]), ...sets(sid, squat, 100, [5, 5, 5, 5, 5])])
    await applySessionProgression(sid)
    expect((await db.templates.get(a.id!))!.items[0].progress).toBeUndefined()
  })

  it('bumps and persists the training max at the end of a 5/3/1 cycle, once', async () => {
    const pid = await installPreset('531-bbb', 'en')
    const [press] = await templatesOf(pid)
    const ohp = press.items[0].exerciseId
    await db.exercises.update(ohp, { trainingMaxKg: 60 })
    // Week 4 of the cycle: started three Mondays before this one.
    await db.programs.update(pid, { cycleStartDate: '2026-09-28' })
    const sid = await finishedSession('s1', press.id!)
    await db.sets.bulkAdd(sets(sid, ohp, 25, [5, 5, 5]))

    await applySessionProgression(sid)
    expect((await db.exercises.get(ohp))!.trainingMaxKg).toBe(62.5)
    expect((await db.templates.get(press.id!))!.items[0].progress?.lastSessionId).toBe('s1')
    await applySessionProgression(sid)
    expect((await db.exercises.get(ohp))!.trainingMaxKg).toBe(62.5)
  })

  it('keeps the training max mid-cycle and bumps nSuns by the AMRAP reps', async () => {
    const bbb = await installPreset('531-bbb', 'en')
    const [press] = await templatesOf(bbb)
    const ohp = press.items[0].exerciseId
    await db.exercises.update(ohp, { trainingMaxKg: 60 })
    const s1 = await finishedSession('s1', press.id!) // week 1
    await db.sets.bulkAdd(sets(s1, ohp, 40, [5, 5, 8, 10, 10, 10, 10, 10]))
    await applySessionProgression(s1)
    expect((await db.exercises.get(ohp))!.trainingMaxKg).toBe(60)
    // It ran (the outcome is recorded) and chose not to bump.
    expect((await db.templates.get(press.id!))!.items[0].progress).toMatchObject({ lastSessionId: 's1', lastOutcome: 'pass' })

    const ns = await installPreset('nsuns-5day', 'en')
    const day2 = (await templatesOf(ns))[1]
    const squat = day2.items[0].exerciseId
    await db.exercises.update(squat, { trainingMaxKg: 100 })
    const s2 = await finishedSession('s2', day2.id!)
    // The third set (95 % × 1+) is the AMRAP: 4 reps → +5 kg.
    await db.sets.bulkAdd(sets(s2, squat, 95, [5, 3, 4, 3, 3, 3, 5, 5, 5]))
    await applySessionProgression(s2)
    expect((await db.exercises.get(squat))!.trainingMaxKg).toBe(105)
  })
})

describe('applySessionProgression: whole programs', () => {
  it('nSuns: one week of prescribed reps moves each training max once', async () => {
    const pid = await installPreset('nsuns-5day', 'en')
    const days = await templatesOf(pid)
    const lifts = [...new Set(days.flatMap(d => d.items.map(i => i.exerciseId)))]
    for (const id of lifts) await db.exercises.update(id, { trainingMaxKg: 100 })
    for (const [d, day] of days.entries()) {
      const sid = await finishedSession(`d${d + 1}`, day.id!, NOW + d * 60_000)
      for (const item of day.items) await db.sets.bulkAdd(prescribedRows(sid, item.exerciseId, item.sets!, 100))
      await applySessionProgression(sid)
    }
    const tmOf = async (day: number, line: number) => (await db.exercises.get(days[day].items[line].exerciseId))!.trainingMaxKg
    const names = await Promise.all(days.map(async d => (await db.exercises.get(d.items[1].exerciseId))!.name))
    expect(names.slice(1)).toEqual(['Sumo Deadlift', 'Incline Bench Press', 'Front Squat', 'Close-Grip Bench Press'])
    // T1 with the 1+ set done for exactly 1 rep: no change. Day 1 bench and the Day 1 press
    // (same lifts as the Day 5 and Day 3 T1) never move the training max.
    expect([await tmOf(0, 0), await tmOf(0, 1), await tmOf(1, 0), await tmOf(3, 0)]).toEqual([100, 100, 100, 100])
    // T2 lifts with their own training max: their weekly step, every set done.
    expect([await tmOf(1, 1), await tmOf(2, 1), await tmOf(3, 1), await tmOf(4, 1)]).toEqual([105, 102.5, 105, 102.5])
  })

  it('nSuns: a repeated day in the same week does not bump again', async () => {
    const pid = await installPreset('nsuns-5day', 'en')
    const day2 = (await templatesOf(pid))[1]
    const sumo = day2.items[1].exerciseId
    await db.exercises.update(sumo, { trainingMaxKg: 150 })
    for (const id of ['r1', 'r2']) {
      await finishedSession(id, day2.id!)
      await db.sets.bulkAdd(prescribedRows(id, sumo, day2.items[1].sets!, 150))
      await applySessionProgression(id)
    }
    expect((await db.exercises.get(sumo))!.trainingMaxKg).toBe(155)
  })

  it('5/3/1: two different week-4 workouts of the same template bump the TM once', async () => {
    const pid = await installPreset('531-bbb', 'en')
    const [press] = await templatesOf(pid)
    const ohp = press.items[0].exerciseId
    await db.exercises.update(ohp, { trainingMaxKg: 60 })
    await db.programs.update(pid, { cycleStartDate: '2026-09-28' })
    for (const id of ['w4a', 'w4b']) {
      await finishedSession(id, press.id!)
      await db.sets.bulkAdd(sets(id, ohp, 25, [5, 5, 5]))
      await applySessionProgression(id)
    }
    expect((await db.exercises.get(ohp))!.trainingMaxKg).toBe(62.5)
    expect((await db.templates.get(press.id!))!.items[0].progress).toMatchObject({ lastSessionId: 'w4b', tmCycle: '2026-09-28' })
  })

  it('Starting Strength: the squat moves on every workout across A and B', async () => {
    const pid = await installPreset('starting-strength', 'en')
    const [a, b] = await templatesOf(pid)
    const squat = await exerciseIdByName('Squat')
    const s1 = await finishedSession('a1', a.id!, NOW)
    await db.sets.bulkAdd(sets(s1, squat, 100, [5, 5, 5]))
    await applySessionProgression(s1)
    // Workout B's squat line carries the same progress: next session 105, not 100 again.
    const bSquat = (await db.templates.get(b.id!))!.items[0]
    expect(bSquat.progress).toMatchObject({ lastSessionId: 'a1', nextWeightKg: 105 })
    const s2 = await finishedSession('b1', b.id!, NOW + 86_400_000)
    await db.sets.bulkAdd(sets(s2, squat, 105, [5, 5, 4]))
    await applySessionProgression(s2)
    // A fail in B counts toward A's fail streak too.
    expect((await db.templates.get(a.id!))!.items[0].progress).toMatchObject({ lastSessionId: 'b1', failStreak: 1, nextWeightKg: 105 })
    // Other B lines are untouched by A's session.
    expect((await db.templates.get(b.id!))!.items[1].progress).toBeUndefined()
  })

  it('an exercise listed twice: work sets split per line, drop sets stay with their line, the TM written once', async () => {
    const squat = await exerciseIdByName('Squat')
    await db.exercises.update(squat, { trainingMaxKg: 100 })
    await db.templates.add({
      id: 'dup', name: 'Squat twice', position: 0, updatedAt: 1, items: [
        { exerciseId: squat, targetSets: 3, targetReps: 5, scheme: { kind: 'linear', stepKg: 5, failsToDeload: 3, deloadPct: 0.1 } },
        { exerciseId: squat, targetSets: 2, targetReps: 5, scheme: { kind: 'percent', basis: 'tm', tmStepKg: 5 }, sets: [{ pct: 0.6, reps: 5 }, { pct: 0.6, reps: 5 }] },
      ],
    })
    await db.programs.add({ id: 'pd', name: 'Dup', templateIds: ['dup'], cycleWeeks: 1, cycleStartDate: '2026-10-19' })
    const sid = await finishedSession('dup1', 'dup')
    const row = (n: number, weightKg: number, reps: number, extra: Partial<SetRow> = {}): SetRow => ({
      id: `dup-${n}`, sessionId: sid, exerciseId: squat, setNumber: n, weightKg, reps, isWarmup: false,
      completedAt: NOW + n * 60_000, e1rm: 1, ...extra,
    })
    await db.sets.bulkAdd([
      row(1, 100, 5), row(2, 100, 5), row(3, 80, 8, { setType: 'drop' }), row(4, 100, 5),
      row(5, 60, 5), row(6, 60, 5),
    ])
    await applySessionProgression(sid)
    const [linear, percent] = (await db.templates.get('dup'))!.items
    // The first line got its three 100 kg work sets (the drop set does not take a slot): a pass.
    expect(linear.progress).toMatchObject({ lastSessionId: 'dup1', lastOutcome: 'pass', nextWeightKg: 105 })
    expect(percent.progress).toMatchObject({ lastSessionId: 'dup1', lastOutcome: 'pass' })
    expect((await db.exercises.get(squat))!.trainingMaxKg).toBe(105)
  })
})

describe('programs table sync', () => {
  it('a pulled snapshot from a build without programs keeps the local ones', async () => {
    await installPreset('gzclp', 'en')
    const old = (await collectTables()) as Record<string, unknown>
    delete old.programs
    expect(await applyTables(old as never)).toBe(true)
    expect(await db.programs.count()).toBe(1)
  })
})
