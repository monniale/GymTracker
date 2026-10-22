import { describe, it, expect } from 'vitest'
import {
  isCardioExercise, isCardioSet, cardioDraft, cardioFields, fmtCardioSet, fmtDistance,
  paceSecPerKm, fmtPace, cardioSessionTotals, cardioMinutes,
} from './cardio'

describe('cardio helpers', () => {
  it('tells cardio exercises by kind, else by muscle group', () => {
    expect(isCardioExercise({ muscleGroup: 'cardio' })).toBe(true)
    expect(isCardioExercise({ muscleGroup: 'legs' })).toBe(false)
    expect(isCardioExercise({ muscleGroup: 'legs', kind: 'cardio' })).toBe(true)
    expect(isCardioExercise({ muscleGroup: 'cardio', kind: 'strength' })).toBe(false)
    expect(isCardioExercise(undefined)).toBe(false)
  })

  it('tells cardio rows by their duration', () => {
    expect(isCardioSet({ durationSec: 60 })).toBe(true)
    expect(isCardioSet({ durationSec: 0 })).toBe(false)
    expect(isCardioSet({})).toBe(false)
  })

  it('prefills from the previous cardio row, else the target minutes', () => {
    expect(cardioDraft({ durationSec: 1530, distanceM: 4000 }, 20)).toEqual({ durationSec: 1530, distanceM: 4000 })
    expect(cardioDraft({ durationSec: 0 }, 25)).toEqual({ durationSec: 1500, distanceM: 0 })
    expect(cardioDraft(undefined, 0)).toEqual({ durationSec: 60, distanceM: 0 })
  })

  it('writes zeroed strength fields so strength paths skip the row', () => {
    expect(cardioFields({ durationSec: 1200.4, distanceM: 3210.6 })).toEqual({
      weightKg: 0, reps: 0, e1rm: 0, isWarmup: false, durationSec: 1200, distanceM: 3211,
    })
    expect(cardioFields({ durationSec: 600, distanceM: 0 })).toMatchObject({ durationSec: 600, distanceM: undefined })
  })

  it('formats time, distance and pace', () => {
    expect(fmtCardioSet({ durationSec: 750, distanceM: 3200 })).toBe('12:30 · 3.2 km')
    expect(fmtCardioSet({ durationSec: 3725 })).toBe('1:02:05')
    expect(fmtDistance(800)).toBe('800 m')
    expect(fmtDistance(10049)).toBe('10.0 km')
    expect(paceSecPerKm(1500, 5000)).toBe(300)
    expect(paceSecPerKm(1500, 0)).toBeNull()
    expect(fmtPace(312.4)).toBe('5:12 /km')
  })

  it('totals a workout’s cardio and rounds minutes up from any time', () => {
    expect(cardioSessionTotals([{ durationSec: 600, distanceM: 2000 }, { durationSec: 300 }, { durationSec: undefined }]))
      .toEqual({ sets: 2, durationSec: 900, distanceM: 2000 })
    expect(cardioMinutes(20)).toBe(1)
    expect(cardioMinutes(0)).toBe(0)
    expect(cardioMinutes(1530)).toBe(26)
  })
})
