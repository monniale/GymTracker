import { describe, it, expect } from 'vitest'
import {
  defaultBwFactor, bwFactorOf, usesBodyweightLoad, effectiveLoad, setE1rm, toScoreSets, fmtSetLoad, withLoads,
} from './load'
import { epley } from './scoring'
import { standardFor, levelFor } from './standards'
import type { Exercise, Session, SetRow } from '../types'

const ex = (name: string, over: Partial<Exercise> = {}): Exercise => ({
  id: 1, name, nameLower: name.toLowerCase(), muscleGroup: 'back', equipment: 'bodyweight',
  defaultRestSec: 90, isCustom: false, ...over,
})
const pullUp = ex('Pull-Up')
const bench = ex('Bench Press', { id: 2, equipment: 'barbell', muscleGroup: 'chest' })
const stamped = { bodyweightKg: 80, bwScoring: true as const }
const old: Pick<Session, 'bodyweightKg' | 'bwScoring'> = { bodyweightKg: 80 }
const row = (weightKg: number, reps: number, over: Partial<SetRow> = {}): SetRow => ({
  sessionId: 's1', exerciseId: 1, setNumber: 1, weightKg, reps, isWarmup: false, completedAt: 1, e1rm: 0, ...over,
})

describe('defaultBwFactor', () => {
  it('reads the seed catalog names', () => {
    for (const n of ['pull-up', 'chin-up', 'dips', 'inverted row']) {
      expect(defaultBwFactor({ nameLower: n, equipment: 'bodyweight' })).toBe(1.0)
    }
    expect(defaultBwFactor({ nameLower: 'push-up', equipment: 'bodyweight' })).toBe(0.64)
    for (const n of ['plank', 'crunch', 'hanging leg raise', 'russian twist', 'ab wheel rollout', 'back extension']) {
      expect(defaultBwFactor({ nameLower: n, equipment: 'bodyweight' })).toBe(0.3)
    }
  })

  it('falls back to the name rules, else 1.0', () => {
    const f = (nameLower: string) => defaultBwFactor({ nameLower, equipment: 'bodyweight' })
    expect(f('weighted pull up')).toBe(1.0)
    expect(f('ring dip')).toBe(1.0)
    expect(f('narrow push-up')).toBe(0.64) // "row" only matches at a word start
    expect(f('pike push up')).toBe(0.64)
    expect(f('pistol squat')).toBe(0.85)
    expect(f('walking lunge')).toBe(0.85)
    expect(f('step-up')).toBe(0.85)
    expect(f('sit-up')).toBe(0.3)
    expect(f('side plank')).toBe(0.3)
    expect(f('trazioni presa larga')).toBe(1.0)
    expect(f('piegamenti')).toBe(0.64)
    expect(f('muscle-up')).toBe(1.0)
  })
})

describe('bwFactorOf', () => {
  it('uses the stored factor when valid, else the default', () => {
    expect(bwFactorOf(ex('Push-Up', { bwFactor: 0.7 }))).toBe(0.7)
    expect(bwFactorOf(ex('Push-Up'))).toBe(0.64)
    expect(bwFactorOf(ex('Push-Up', { bwFactor: 0 }))).toBe(0.64)
    expect(bwFactorOf(ex('Push-Up', { bwFactor: NaN }))).toBe(0.64)
  })
})

describe('usesBodyweightLoad', () => {
  it('needs a stamped session, bodyweight equipment and a strength exercise', () => {
    expect(usesBodyweightLoad(pullUp, stamped)).toBe(true)
    expect(usesBodyweightLoad(pullUp, old)).toBe(false)
    expect(usesBodyweightLoad(pullUp, undefined)).toBe(false)
    expect(usesBodyweightLoad(undefined, stamped)).toBe(false)
    expect(usesBodyweightLoad(bench, stamped)).toBe(false)
    expect(usesBodyweightLoad(ex('Jump Rope', { muscleGroup: 'cardio' }), stamped)).toBe(false)
    expect(usesBodyweightLoad(ex('Burpee', { kind: 'cardio' }), stamped)).toBe(false)
  })
})

describe('effectiveLoad / setE1rm', () => {
  it('is weightKg on an unstamped session and for loaded equipment', () => {
    expect(effectiveLoad(row(0, 8), pullUp, old)).toBe(0)
    expect(effectiveLoad(row(10, 8), pullUp, old)).toBe(10)
    expect(effectiveLoad(row(100, 5), bench, stamped)).toBe(100)
  })

  it('adds bodyweight × factor on a stamped session', () => {
    expect(effectiveLoad(row(0, 8), pullUp, stamped)).toBe(80)
    expect(effectiveLoad(row(10, 8), pullUp, stamped)).toBe(90)
    expect(effectiveLoad(row(-20, 8), pullUp, stamped)).toBe(60)
    expect(effectiveLoad(row(0, 12), ex('Push-Up'), { bodyweightKg: 77.7, bwScoring: true })).toBe(49.7)
  })

  it('floors at 0 and never weights a cardio row', () => {
    expect(effectiveLoad(row(-200, 8), pullUp, stamped)).toBe(0)
    expect(effectiveLoad(row(0, 0, { durationSec: 600 }), pullUp, stamped)).toBe(0)
  })

  it('floors an assisted row at 0 once its exercise is no longer a bodyweight move', () => {
    const asMachine = ex('Pull-Up', { equipment: 'machine' })
    expect(effectiveLoad(row(-20, 8), asMachine, stamped)).toBe(0)
    expect(effectiveLoad(row(-20, 8), asMachine, undefined)).toBe(0)
    expect(setE1rm(row(-20, 8), asMachine, stamped)).toBe(0)
  })

  it('setE1rm is Epley of the effective load', () => {
    expect(setE1rm(row(0, 8), pullUp, stamped)).toBeCloseTo(epley(80, 8))
    expect(setE1rm(row(0, 8), pullUp, old)).toBe(0)
    expect(setE1rm(row(80, 8), bench, stamped)).toBe(epley(80, 8))
  })
})

describe('toScoreSets / withLoads', () => {
  const exMap = new Map([[1, pullUp], [2, bench]])

  it('fills loadKg per set', () => {
    const sets = [row(0, 8), row(5, 6), row(100, 5, { exerciseId: 2 })]
    expect(toScoreSets(sets, exMap, stamped).map(s => s.loadKg)).toEqual([80, 85, 100])
    expect(toScoreSets(sets, exMap, old).map(s => s.loadKg)).toEqual([0, 5, 100])
    expect(toScoreSets(sets, exMap, old)[0]).toEqual({ exerciseId: 1, weightKg: 0, reps: 8, isWarmup: false, durationSec: undefined, loadKg: 0 })
  })

  it('reads each set’s own session', () => {
    const sessions = new Map<string, Session>([
      ['a', { id: 'a', name: 'A', startedAt: 0, bodyweightKg: 80, extraExerciseIds: [], bwScoring: true }],
      ['b', { id: 'b', name: 'B', startedAt: 0, bodyweightKg: 80, extraExerciseIds: [] }],
    ])
    const out = withLoads([row(0, 8, { sessionId: 'a' }), row(0, 8, { sessionId: 'b' }), row(0, 8, { sessionId: 'x' })], exMap, sessions)
    expect(out.map(s => s.loadKg)).toEqual([80, 0, 0])
    expect(out[0].sessionId).toBe('a')
  })
})

describe('fmtSetLoad', () => {
  it('formats plain and bodyweight loads', () => {
    expect(fmtSetLoad({ weightKg: 80, reps: 8 }, false)).toBe('80 kg × 8')
    expect(fmtSetLoad({ weightKg: 82.5, reps: 5 }, false)).toBe('82.5 kg × 5')
    expect(fmtSetLoad({ weightKg: 0, reps: 12 }, true)).toBe('BW × 12')
    expect(fmtSetLoad({ weightKg: 10, reps: 8 }, true)).toBe('BW+10 kg × 8')
    expect(fmtSetLoad({ weightKg: -20, reps: 6 }, true)).toBe('BW−20 kg × 6')
    expect(fmtSetLoad({ weightKg: 2.5, reps: 6 }, true)).toBe('BW+2.5 kg × 6')
  })
})

describe('pull-up strength standard', () => {
  it('rates the effective e1RM against bodyweight', () => {
    const std = standardFor('pull-up')!
    expect(std.key).toBe('pullup')
    expect(levelFor(setE1rm(row(0, 1), pullUp, stamped), 80, std).level).toBe('Novice')
    expect(levelFor(setE1rm(row(40, 5), pullUp, stamped), 80, std).level).toBe('Advanced')
    expect(levelFor(0, 80, std).level).toBe('Untrained')
  })
})
