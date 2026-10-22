import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { computeMuscleHeat, regionHeatLevel, HEAT_ROWS } from './muscleHeat'
import { involvement, BODY_TARGETS } from './muscleMap'
import { parseLibrary } from './exerciseLibrary'
import type { Exercise, Id, SetRow } from '../types'

const library = parseLibrary(JSON.parse(readFileSync(new URL('../../public/exercise-library.json', import.meta.url), 'utf8')))

/* Local times (Europe/Rome, pinned by `npm test`). Today is Wednesday 15 Oct 2026. */
const T = (m: number, d: number, h = 18) => new Date(2026, m - 1, d, h).getTime()
const TODAY = '2026-10-15'

const ex = (id: Id, name: string, muscleGroup: Exercise['muscleGroup'], extra: Partial<Exercise> = {}): Exercise =>
  ({ id, name, nameLower: name.toLowerCase(), muscleGroup, defaultRestSec: 90, isCustom: false, ...extra })
const set = (exerciseId: Id, completedAt: number, extra: Partial<SetRow> = {}): SetRow =>
  ({ sessionId: 's', exerciseId, weightKg: 100, reps: 5, e1rm: 110, isWarmup: false, completedAt, ...extra } as SetRow)

const EX = new Map<Id, Exercise>([
  [1, ex(1, 'Bench Press', 'chest')],
  [2, ex(2, 'My Thing', 'legs', { isCustom: true })],
  [3, ex(3, 'Treadmill Run', 'cardio')],
])

describe('involvement', () => {
  it('uses the library target and maps secondary muscles to regions', () => {
    const bench = library.byId.get('0025')!
    const inv = involvement(bench, 'chest')
    expect(inv.primary).toEqual(['pectorals'])
    expect(inv.secondary).toEqual(expect.arrayContaining(['triceps', 'delts']))
    expect(inv.secondary).not.toContain('pectorals')
  })

  it('maps every secondary muscle of the dataset and only to drawn regions', () => {
    for (const lib of library.exercises) {
      const inv = involvement(lib, 'other')
      for (const r of [...inv.primary, ...inv.secondary]) expect(BODY_TARGETS).toContain(r)
      if (lib.target !== 'cardiovascular system') expect(inv.primary).toEqual([lib.target])
    }
  })

  it('falls back to the muscle group without a library entry', () => {
    expect(involvement(undefined, 'legs')).toEqual({ primary: ['quads', 'hamstrings'], secondary: ['glutes', 'calves'] })
    expect(involvement(undefined, 'cardio')).toEqual({ primary: [], secondary: [] })
  })
})

describe('computeMuscleHeat', () => {
  it('counts target sets as 1 and secondary as ½ per week, oldest week first', () => {
    const weeks = computeMuscleHeat([
      set(1, T(10, 13)), set(1, T(10, 14)), // this week: 2 bench sets
      set(1, T(10, 6)), // last week
      set(2, T(10, 15)), // custom legs: by group
      set(1, T(10, 14), { isWarmup: true }), // warm-up: skipped
      set(3, T(10, 14), { durationSec: 600, weightKg: 0, reps: 0, e1rm: 0 }), // cardio: skipped
      set(1, T(7, 1)), // older than 8 weeks: skipped
    ], EX, library, TODAY)
    expect(weeks).toHaveLength(8)
    expect(weeks[7].monday).toBe('2026-10-12')
    expect(weeks[0].monday).toBe('2026-08-24')
    const now = weeks[7]
    expect(now.sets).toBe(3)
    expect(now.regions.pectorals).toBe(2)
    expect(now.regions.triceps).toBe(1)
    expect(now.regions.quads).toBe(1)
    expect(now.regions.calves).toBe(0.5)
    expect(weeks[6].regions.pectorals).toBe(1)
  })

  it('uses the muscle group while the library is not loaded', () => {
    const [week] = computeMuscleHeat([set(1, T(10, 14))], EX, null, TODAY, 1)
    expect(week.regions).toEqual({ pectorals: 1, delts: 0.5, triceps: 0.5 })
  })

  it('levels sets from 0 to 4', () => {
    expect([undefined, 0, 0.5, 3, 6, 9.5, 10, 25].map(regionHeatLevel)).toEqual([0, 0, 1, 2, 3, 3, 4, 4])
    for (const r of HEAT_ROWS) expect(BODY_TARGETS).toContain(r)
  })
})
