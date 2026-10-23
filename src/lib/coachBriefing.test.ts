import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  formatBriefing, formatWorkoutPlanBriefing, gatherWorkoutBriefing,
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

  it('an unstamped session keeps the logged kg, no factor and no pull-up level', async () => {
    const b = await finishPullUps('old', 10, false)
    expect(b.bodyweightFactor).toBeUndefined()
    expect(b.sets.map(s => s.loadKg)).toEqual([10, 10, 10])
    expect(b.nextSuggestion).toBe('12.5 kg for 8 reps')
    expect(b.strengthLevel).toBeNull()
  })
})
