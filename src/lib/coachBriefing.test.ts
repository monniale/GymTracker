import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  formatBriefing, formatWorkoutPlanBriefing, gatherWorkoutBriefing, gatherWorkoutPlanBriefing,
  type WorkoutBriefing, type BriefingExercise, type WorkoutPlanBriefing,
} from './coachBriefing'
import { db } from '../db/db'
import { ensureSeeded } from '../db/seed'
import { finishSession } from './finishSession'
import { setE1rm } from './load'
import type { Session } from '../types'

const exercise = (p: Partial<BriefingExercise> = {}): BriefingExercise => ({
  name: 'Bench Press',
  muscleGroup: 'chest',
  sets: [
    { weightKg: 80, reps: 8, loadKg: 80 },
    { weightKg: 80, reps: 8, loadKg: 80 },
  ],
  bestE1rm: 101,
  priorBestE1rm: 100,
  e1rmPr: true,
  volumePr: false,
  strengthLevel: 'Intermediate',
  nextSuggestion: '82.5 kg for 8 reps',
  ...p,
})

const briefing = (p: Partial<WorkoutBriefing> = {}): WorkoutBriefing => ({
  sessionName: 'Push Day',
  durationMin: 42,
  totalPoints: 67,
  recentAvgPoints: 55,
  bodyweightKg: 80,
  streakWeeks: 3,
  sessionsThisWeek: 2,
  weeklyTarget: 4,
  exercises: [exercise()],
  cardio: [],
  weeklyMuscle: [{ group: 'chest', sets: 12, weeklyAvg: 9.5 }],
  ...p,
})

describe('formatBriefing', () => {
  it('lists cardio as context without points', () => {
    const text = formatBriefing(briefing({ cardio: [{ name: 'Treadmill Run', minutes: 25, distanceM: 4200, pace: '5:57 /km' }] }))
    expect(text).toContain('Cardio (tracked, earns no points):')
    expect(text).toContain('- Treadmill Run: 25 min, 4.2 km, pace 5:57 /km')
    expect(formatBriefing(briefing())).not.toContain('Cardio')
  })

  it('shows the score against the recent average', () => {
    expect(formatBriefing(briefing())).toContain('Score: 67 pts (recent avg 55)')
  })

  it('marks a first tracked session when there is no recent average', () => {
    expect(formatBriefing(briefing({ recentAvgPoints: null }))).toContain('first tracked session')
  })

  it('surfaces PR tags, strength level, and the next suggestion', () => {
    const text = formatBriefing(briefing())
    expect(text).toContain('NEW e1RM PR')
    expect(text).toContain('level Intermediate')
    expect(text).toContain('Suggested next: 82.5 kg for 8 reps')
  })

  it('notes first-time-this-season exercises instead of a prior best', () => {
    const text = formatBriefing(briefing({ exercises: [exercise({ priorBestE1rm: null, e1rmPr: false })] }))
    expect(text).toContain('first time this season')
    expect(text).not.toContain('prior best e1RM')
  })

  it('renders the weekly muscle balance with the evidence band', () => {
    const text = formatBriefing(briefing())
    expect(text).toContain('evidence band 10-20')
    expect(text).toContain('chest: 12 sets this week (prior 8-week avg 9.5/wk)')
  })

  it('handles no logged sets in the last 8 weeks', () => {
    expect(formatBriefing(briefing({ weeklyMuscle: [] }))).toContain('no sets logged')
  })

  it('handles an exercise with no work sets', () => {
    const text = formatBriefing(briefing({ exercises: [exercise({ sets: [] })] }))
    expect(text).toContain('no work sets')
  })

  it('includes consistency and streak context', () => {
    expect(formatBriefing(briefing())).toContain('2/4 sessions this week, 3-week streak')
  })
})

describe('set notation (RPE and set types)', () => {
  const LEGEND = 'Set notation: @n = RPE, D = drop set, F = to failure, A = AMRAP'

  it('tags each set and prints the legend once', () => {
    const tagged = exercise({
      sets: [
        { weightKg: 80, reps: 8, loadKg: 80, rpe: 8 },
        { weightKg: 80, reps: 6, loadKg: 80, rpe: 9.5, setType: 'failure' },
        { weightKg: 60, reps: 12, loadKg: 60, setType: 'drop' },
        { weightKg: 50, reps: 15, loadKg: 50, setType: 'amrap' },
      ],
    })
    const text = formatBriefing(briefing({ exercises: [tagged, exercise({ name: 'Fly' })] }))
    expect(text).toContain('- Bench Press (chest): 80kg×8@8, 80kg×6@9.5 F, 60kg×12 D, 50kg×15 A.')
    expect(text).toContain('- Fly (chest): 80kg×8, 80kg×8.')
    expect(text.split(LEGEND).length - 1).toBe(1)
  })

  it('leaves the legend out when no set uses the notation', () => {
    const plain = exercise({ sets: [{ weightKg: 80, reps: 8, loadKg: 80, setType: 'working' }] })
    const text = formatBriefing(briefing({ exercises: [plain] }))
    expect(text).not.toContain('Set notation')
    expect(text).toContain('- Bench Press (chest): 80kg×8.')
  })

  it('works with the bodyweight format', () => {
    const pullUps = exercise({
      name: 'Pull-Up', muscleGroup: 'back', bodyweightFactor: 1,
      sets: [{ weightKg: 10, reps: 8, loadKg: 90, rpe: 8 }, { weightKg: 0, reps: 10, loadKg: 80, setType: 'failure' }],
    })
    expect(formatBriefing(briefing({ exercises: [pullUps] }))).toContain('- Pull-Up (back): BW+10kg×8@8, BW×10 F.')
  })

  it('adds only a few characters per set (the briefing stays compact)', () => {
    const sets = Array.from({ length: 5 }, () => ({ weightKg: 80, reps: 8, loadKg: 80 }))
    const exs = Array.from({ length: 10 }, (_, i) => exercise({ name: `Ex ${i}`, sets }))
    const plain = formatBriefing(briefing({ exercises: exs }))
    const taggedExs = exs.map(e => ({ ...e, sets: e.sets.map(s => ({ ...s, rpe: 9.5, setType: 'failure' as const })) }))
    const tagged = formatBriefing(briefing({ exercises: taggedExs }))
    // "@9.5 F" is 6 characters on each of the 50 sets, plus the legend line.
    expect(tagged.length - plain.length).toBeLessThanOrEqual(50 * 6 + LEGEND.length + 1)
  })

  it('the plan briefing tags last sets and explains a hold baseline', () => {
    const plan: WorkoutPlanBriefing = {
      sessionName: 'Push', bodyweightKg: 80, barKg: 20,
      exercises: [{
        ref: '1', exerciseId: 1, name: 'Bench Press', muscleGroup: 'chest', equipment: 'barbell', targetSets: 3, targetReps: 8, stepKg: 2.5,
        lastSets: [{ weightKg: 80, reps: 8, rpe: 10 }], baseline: { weightKg: 80, reps: 8, reason: 'hold' },
        strengthLevel: null, recentBestE1rm: null,
      }],
    }
    const text = formatWorkoutPlanBriefing(plan)
    expect(text).toContain('Last: 80kg×8@10.')
    expect(text).toContain('Baseline: 80kg×8 (hold, last session was near the limit).')
    expect(text).toContain(LEGEND)
    const plainPlan = { ...plan, exercises: [{ ...plan.exercises[0], lastSets: [{ weightKg: 80, reps: 8 }] }] }
    expect(formatWorkoutPlanBriefing(plainPlan)).not.toContain('Set notation')
  })
})

describe('bodyweight exercises', () => {
  const pullUps = exercise({
    name: 'Pull-Up', muscleGroup: 'back', bodyweightFactor: 1, e1rmPr: false, strengthLevel: null,
    sets: [{ weightKg: 0, reps: 10, loadKg: 80 }, { weightKg: 10, reps: 8, loadKg: 90 }, { weightKg: -20, reps: 6, loadKg: 60 }],
  })

  it('prints added kg on bodyweight and tags the factor', () => {
    const text = formatBriefing(briefing({ exercises: [exercise(), pullUps] }))
    expect(text).toContain('- Pull-Up (back): BW×10, BW+10kg×8, BW-20kg×6.')
    expect(text).toContain('[bodyweight ×1]')
    expect(text).toContain('BW = bodyweight')
    expect(text).toContain('- Bench Press (chest): 80kg×8, 80kg×8.')
  })

  it('keeps an unstamped session as logged, without the legend', () => {
    const text = formatBriefing(briefing({ exercises: [{ ...pullUps, bodyweightFactor: undefined }] }))
    expect(text).toContain('- Pull-Up (back): 0kg×10, 10kg×8, -20kg×6.')
    expect(text).not.toContain('BW')
    expect(text).not.toContain('bodyweight ×')
  })

  it('tells the planner that bodyweight weights are added kg', () => {
    const plan = (equipment: string): WorkoutPlanBriefing => ({
      sessionName: 'Pull', bodyweightKg: 80, barKg: 20,
      exercises: [{
        ref: '13', exerciseId: 13, name: 'Pull-Up', muscleGroup: 'back', equipment, targetSets: 3, targetReps: 8, stepKg: 2.5,
        lastSets: [{ weightKg: 0, reps: 8 }], baseline: null, strengthLevel: null, recentBestE1rm: null,
      }],
    })
    expect(formatWorkoutPlanBriefing(plan('bodyweight'))).toContain('Weights for bodyweight exercises are ADDED kg')
    expect(formatWorkoutPlanBriefing(plan('bodyweight'))).toContain('negative = assisted')
    expect(formatWorkoutPlanBriefing(plan('bodyweight'))).not.toContain('never negative')
    expect(formatWorkoutPlanBriefing(plan('barbell'))).not.toContain('ADDED kg')
  })
})

describe('gatherWorkoutBriefing with bodyweight load', () => {
  const T = (d: number, h = 10) => new Date(2026, 9, d, h).getTime()
  const store = new Map<string, string>()
  const memoryStorage: Storage = {
    get length() { return store.size },
    clear: () => store.clear(),
    getItem: k => store.get(k) ?? null,
    key: i => [...store.keys()][i] ?? null,
    removeItem: k => void store.delete(k),
    setItem: (k, v) => void store.set(k, String(v)),
  }

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T(15, 12))
    vi.stubGlobal('localStorage', memoryStorage)
    db.close()
    await Dexie.delete('gymtracker')
    await db.open()
    await ensureSeeded()
    await db.rankState.update(1, { seasonStart: '2026-10-01', points: 500 })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  async function finishPullUps(id: string, weightKg: number, stamped: boolean) {
    const pullUp = (await db.exercises.where('nameLower').equals('pull-up').first())!
    const session: Session = {
      id, name: 'Pull', startedAt: T(15), bodyweightKg: 80, extraExerciseIds: [], ...(stamped ? { bwScoring: true as const } : {}),
    }
    await db.sessions.put(session)
    await db.sets.bulkPut([0, 1, 2].map(i => ({
      id: `${id}-${i}`, sessionId: id, exerciseId: pullUp.id!, setNumber: i + 1, weightKg, reps: 8, isWarmup: false,
      completedAt: T(15) + i * 60_000, e1rm: setE1rm({ weightKg, reps: 8 }, pullUp, session),
    })))
    await finishSession(id)
    return (await gatherWorkoutBriefing(id))!.exercises[0]
  }

  it('a stamped session briefs the bodyweight load, its factor and an added-kg suggestion', async () => {
    const b = await finishPullUps('new', 0, true)
    expect(b.bodyweightFactor).toBe(1)
    expect(b.sets.map(s => s.loadKg)).toEqual([80, 80, 80])
    expect(b.nextSuggestion).toBe('BW+1.25kg for 8 reps')
    expect(b.strengthLevel).not.toBeNull()
  })

  it('carries each set\'s RPE and type, and holds after a failure set', async () => {
    const bench = (await db.exercises.where('nameLower').equals('bench press').first())!
    const session: Session = { id: 'rpe', name: 'Push', startedAt: T(15), bodyweightKg: 80, extraExerciseIds: [], bwScoring: true }
    await db.sessions.put(session)
    const rows = [
      { rpe: 8 }, { rpe: 9 }, { setType: 'failure' as const }, { setType: 'drop' as const },
    ]
    await db.sets.bulkPut(rows.map((extra, i) => ({
      id: `rpe-${i}`, sessionId: 'rpe', exerciseId: bench.id!, setNumber: i + 1, weightKg: i < 3 ? 80 : 60, reps: 8,
      isWarmup: false, completedAt: T(15) + i * 60_000, e1rm: setE1rm({ weightKg: i < 3 ? 80 : 60, reps: 8 }, bench, session), ...extra,
    })))
    await finishSession('rpe')
    const b = (await gatherWorkoutBriefing('rpe'))!.exercises[0]
    expect(b.sets.map(s => [s.rpe, s.setType])).toEqual([[8, undefined], [9, undefined], [undefined, 'failure'], [undefined, 'drop']])
    expect(b.nextSuggestion).toBe('hold 80 kg for 8 reps (this session ended near the limit)')
  })

  it('the plan briefing carries the last session\'s RPE and set types, and holds its baseline', async () => {
    const bench = (await db.exercises.where('nameLower').equals('bench press').first())!
    const prev: Session = { id: 'prev', name: 'Push', startedAt: T(13), bodyweightKg: 80, extraExerciseIds: [bench.id!], bwScoring: true }
    await db.sessions.put(prev)
    // A stray 'working' row (writers never store it) must not reach the briefing as a key.
    const rows = [
      { weightKg: 80, extra: { setType: 'working' as const } },
      { weightKg: 80, extra: { setType: 'failure' as const } },
      { weightKg: 60, extra: { rpe: 8, setType: 'drop' as const } },
    ]
    await db.sets.bulkPut(rows.map((r, i) => ({
      id: `prev-${i}`, sessionId: 'prev', exerciseId: bench.id!, setNumber: i + 1, weightKg: r.weightKg, reps: 8,
      isWarmup: false, completedAt: T(13) + i * 60_000, e1rm: setE1rm({ weightKg: r.weightKg, reps: 8 }, bench, prev), ...r.extra,
    })))
    await finishSession('prev')
    await db.sessions.put({ id: 'next', name: 'Push', startedAt: T(15), bodyweightKg: 80, extraExerciseIds: [bench.id!], bwScoring: true })
    const plan = (await gatherWorkoutPlanBriefing('next'))!.exercises[0]
    expect(plan.lastSets).toStrictEqual([
      { weightKg: 80, reps: 8 },
      { weightKg: 80, reps: 8, setType: 'failure' },
      { weightKg: 60, reps: 8, rpe: 8, setType: 'drop' },
    ])
    expect(plan.baseline).toEqual({ weightKg: 80, reps: 8, reason: 'hold' })
  })

  it('an unstamped session keeps the logged kg, no factor and no pull-up level', async () => {
    const b = await finishPullUps('old', 10, false)
    expect(b.bodyweightFactor).toBeUndefined()
    expect(b.sets.map(s => s.loadKg)).toEqual([10, 10, 10])
    expect(b.nextSuggestion).toBe('12.5 kg for 8 reps')
    expect(b.strengthLevel).toBeNull()
  })

  it('the plan briefing rates a pull-up only from bodyweight-load (stamped) history', async () => {
    const pullUp = (await db.exercises.where('nameLower').equals('pull-up').first())!
    await finishPullUps('old', 0, false)
    await db.sessions.put({ id: 'plan', name: 'Pull', startedAt: T(15, 18), bodyweightKg: 80, extraExerciseIds: [pullUp.id!], bwScoring: true })
    // Only unstamped rows (added kg, e1rm 0): no level, not 'Untrained'.
    expect((await gatherWorkoutPlanBriefing('plan'))!.exercises[0].strengthLevel).toBeNull()

    await finishPullUps('new', 0, true)
    const rated = (await gatherWorkoutPlanBriefing('plan'))!.exercises[0]
    expect(rated.strengthLevel).not.toBeNull()
    expect(rated.strengthLevel).not.toBe('Untrained')
  })

  it('a swapped-in exercise keeps the target reps of the template line it replaced', async () => {
    const bench = (await db.exercises.where('nameLower').equals('bench press').first())!
    const incline = (await db.exercises.where('nameLower').equals('incline dumbbell press').first())!
    const tpl = await db.templates.add({
      name: 'Push', position: 0, updatedAt: 1, items: [{ exerciseId: bench.id!, targetSets: 3, targetReps: 12 }],
    })
    const session: Session = {
      id: 'sw', name: 'Push', templateId: tpl, startedAt: T(15), bodyweightKg: 80, extraExerciseIds: [], bwScoring: true,
      swaps: [{ from: bench.id!, to: incline.id! }],
    }
    await db.sessions.put(session)
    await db.sets.bulkPut([0, 1, 2].map(i => ({
      id: `sw-${i}`, sessionId: 'sw', exerciseId: incline.id!, setNumber: i + 1, weightKg: 20, reps: 10, isWarmup: false,
      completedAt: T(15) + i * 60_000, e1rm: setE1rm({ weightKg: 20, reps: 10 }, incline, session),
    })))
    await finishSession('sw')
    // 10 of 12 reps: add a rep (the line's target), not 'weight-up' against the 8-rep fallback.
    expect((await gatherWorkoutBriefing('sw'))!.exercises[0].nextSuggestion).toBe('11 reps at 20 kg')
  })

  it('a rep range moves the target to its top: reps climb before the weight', async () => {
    const incline = (await db.exercises.where('nameLower').equals('incline dumbbell press').first())!
    const tpl = await db.templates.add({
      name: 'Push', position: 0, updatedAt: 1,
      items: [{ exerciseId: incline.id!, targetSets: 3, targetReps: 8, targetRepsMax: 12 }],
    })
    const session: Session = { id: 'rr', name: 'Push', templateId: tpl, startedAt: T(15), bodyweightKg: 80, extraExerciseIds: [], bwScoring: true }
    await db.sessions.put(session)
    await db.sets.bulkPut([0, 1, 2].map(i => ({
      id: `rr-${i}`, sessionId: 'rr', exerciseId: incline.id!, setNumber: i + 1, weightKg: 20, reps: 10, isWarmup: false,
      completedAt: T(15) + i * 60_000, e1rm: setE1rm({ weightKg: 20, reps: 10 }, incline, session),
    })))
    await finishSession('rr')
    // 10 reps passes 8 but not the top of 8-12: one more rep, no weight step yet.
    expect((await gatherWorkoutBriefing('rr'))!.exercises[0].nextSuggestion).toBe('11 reps at 20 kg')

    await db.sessions.put({ id: 'rr2', name: 'Push', templateId: tpl, startedAt: T(15, 18), bodyweightKg: 80, extraExerciseIds: [], bwScoring: true })
    const plan = (await gatherWorkoutPlanBriefing('rr2'))!
    expect(plan.exercises[0].targetRepsMax).toBe(12)
    expect(plan.exercises[0].baseline).toEqual({ weightKg: 20, reps: 11, reason: 'reps-up' })
    expect(formatWorkoutPlanBriefing(plan)).toContain('target 3×8-12 reps')
  })

  it('the plan briefing leaves lines with a fixed prescription to the program', async () => {
    const bench = (await db.exercises.where('nameLower').equals('bench press').first())!
    const incline = (await db.exercises.where('nameLower').equals('incline dumbbell press').first())!
    const linear = { kind: 'linear' as const, stepKg: 2.5, failsToDeload: 3, deloadPct: 0.1 }
    const tpl = await db.templates.add({
      name: 'Push', position: 0, updatedAt: 1,
      items: [
        { exerciseId: bench.id!, targetSets: 5, targetReps: 5, scheme: linear },
        { exerciseId: incline.id!, targetSets: 3, targetReps: 8, targetRepsMax: 12 },
      ],
    })
    await db.sessions.put({ id: 'fx', name: 'Push', templateId: tpl, startedAt: T(15), bodyweightKg: 80, extraExerciseIds: [], bwScoring: true })
    const plan = (await gatherWorkoutPlanBriefing('fx'))!
    expect(plan.exercises.map(e => e.exerciseId)).toEqual([incline.id])

    // Only fixed lines: no AI plan at all.
    const only = await db.templates.add({
      name: 'Bench', position: 1, updatedAt: 1, items: [{ exerciseId: bench.id!, targetSets: 5, targetReps: 5, scheme: linear }],
    })
    await db.sessions.put({ id: 'fx2', name: 'Bench', templateId: only, startedAt: T(15), bodyweightKg: 80, extraExerciseIds: [], bwScoring: true })
    expect(await gatherWorkoutPlanBriefing('fx2')).toBeNull()
  })
})
