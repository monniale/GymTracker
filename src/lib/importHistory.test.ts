import { describe, it, expect } from 'vitest'
import {
  parseHistoryCsv, parseStrongDate, parseHevyDate, parseStrongDuration, detectFormat,
  normalizeImportedName, resolveExercises, guessMuscleGroup, planImportScoring, type ImportedSession,
} from './importHistory'
import type { Exercise } from '../types'

const T = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime()

const STRONG_CSV = [
  'Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE',
  '2024-03-12 18:05:00,"Push, heavy",1h 2m,Bench Press (Barbell),W,40,10,0,0,,,',
  '2024-03-12 18:05:00,"Push, heavy",1h 2m,Bench Press (Barbell),1,100,5,0,0,,,',
  '2024-03-12 18:05:00,"Push, heavy",1h 2m,Bench Press (Barbell),2,100,5,0,0,"felt ""easy""",,',
  '2024-03-12 18:05:00,"Push, heavy",1h 2m,Bench Press (Barbell),Rest Timer,0,0,0,90,,,',
  '2024-03-12 18:05:00,"Push, heavy",1h 2m,Bench Press (Dumbbell),1,30,10,0,0,,,',
  '2024-03-12 18:05:00,"Push, heavy",1h 2m,Running (Treadmill),1,0,0,3.2,1200,,,',
  '2024-03-14 07:30:00,Legs,45m,Squat (Barbell),1,225,5,0,0,,,',
].join('\n')

const HEVY_CSV = [
  '"title","start_time","end_time","description","exercise_title","superset_id","exercise_notes","set_index","set_type","weight_kg","reps","distance_km","duration_seconds","rpe"',
  '"Upper A","12 Mar 2024, 18:05","12 Mar 2024, 19:10","","Bench Press (Barbell)","","","0","warmup","40","10","","",""',
  '"Upper A","12 Mar 2024, 18:05","12 Mar 2024, 19:10","","Bench Press (Barbell)","","","1","normal","100","5","","","8"',
  '"Upper A","12 Mar 2024, 18:05","12 Mar 2024, 19:10","","Pull Up","","","0","normal","","10","","",""',
  '"Upper A","12 Mar 2024, 18:05","12 Mar 2024, 19:10","","Treadmill","","","0","normal","","","2.5","900",""',
  '"Lower","14 Mar 2024, 07:30","14 Mar 2024, 08:20","","Squat (Barbell)","","","0","normal","100","5","","",""',
].join('\n')

describe('format details', () => {
  it('reads both date styles and Strong durations', () => {
    expect(parseStrongDate('2024-03-12 18:05:00')).toBe(T(2024, 3, 12, 18, 5))
    expect(parseHevyDate('12 Mar 2024, 18:05')).toBe(T(2024, 3, 12, 18, 5))
    expect(parseHevyDate('2024-03-12 18:05')).toBe(T(2024, 3, 12, 18, 5))
    expect(parseHevyDate('nonsense')).toBeNull()
    expect(parseStrongDuration('1h 2m')).toBe(3720)
    expect(parseStrongDuration('45m')).toBe(2700)
    expect(parseStrongDuration('62')).toBe(3720)
    expect(parseStrongDuration('')).toBe(0)
  })

  it('detects the app from the header', () => {
    expect(detectFormat(['title', 'exercise_title'])).toBe('hevy')
    expect(detectFormat(['Date', 'Exercise Name'])).toBe('strong')
    expect(detectFormat(['foo'])).toBeNull()
  })
})

describe('parseHistoryCsv — Strong', () => {
  it('groups by date + workout, keeps warm-ups, skips rest-timer rows, reads cardio', () => {
    const { format, sessions, warnings } = parseHistoryCsv(STRONG_CSV)
    expect(format).toBe('strong')
    expect(warnings).toEqual([])
    expect(sessions).toHaveLength(2)
    const [push, legs] = sessions
    expect(push.name).toBe('Push, heavy')
    expect(push.startedAt).toBe(T(2024, 3, 12, 18, 5))
    expect(push.endedAt).toBe(T(2024, 3, 12, 19, 7))
    expect(push.sets.map(s => [s.exerciseName, s.weightKg, s.reps, s.isWarmup])).toEqual([
      ['Bench Press (Barbell)', 40, 10, true],
      ['Bench Press (Barbell)', 100, 5, false],
      ['Bench Press (Barbell)', 100, 5, false],
      ['Bench Press (Dumbbell)', 30, 10, false],
      ['Running (Treadmill)', 0, 0, false],
    ])
    expect(push.sets[4]).toMatchObject({ durationSec: 1200, distanceM: 3200 })
    expect(legs.sets[0]).toMatchObject({ weightKg: 225, reps: 5 })
  })

  it('converts pounds and miles when the export used them', () => {
    const { sessions } = parseHistoryCsv(STRONG_CSV, { weightUnit: 'lb', distanceUnit: 'mi' })
    expect(sessions[1].sets[0].weightKg).toBe(102.06)
    expect(sessions[0].sets[4].distanceM).toBe(5150)
  })

  it('reads a semicolon export with decimal commas', () => {
    const text = 'Date;Workout Name;Duration;Exercise Name;Set Order;Weight;Reps;Distance;Seconds;Notes;Workout Notes;RPE\n'
      + '2024-03-12 18:05:00;Push;1h;Bench Press (Barbell);1;62,5;8;0;0;;;\n'
    expect(parseHistoryCsv(text).sessions[0].sets[0]).toMatchObject({ weightKg: 62.5, reps: 8 })
  })

  it('warns about unreadable dates and rejects other files', () => {
    const bad = STRONG_CSV + '\nyesterday,Push,1h,Bench Press (Barbell),1,100,5,0,0,,,'
    expect(parseHistoryCsv(bad).warnings[0]).toMatch(/1 row with an unreadable date/)
    expect(() => parseHistoryCsv('a,b\n1,2')).toThrow(/Not a Strong or Hevy export/)
    expect(() => parseHistoryCsv('Date,Exercise Name\n')).toThrow(/no workouts/)
  })
})

describe('parseHistoryCsv — Hevy', () => {
  it('reads sessions with end times, warm-ups, bodyweight and cardio rows', () => {
    const { format, sessions } = parseHistoryCsv(HEVY_CSV)
    expect(format).toBe('hevy')
    expect(sessions.map(s => [s.name, s.startedAt, s.endedAt])).toEqual([
      ['Upper A', T(2024, 3, 12, 18, 5), T(2024, 3, 12, 19, 10)],
      ['Lower', T(2024, 3, 14, 7, 30), T(2024, 3, 14, 8, 20)],
    ])
    expect(sessions[0].sets.map(s => [s.exerciseName, s.weightKg, s.reps, s.isWarmup, s.durationSec ?? 0])).toEqual([
      ['Bench Press (Barbell)', 40, 10, true, 0],
      ['Bench Press (Barbell)', 100, 5, false, 0],
      ['Pull Up', 0, 10, false, 0],
      ['Treadmill', 0, 0, false, 900],
    ])
    expect(sessions[0].sets[3].distanceM).toBe(2500)
  })

  it('reads imperial Hevy columns', () => {
    const text = 'title,start_time,end_time,exercise_title,set_type,weight_lbs,reps,distance_miles,duration_seconds\n'
      + 'A,"12 Mar 2024, 18:05","12 Mar 2024, 19:00",Squat (Barbell),normal,225,5,,\n'
    expect(parseHistoryCsv(text).sessions[0].sets[0].weightKg).toBe(102.06)
  })
})

const ex = (id: number, name: string, equipment: Exercise['equipment'], muscleGroup: Exercise['muscleGroup'] = 'chest'): Exercise =>
  ({ id, name, nameLower: name.toLowerCase(), muscleGroup, equipment, defaultRestSec: 90, isCustom: false })

describe('exercise matching', () => {
  const catalog = [
    ex(1, 'Bench Press', 'barbell'), ex(3, 'Dumbbell Bench Press', 'dumbbell'), ex(14, 'Lat Pulldown', 'cable', 'back'),
    ex(12, 'Pull-Up', 'bodyweight', 'back'), ex(42, 'Barbell Curl', 'barbell', 'biceps'), ex(53, 'Squat', 'barbell', 'legs'),
    ex(78, 'Treadmill Run', 'machine', 'cardio'), ex(99, 'My Custom Move', 'other', 'other'),
  ]

  it('normalizes names and equipment', () => {
    expect(normalizeImportedName('Bench Press (Dumbbell)')).toEqual({ base: 'Bench Press', equipment: 'dumbbell', key: 'benchpress' })
    expect(normalizeImportedName('Triceps Pushdown (Cable - Straight Bar)').equipment).toBe('cable')
    expect(normalizeImportedName('Squat (Smith Machine)').equipment).toBe('machine')
    expect(normalizeImportedName('Plank').equipment).toBeUndefined()
  })

  it('maps catalog lifts and keeps equipment variants apart', () => {
    const m = resolveExercises(
      ['Bench Press (Barbell)', 'Bench Press (Dumbbell)', 'Lat Pulldown (Cable)', 'Pull Up', 'Bicep Curl (Barbell)',
        'Squat (Barbell)', 'Running (Treadmill)', 'my custom move', 'Bench Press (Smith Machine)'],
      catalog,
    )
    const by = Object.fromEntries(m.map(x => [x.raw, x.existing?.id ?? null]))
    expect(by).toEqual({
      'Bench Press (Barbell)': 1,
      'Bench Press (Dumbbell)': 3,
      'Lat Pulldown (Cable)': 14,
      'Pull Up': 12,
      'Bicep Curl (Barbell)': 42,
      'Squat (Barbell)': 53,
      'Running (Treadmill)': 78,
      'my custom move': 99,
      'Bench Press (Smith Machine)': null, // a machine variant is its own exercise
    })
    expect(m[m.length - 1].create).toMatchObject({ name: 'Bench Press (Smith Machine)', muscleGroup: 'chest', equipment: 'machine', isCustom: true })
  })

  it('guesses a muscle group for new exercises', () => {
    expect(guessMuscleGroup('Elliptical Trainer')).toBe('cardio')
    expect(guessMuscleGroup('Triceps Kickback (Dumbbell)')).toBe('triceps')
    expect(guessMuscleGroup('Cable Kickback')).toBe('glutes')
    expect(guessMuscleGroup('Leg Curl (Machine)')).toBe('legs')
    expect(guessMuscleGroup('Spider Curl')).toBe('biceps')
    expect(guessMuscleGroup('Upright Row (Cable)')).toBe('shoulders')
    expect(guessMuscleGroup('Meadows Row')).toBe('back')
    expect(guessMuscleGroup('Farmer Carry')).toBe('other')
  })
})

describe('planImportScoring', () => {
  const session = (startedAt: number, sets: [string, number, number, boolean?][]): ImportedSession => ({
    name: 'S', startedAt, endedAt: startedAt + 3_600_000,
    sets: sets.map(([exerciseName, weightKg, reps, isWarmup]) => ({ exerciseName, weightKg, reps, isWarmup: !!isWarmup })),
  })
  const ctx = (over = {}) => ({
    exerciseIdOf: (raw: string) => (raw === 'Bench' ? 1 : raw === 'Squat' ? 2 : 3),
    exerciseNames: new Map<number | string, string>([[1, 'Bench Press'], [2, 'Squat'], [3, 'Treadmill Run']]),
    seasonStart: '2024-03-13',
    existingSets: [],
    existingSessionStarts: [],
    bodyweightFor: () => 80,
    ...over,
  })

  it('scores in time order with prior bests from earlier sessions only', () => {
    const plans = planImportScoring([
      session(T(2024, 3, 14, 18), [['Bench', 105, 5]]),
      session(T(2024, 3, 12, 18), [['Bench', 40, 10, true], ['Bench', 100, 5], ['Squat', 120, 5]]),
    ], ctx())
    expect(plans.map(p => p.event.date)).toEqual(['2024-03-12', '2024-03-14'])
    // First ever bench: no prior → no PR. Later 105×5 beats 100×5, but the season started in between,
    // so the in-season session only compares against in-season history (none) → no PR either.
    expect(plans[0].event.breakdown.map(b => b.e1rmPr)).toEqual([false, false])
    expect(plans[1].event.breakdown[0].e1rmPr).toBe(false)
    // Only the in-season session adds rank points.
    expect(plans[0].pointsDelta).toBe(0)
    expect(plans[1].pointsDelta).toBe(plans[1].event.total)
    expect(plans[1].pointsDelta).toBeGreaterThan(0)
  })

  it('flags a PR against earlier history outside the season', () => {
    const plans = planImportScoring([
      session(T(2024, 3, 1, 18), [['Bench', 100, 5]]),
      session(T(2024, 3, 5, 18), [['Bench', 105, 5]]),
    ], ctx())
    expect(plans[1].event.breakdown[0].e1rmPr).toBe(true)
    expect(plans[1].event.prBonus).toBeGreaterThan(0)
  })

  it('numbers sets per exercise, spreads them inside the session and halves a second session that day', () => {
    const start = T(2024, 3, 14, 18)
    const plans = planImportScoring([session(start, [['Bench', 60, 10, true], ['Squat', 100, 5], ['Bench', 100, 5]])],
      ctx({ existingSessionStarts: [T(2024, 3, 14, 7)] }))
    const [p] = plans
    expect(p.sets.map(s => [s.exerciseId, s.setNumber])).toEqual([[1, 1], [2, 1], [1, 2]])
    expect(p.sets.every(s => s.completedAt > start && s.completedAt < start + 3_600_000)).toBe(true)
    expect(p.sets[0].completedAt).toBeLessThan(p.sets[2].completedAt)
    expect(p.event.dayFactor).toBe(0.25)
    expect(p.event.streakMult).toBe(1)
  })

  it('keeps cardio rows out of the points', () => {
    const plans = planImportScoring([{
      name: 'Run', startedAt: T(2024, 3, 14, 7), endedAt: T(2024, 3, 14, 8),
      sets: [{ exerciseName: 'Run', weightKg: 0, reps: 0, isWarmup: false, durationSec: 1800, distanceM: 5000 }],
    }], ctx())
    expect(plans[0].event.total).toBe(0)
    expect(plans[0].sets[0]).toMatchObject({ durationSec: 1800, distanceM: 5000, e1rm: 0 })
  })
})
