import { describe, it, expect } from 'vitest'
import { sessionItems } from './sessionItems'
import type { Exercise, Id, TemplateItem } from '../types'

const ex = (id: Id, p: Partial<Exercise> = {}): Exercise => ({
  id,
  name: `Exercise ${id}`,
  nameLower: `exercise ${id}`,
  muscleGroup: 'chest',
  defaultRestSec: 120,
  isCustom: false,
  ...p,
})

const exMap = new Map<Id, Exercise>([
  [1, ex(1)],
  [2, ex(2, { muscleGroup: 'back', defaultRestSec: 90 })],
  [3, ex(3, { muscleGroup: 'cardio', defaultRestSec: 60 })],
  ['lib-0025', ex('lib-0025', { muscleGroup: 'legs', kind: 'cardio', defaultRestSec: 45 })],
])

const tplItems: TemplateItem[] = [
  { exerciseId: 1, targetSets: 4, targetReps: 6, restSec: 150, supersetWithNext: true },
  { exerciseId: 2, targetSets: 3, targetReps: 10 },
]

describe('sessionItems', () => {
  it('returns the template items as stored when nothing was added', () => {
    const items = sessionItems({ items: tplItems }, { extraExerciseIds: [] }, exMap)
    expect(items).toEqual(tplItems)
    // Same item objects, new array.
    expect(items[0]).toBe(tplItems[0])
    expect(items).not.toBe(tplItems)
  })

  it('builds a freestyle session from the added exercises only (3 × 8 at the default rest)', () => {
    const items = sessionItems(undefined, { extraExerciseIds: [2, 1] }, exMap)
    expect(items).toEqual([
      { exerciseId: 2, targetSets: 3, targetReps: 8, restSec: 90 },
      { exerciseId: 1, targetSets: 3, targetReps: 8, restSec: 120 },
    ])
  })

  it('puts template items first, then the added ones in order', () => {
    const items = sessionItems({ items: tplItems }, { extraExerciseIds: [3, 'lib-0025'] }, exMap)
    expect(items.map(i => i.exerciseId)).toEqual([1, 2, 3, 'lib-0025'])
  })

  it('gives an added cardio exercise one 20-minute set (by muscle group or by kind)', () => {
    const items = sessionItems(undefined, { extraExerciseIds: [3, 'lib-0025'] }, exMap)
    expect(items).toEqual([
      { exerciseId: 3, targetSets: 1, targetReps: 20, restSec: 60 },
      { exerciseId: 'lib-0025', targetSets: 1, targetReps: 20, restSec: 45 },
    ])
  })

  it('skips an added exercise already in the template, and an id added twice', () => {
    const items = sessionItems({ items: tplItems }, { extraExerciseIds: [1, 3, 3] }, exMap)
    expect(items).toEqual([
      tplItems[0],
      tplItems[1],
      { exerciseId: 3, targetSets: 1, targetReps: 20, restSec: 60 },
    ])
  })

  it('keeps an added exercise missing from the map as 3 × 8 with no rest', () => {
    const items = sessionItems(undefined, { extraExerciseIds: [99] }, exMap)
    expect(items).toHaveLength(1)
    expect(items[0]).toStrictEqual({ exerciseId: 99, targetSets: 3, targetReps: 8, restSec: undefined })
  })

  describe('swaps', () => {
    it('replaces the swapped exercise in place, keeping order, targets and the superset link', () => {
      const items = sessionItems({ items: tplItems }, { extraExerciseIds: [], swaps: [{ from: 1, to: 3 }] }, exMap)
      expect(items).toEqual([
        { exerciseId: 3, targetSets: 4, targetReps: 6, restSec: 150, supersetWithNext: true, swappedFrom: 1 },
        tplItems[1],
      ])
      // The stored template line is not mutated.
      expect(tplItems[0].exerciseId).toBe(1)
    })

    it('resolves chained swaps in order (A to B then B to C is C, from A)', () => {
      const items = sessionItems(
        { items: tplItems }, { extraExerciseIds: [], swaps: [{ from: 2, to: 3 }, { from: 3, to: 'lib-0025' }] }, exMap)
      expect(items.map(i => i.exerciseId)).toEqual([1, 'lib-0025'])
      expect(items[1]).toMatchObject({ targetSets: 3, targetReps: 10, swappedFrom: 2 })
    })

    it('gives the original back when swapped back, with no swappedFrom', () => {
      const items = sessionItems(
        { items: tplItems }, { extraExerciseIds: [], swaps: [{ from: 2, to: 3 }, { from: 3, to: 2 }] }, exMap)
      expect(items).toEqual(tplItems)
      expect(items[1]).toBe(tplItems[1])
    })

    it('keeps a swapped-out exercise with logged sets as a 0-target extra card', () => {
      const items = sessionItems(
        { items: tplItems }, { extraExerciseIds: [3], swaps: [{ from: 1, to: 'lib-0025' }] }, exMap, new Set<Id>([1, 2]))
      expect(items.map(i => i.exerciseId)).toEqual(['lib-0025', 2, 3, 1])
      expect(items[3]).toEqual({ exerciseId: 1, targetSets: 0, targetReps: 6, restSec: 150, swappedOut: true })
    })

    it('keeps every logged exercise of a chain, and none without logged sets', () => {
      const items = sessionItems(
        { items: tplItems },
        { extraExerciseIds: [], swaps: [{ from: 2, to: 3 }, { from: 3, to: 'lib-0025' }] },
        exMap,
        new Set<Id>([3]),
      )
      expect(items.map(i => [i.exerciseId, i.targetSets, !!i.swappedOut])).toEqual([
        [1, 4, false], ['lib-0025', 3, false], [3, 0, true],
      ])
    })

    it('without loggedIds, a swapped-out exercise gets no card', () => {
      const items = sessionItems({ items: tplItems }, { extraExerciseIds: [], swaps: [{ from: 1, to: 3 }] }, exMap)
      expect(items.map(i => i.exerciseId)).toEqual([3, 2])
    })

    it('never resolves an added exercise through swaps (a swapped added card is rewritten in extraExerciseIds)', () => {
      const items = sessionItems(undefined, { extraExerciseIds: [1, 2], swaps: [{ from: 1, to: 3 }] }, exMap)
      expect(items).toEqual([
        { exerciseId: 1, targetSets: 3, targetReps: 8, restSec: 120 },
        { exerciseId: 2, targetSets: 3, targetReps: 8, restSec: 90 },
      ])
    })

    it('keeps a swapped-out added exercise with logged sets (default reps, 0 sets)', () => {
      // Stored form of "added 2, logged a set, swapped it to 1": extras rewritten, swap kept for the sets.
      const items = sessionItems(undefined, { extraExerciseIds: [1], swaps: [{ from: 2, to: 1 }] }, exMap, new Set<Id>([2]))
      expect(items).toEqual([
        { exerciseId: 1, targetSets: 3, targetReps: 8, restSec: 120 },
        { exerciseId: 2, targetSets: 0, targetReps: 8, restSec: 90, swappedOut: true },
      ])
    })

    it('shows an exercise added back after a chained swap as itself (A to B, B to C, add B)', () => {
      const items = sessionItems(
        { items: [tplItems[0]] }, { extraExerciseIds: [2], swaps: [{ from: 1, to: 2 }, { from: 2, to: 3 }] }, exMap)
      expect(items.map(i => [i.exerciseId, i.swappedFrom])).toEqual([[3, 1], [2, undefined]])
    })

    it('shows an exercise added back after "also update the template" as itself, not the old target', () => {
      // Template line 1 was rewritten to 3 after an earlier session swap 1 to 2.
      const items = sessionItems(
        { items: [{ ...tplItems[0], exerciseId: 3 }] }, { extraExerciseIds: [1], swaps: [{ from: 1, to: 2 }] }, exMap)
      expect(items.map(i => [i.exerciseId, i.swappedFrom])).toEqual([[3, undefined], [1, undefined]])
    })

    it('swaps a re-added template exercise that has logged sets (A to B, add A, log, A to D)', () => {
      const items = sessionItems(
        { items: [tplItems[0]] },
        { extraExerciseIds: ['lib-0025'], swaps: [{ from: 1, to: 2 }, { from: 1, to: 'lib-0025' }] },
        exMap,
        new Set<Id>([1]),
      )
      expect(items.map(i => [i.exerciseId, i.targetSets, i.swappedFrom, !!i.swappedOut])).toEqual([
        [2, 4, 1, false], ['lib-0025', 1, undefined, false], [1, 0, undefined, true],
      ])
    })

    it('shows a swapped-out template exercise added back as itself', () => {
      const items = sessionItems({ items: tplItems }, { extraExerciseIds: [1], swaps: [{ from: 1, to: 3 }] }, exMap)
      expect(items.map(i => i.exerciseId)).toEqual([3, 2, 1])
      expect(items[2]).toEqual({ exerciseId: 1, targetSets: 3, targetReps: 8, restSec: 120 })
    })

    it('ignores swaps whose exercise is in no line, and self swaps', () => {
      const items = sessionItems(
        { items: tplItems },
        { extraExerciseIds: [], swaps: [{ from: 99, to: 3 }, { from: 2, to: 2 }] },
        exMap,
        new Set<Id>([1]),
      )
      expect(items).toEqual(tplItems)
    })

    it('does not duplicate an added exercise that a swap already brought in', () => {
      const items = sessionItems({ items: tplItems }, { extraExerciseIds: [3], swaps: [{ from: 1, to: 3 }] }, exMap)
      expect(items.map(i => i.exerciseId)).toEqual([3, 2])
    })
  })
})
