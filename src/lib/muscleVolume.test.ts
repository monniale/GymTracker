import { describe, it, expect } from 'vitest'
import { computeWeeklyMuscleVolume, HYPERTROPHY_SET_BAND } from './muscleVolume'
import { mondayOf, parseLocalDate, addDays } from './dates'
import type { Exercise, Id, MuscleGroup, SetRow } from '../types'

const TODAY = '2026-07-16'
const thisMonday = mondayOf(TODAY)
const weekStartMs = parseLocalDate(thisMonday).getTime()
const start8wMs = parseLocalDate(addDays(thisMonday, -49)).getTime()

// A timestamp N days before this Monday.
const daysBefore = (n: number) => parseLocalDate(addDays(thisMonday, -n)).getTime()

const ex = (id: number, muscleGroup: MuscleGroup): Exercise => ({
  id,
  name: `Ex${id}`,
  nameLower: `ex${id}`,
  muscleGroup,
  defaultRestSec: 120,
  isCustom: false,
})

const s = (exerciseId: number, completedAt: number, isWarmup = false): SetRow => ({
  sessionId: 1,
  exerciseId,
  setNumber: 1,
  weightKg: 50,
  reps: 8,
  isWarmup,
  completedAt,
  e1rm: 60,
})

const exMap = new Map<Id, Exercise>([
  [1, ex(1, 'chest')],
  [2, ex(2, 'back')],
  [3, ex(3, 'cardio')],
])

describe('computeWeeklyMuscleVolume', () => {
  it('counts this-week non-warmup sets per muscle, excluding warmups and cardio', () => {
    const rows = computeWeeklyMuscleVolume(
      [
        s(1, weekStartMs + 1000), // chest, this week
        s(1, weekStartMs + 2000), // chest, this week
        s(1, weekStartMs + 3000, true), // warmup -> excluded
        s(2, weekStartMs + 4000), // back, this week
        s(3, weekStartMs + 5000), // cardio -> excluded
      ],
      exMap,
      TODAY,
    )
    const chest = rows.find(r => r.group === 'chest')
    const back = rows.find(r => r.group === 'back')
    expect(chest?.sets).toBe(2)
    expect(back?.sets).toBe(1)
    expect(rows.some(r => r.group === 'cardio')).toBe(false)
  })

  it('computes weeklyAvg as round1(priorWeeksCount / 7)', () => {
    // 3 chest sets in prior weeks -> 3/7 = 0.4285... -> 0.4
    const rows = computeWeeklyMuscleVolume(
      [s(1, daysBefore(3)), s(1, daysBefore(4)), s(1, daysBefore(5))],
      exMap,
      TODAY,
    )
    expect(rows[0].group).toBe('chest')
    expect(rows[0].sets).toBe(0)
    expect(rows[0].weeklyAvg).toBe(0.4)
  })

  it('sorts rows by this-week sets descending', () => {
    const rows = computeWeeklyMuscleVolume(
      [s(2, weekStartMs + 1), s(1, weekStartMs + 1), s(1, weekStartMs + 2), s(1, weekStartMs + 3)],
      exMap,
      TODAY,
    )
    expect(rows.map(r => r.group)).toEqual(['chest', 'back'])
  })

  it('skips sets whose exercise is missing from the map', () => {
    const rows = computeWeeklyMuscleVolume([s(99, weekStartMs + 1)], exMap, TODAY)
    expect(rows).toHaveLength(0)
  })

  it('includes sets exactly at the 8-week boundary as prior, excludes older ones', () => {
    const included = computeWeeklyMuscleVolume([s(1, start8wMs)], exMap, TODAY)
    expect(included[0]?.group).toBe('chest')
    expect(included[0]?.weeklyAvg).toBeGreaterThan(0)

    const excluded = computeWeeklyMuscleVolume([s(1, start8wMs - 1)], exMap, TODAY)
    expect(excluded).toHaveLength(0)
  })

  it('exposes the evidence band as [10, 20]', () => {
    expect(HYPERTROPHY_SET_BAND).toEqual([10, 20])
  })
})
