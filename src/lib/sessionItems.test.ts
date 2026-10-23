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
})
