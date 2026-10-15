import { parseCsv } from './csv'
import { epley, scoreSession } from './scoring'
import { localDateStr, parseLocalDate } from './dates'
import { isCardioSet } from './cardio'
import type { Equipment, Exercise, ExerciseBreakdown, Id, MuscleGroup } from '../types'

/**
 * Workout history import from Strong and Hevy CSV exports (pure parsing,
 * exercise matching and scoring; the DB side is importApply.ts).
 *
 * Strong (Settings › Export data): `Date, Workout Name, Duration, Exercise Name,
 * Set Order, Weight, Reps, Distance, Seconds, Notes, Workout Notes, RPE`, `,` or
 * `;` separated; Date `2024-03-12 18:05:00` (local), Duration `1h 2m`; Weight and
 * Distance in the app's units (kg/lb, km/mi), so the user picks them. Set Order
 * is a number, `W…` for a warm-up, `D…`/`F…` for drop/failure sets, or a text
 * row such as "Rest Timer" (skipped).
 *
 * Hevy (Settings › Export & import data): `title, start_time, end_time,
 * description, exercise_title, superset_id, exercise_notes, set_index, set_type,
 * weight_kg, reps, distance_km, duration_seconds, rpe`; times `12 Mar 2024, 18:05`;
 * set_type `normal|warmup|failure|dropset`. Imperial exports carry `weight_lbs` /
 * `distance_miles` columns instead.
 */

export type ImportFormat = 'strong' | 'hevy'

export interface ImportOptions {
  /** Strong only: the units its Weight / Distance columns are in. */
  weightUnit: 'kg' | 'lb'
  distanceUnit: 'km' | 'mi'
}

export const DEFAULT_IMPORT_OPTIONS: ImportOptions = { weightUnit: 'kg', distanceUnit: 'km' }

export interface ImportedSet {
  exerciseName: string
  weightKg: number
  reps: number
  isWarmup: boolean
  /** Cardio rows (no reps). */
  durationSec?: number
  distanceM?: number
}

export interface ImportedSession {
  name: string
  startedAt: number
  endedAt: number
  /** In logged order. */
  sets: ImportedSet[]
}

export interface ParsedHistory {
  format: ImportFormat
  sessions: ImportedSession[]
  warnings: string[]
}

const LB = 0.45359237
const MILE = 1609.344
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** Which app wrote this header row, or null. */
export function detectFormat(header: string[]): ImportFormat | null {
  const cols = header.map(h => h.trim().toLowerCase())
  if (cols.includes('exercise_title')) return 'hevy'
  if (cols.includes('exercise name')) return 'strong'
  return null
}

/** "62.5", "62,5" (decimal comma), "" → NaN. */
function num(v: string | undefined): number {
  if (v === undefined) return NaN
  const t = v.trim().replace(',', '.')
  return t === '' ? NaN : Number(t)
}

const r2 = (v: number) => Math.round(v * 100) / 100

/** "2024-03-12 18:05:00" / "2024-03-12T18:05" → local ms. */
export function parseStrongDate(v: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(v.trim())
  if (!m) return null
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)).getTime()
}

/** "12 Mar 2024, 18:05" (Hevy) → local ms; falls back to the ISO-like Strong form. */
export function parseHevyDate(v: string): number | null {
  const m = /^(\d{1,2}) ([A-Za-z]{3})[a-z]* (\d{4}),? (\d{1,2}):(\d{2})/.exec(v.trim())
  if (m) {
    const month = MONTHS.indexOf(m[2].toLowerCase())
    if (month >= 0) return new Date(+m[3], month, +m[1], +m[4], +m[5]).getTime()
  }
  return parseStrongDate(v)
}

/** "1h 2m" → 3720, "45m" → 2700, "50s" → 50, "62" (minutes) → 3720. */
export function parseStrongDuration(v: string | undefined): number {
  if (!v) return 0
  const t = v.trim().toLowerCase()
  if (/^\d+(\.\d+)?$/.test(t)) return Math.round(Number(t) * 60)
  const h = /(\d+)\s*h/.exec(t)
  const m = /(\d+)\s*m(?!s)/.exec(t)
  const s = /(\d+)\s*s/.exec(t)
  return (h ? +h[1] * 3600 : 0) + (m ? +m[1] * 60 : 0) + (s ? +s[1] : 0)
}

function columns(header: string[]) {
  const idx = new Map(header.map((h, i) => [h.trim().toLowerCase(), i]))
  return (row: string[], name: string): string | undefined => {
    const i = idx.get(name)
    return i === undefined ? undefined : row[i]
  }
}

/** One parsed row → a set, or null for a row that isn't a set (rest timer, empty). */
function toSet(
  exerciseName: string,
  weightKg: number,
  reps: number,
  isWarmup: boolean,
  durationSec: number,
  distanceM: number,
): ImportedSet | null {
  const w = Number.isFinite(weightKg) && weightKg > 0 ? r2(weightKg) : 0
  const r = Number.isFinite(reps) && reps > 0 ? Math.round(reps) : 0
  const d = Number.isFinite(durationSec) && durationSec > 0 ? Math.round(durationSec) : 0
  const m = Number.isFinite(distanceM) && distanceM > 0 ? Math.round(distanceM) : 0
  if (r > 0) return { exerciseName, weightKg: w, reps: r, isWarmup }
  // No reps: a cardio row when it has a time; a distance alone gets no duration to show, so skip it.
  if (d > 0) return { exerciseName, weightKg: 0, reps: 0, isWarmup: false, durationSec: d, ...(m > 0 ? { distanceM: m } : {}) }
  return null
}

interface Group { name: string; startedAt: number; endedAt?: number; sets: ImportedSet[] }

function finish(groups: Map<string, Group>): ImportedSession[] {
  return [...groups.values()]
    .filter(g => g.sets.length > 0)
    .map(g => ({
      name: g.name,
      startedAt: g.startedAt,
      // No duration in the file: assume ~3 minutes per set.
      endedAt: g.endedAt && g.endedAt > g.startedAt ? g.endedAt : g.startedAt + Math.max(10, g.sets.length * 3) * 60_000,
      sets: g.sets,
    }))
    .sort((a, b) => a.startedAt - b.startedAt)
}

export function parseStrong(rows: string[][], opts: ImportOptions = DEFAULT_IMPORT_OPTIONS): ParsedHistory {
  const [header, ...body] = rows
  const col = columns(header)
  const warnings: string[] = []
  const groups = new Map<string, Group>()
  let badDates = 0
  for (const row of body) {
    const date = col(row, 'date') ?? ''
    const startedAt = parseStrongDate(date)
    if (startedAt === null) {
      badDates++
      continue
    }
    const name = (col(row, 'workout name') ?? '').trim() || 'Imported workout'
    const exerciseName = (col(row, 'exercise name') ?? '').trim()
    if (!exerciseName) continue
    const order = (col(row, 'set order') ?? '').trim()
    let isWarmup = false
    if (/^w\d*$/i.test(order)) isWarmup = true
    else if (!/^\d+$/.test(order) && !/^[df]\d*$/i.test(order)) continue // "Rest Timer" and other non-set rows
    const weight = num(col(row, 'weight')) * (opts.weightUnit === 'lb' ? LB : 1)
    const distance = num(col(row, 'distance')) * (opts.distanceUnit === 'mi' ? MILE : 1000)
    const set = toSet(exerciseName, weight, num(col(row, 'reps')), isWarmup, num(col(row, 'seconds')), distance)
    if (!set) continue
    const key = `${date.trim()}|${name}`
    let g = groups.get(key)
    if (!g) {
      const dur = parseStrongDuration(col(row, 'duration'))
      g = { name, startedAt, endedAt: dur > 0 ? startedAt + dur * 1000 : undefined, sets: [] }
      groups.set(key, g)
    }
    g.sets.push(set)
  }
  if (badDates > 0) warnings.push(`${badDates} row${badDates === 1 ? '' : 's'} with an unreadable date were skipped.`)
  return { format: 'strong', sessions: finish(groups), warnings }
}

export function parseHevy(rows: string[][]): ParsedHistory {
  const [header, ...body] = rows
  const col = columns(header)
  const warnings: string[] = []
  const groups = new Map<string, Group>()
  const imperialWeight = header.some(h => h.trim().toLowerCase() === 'weight_lbs')
  const imperialDistance = header.some(h => h.trim().toLowerCase() === 'distance_miles')
  let badDates = 0
  for (const row of body) {
    const start = col(row, 'start_time') ?? ''
    const startedAt = parseHevyDate(start)
    if (startedAt === null) {
      badDates++
      continue
    }
    const name = (col(row, 'title') ?? '').trim() || 'Imported workout'
    const exerciseName = (col(row, 'exercise_title') ?? '').trim()
    if (!exerciseName) continue
    const isWarmup = (col(row, 'set_type') ?? '').trim().toLowerCase() === 'warmup'
    const weight = imperialWeight ? num(col(row, 'weight_lbs')) * LB : num(col(row, 'weight_kg'))
    const distance = imperialDistance ? num(col(row, 'distance_miles')) * MILE : num(col(row, 'distance_km')) * 1000
    const set = toSet(exerciseName, weight, num(col(row, 'reps')), isWarmup, num(col(row, 'duration_seconds')), distance)
    if (!set) continue
    const key = `${start.trim()}|${name}`
    let g = groups.get(key)
    if (!g) {
      const end = parseHevyDate(col(row, 'end_time') ?? '')
      g = { name, startedAt, endedAt: end ?? undefined, sets: [] }
      groups.set(key, g)
    }
    g.sets.push(set)
  }
  if (badDates > 0) warnings.push(`${badDates} row${badDates === 1 ? '' : 's'} with an unreadable date were skipped.`)
  return { format: 'hevy', sessions: finish(groups), warnings }
}

/** Parses a Strong or Hevy export. Throws a user-facing Error for anything else. */
export function parseHistoryCsv(text: string, opts: ImportOptions = DEFAULT_IMPORT_OPTIONS): ParsedHistory {
  const rows = parseCsv(text)
  if (rows.length < 2) throw new Error('The file has no workouts in it.')
  const format = detectFormat(rows[0])
  if (!format) throw new Error('Not a Strong or Hevy export (unknown columns).')
  const parsed = format === 'hevy' ? parseHevy(rows) : parseStrong(rows, opts)
  if (parsed.sessions.length === 0) throw new Error('No sets found in the file.')
  return parsed
}

/* ---------- exercise matching ---------- */

const EQUIPMENT_WORDS: [RegExp, Equipment][] = [
  [/smith/, 'machine'],
  [/barbell|ez ?bar|trap ?bar/, 'barbell'],
  [/dumbbell/, 'dumbbell'],
  [/cable/, 'cable'],
  [/machine|plate ?loaded|lever|assisted/, 'machine'],
  [/bodyweight|weighted/, 'bodyweight'],
  [/kettlebell|band|other/, 'other'],
]

const alnum = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** "Bench Press (Dumbbell)" → { base: "Bench Press", equipment: 'dumbbell', key: "benchpress" }. */
export function normalizeImportedName(raw: string): { base: string; equipment?: Equipment; key: string } {
  const m = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(raw.trim())
  const base = (m ? m[1] : raw).trim()
  let equipment: Equipment | undefined
  if (m) {
    const inner = m[2].toLowerCase()
    equipment = EQUIPMENT_WORDS.find(([re]) => re.test(inner))?.[1]
  }
  return { base, equipment, key: alnum(base) }
}

/**
 * Import names (alnum of the full name, parenthetical included) → catalog names
 * (src/db/seed.ts) where the generic matcher can't get there by itself.
 */
const ALIASES: Record<string, string> = {
  pushup: 'Push-Up', pushups: 'Push-Up', chestdip: 'Dips', dip: 'Dips', dips: 'Dips', chestdipassisted: 'Dips',
  pullup: 'Pull-Up', pullups: 'Pull-Up', pullupassisted: 'Pull-Up', pullupweighted: 'Pull-Up', chinup: 'Chin-Up', chinups: 'Chin-Up',
  benchpressbarbell: 'Bench Press', inclinebenchpressbarbell: 'Incline Bench Press',
  benchpressdumbbell: 'Dumbbell Bench Press', inclinebenchpressdumbbell: 'Incline Dumbbell Press',
  chestpressmachine: 'Chest Press Machine', chestflydumbbell: 'Chest Fly', chestfly: 'Chest Fly',
  cablecrossover: 'Cable Crossover', cableflycrossovers: 'Cable Crossover', pecdeckmachine: 'Pec Deck', butterflypecdeck: 'Pec Deck',
  deadliftbarbell: 'Deadlift', latpulldowncable: 'Lat Pulldown', latpulldownmachine: 'Lat Pulldown',
  bentoverrowbarbell: 'Barbell Row', barbellrow: 'Barbell Row', pendlayrowbarbell: 'Barbell Row',
  bentoveronearmrowdumbbell: 'Dumbbell Row', dumbbellrow: 'Dumbbell Row',
  seatedrowcable: 'Seated Cable Row', seatedcablerowvgripcable: 'Seated Cable Row', seatedcablerowbargripcable: 'Seated Cable Row',
  tbarrow: 'T-Bar Row', tbarrowmachine: 'T-Bar Row', straightarmpulldowncable: 'Straight-Arm Pulldown', backextension: 'Back Extension',
  backextensionhyperextension: 'Back Extension',
  overheadpressbarbell: 'Overhead Press', strictmilitarypress: 'Overhead Press', shoulderpressdumbbell: 'Seated Dumbbell Press',
  seatedshoulderpressdumbbell: 'Seated Dumbbell Press', arnoldpressdumbbell: 'Arnold Press', lateralraisedumbbell: 'Lateral Raise',
  lateralraisecable: 'Cable Lateral Raise', frontraisedumbbell: 'Front Raise', reverseflydumbbell: 'Rear Delt Fly',
  rearflydumbbell: 'Rear Delt Fly', facepullcable: 'Face Pull', facepull: 'Face Pull', uprightrowbarbell: 'Upright Row',
  shrugdumbbell: 'Shrug',
  bicepcurlbarbell: 'Barbell Curl', bicepcurldumbbell: 'Dumbbell Curl', bicepcurlcable: 'Cable Curl',
  hammercurldumbbell: 'Hammer Curl', inclinecurldumbbell: 'Incline Dumbbell Curl', preachercurlmachine: 'Preacher Curl',
  preachercurlbarbell: 'Preacher Curl',
  benchpressclosegripbarbell: 'Close-Grip Bench Press', closegripbenchpress: 'Close-Grip Bench Press',
  skullcrusherbarbell: 'Skull Crusher', skullcrusher: 'Skull Crusher', triceppushdown: 'Triceps Pushdown',
  tricepspushdown: 'Triceps Pushdown', tricepspushdowncablestraightbar: 'Triceps Pushdown', triceppushdowncable: 'Triceps Pushdown',
  tricepsropepushdown: 'Triceps Pushdown', tricepsextensioncable: 'Overhead Triceps Extension',
  overheadtricepsextensioncable: 'Overhead Triceps Extension',
  squatbarbell: 'Squat', fullsquat: 'Squat', frontsquatbarbell: 'Front Squat', gobletsquatkettlebell: 'Goblet Squat',
  gobletsquatdumbbell: 'Goblet Squat', legpress: 'Leg Press', legpressmachine: 'Leg Press', hacksquat: 'Hack Squat',
  hacksquatmachine: 'Hack Squat', romaniandeadliftbarbell: 'Romanian Deadlift', sumodeadliftbarbell: 'Sumo Deadlift',
  legextensionmachine: 'Leg Extension', lyinglegcurlmachine: 'Leg Curl', seatedlegcurlmachine: 'Leg Curl',
  bulgariansplitsquat: 'Bulgarian Split Squat', bulgariansplitsquatdumbbell: 'Bulgarian Split Squat',
  walkinglungedumbbell: 'Walking Lunge', lungedumbbell: 'Walking Lunge', standingcalfraisemachine: 'Standing Calf Raise',
  seatedcalfraiseplateloaded: 'Seated Calf Raise', seatedcalfraisemachine: 'Seated Calf Raise',
  hipthrustbarbell: 'Hip Thrust', glutekickbackcable: 'Glute Kickback', hipabductormachine: 'Hip Abduction',
  hipabductionmachine: 'Hip Abduction',
  abwheel: 'Ab Wheel Rollout', crunchmachine: 'Crunch', cablecrunch: 'Cable Crunch', hanginglegraise: 'Hanging Leg Raise',
  runningtreadmill: 'Treadmill Run', treadmill: 'Treadmill Run', running: 'Treadmill Run', rowingmachine: 'Rowing Machine',
  rowing: 'Rowing Machine', cyclingindoor: 'Stationary Bike', cycling: 'Stationary Bike', spinning: 'Stationary Bike',
  stationarybike: 'Stationary Bike', jumprope: 'Jump Rope',
}

const MUSCLE_RULES: [RegExp, MuscleGroup][] = [
  [/run|treadmill|cycl|bike|elliptical|row(ing)? machine|^rowing|swim|walk(?!ing lunge)|stair|jump rope|hiit|cardio|ski erg/i, 'cardio'],
  [/tricep|skull ?crush|pushdown|close.?grip/i, 'triceps'],
  [/hip thrust|glute|abduct|kickback|bridge/i, 'glutes'],
  [/crunch|plank|sit ?up|leg raise|twist|ab wheel|\babs?\b|oblique|hollow|v ?up/i, 'core'],
  [/romanian|squat|lunge|leg (press|extension|curl)|calf|step ?up|hamstring|quad|adduct/i, 'legs'],
  [/curl/i, 'biceps'],
  [/bench|chest|fly|pec|push.?up|dip/i, 'chest'],
  [/overhead|shoulder|military|lateral|raise|delt|face pull|shrug|upright|arnold/i, 'shoulders'],
  [/row|pull.?up|chin.?up|pulldown|deadlift|back ext|good ?morning|pullover/i, 'back'],
]

export function guessMuscleGroup(name: string): MuscleGroup {
  return MUSCLE_RULES.find(([re]) => re.test(name))?.[1] ?? 'other'
}

export interface ExerciseMatch {
  raw: string
  /** An existing exercise, or null when one will be created. */
  existing: Exercise | null
  /** Template for a new custom exercise (when `existing` is null). */
  create?: Omit<Exercise, 'id'>
}

/**
 * Maps every imported exercise name to the catalog or a custom exercise.
 * Equipment variants stay separate (ROUTEMAP invariant 6): "Bench Press
 * (Dumbbell)" never lands on the barbell "Bench Press".
 */
export function resolveExercises(rawNames: string[], catalog: Exercise[]): ExerciseMatch[] {
  const byLower = new Map(catalog.map(e => [e.nameLower, e]))
  const byKey = new Map<string, Exercise[]>()
  for (const e of catalog) byKey.set(alnum(e.name), [...(byKey.get(alnum(e.name)) ?? []), e])
  const fits = (e: Exercise, equipment?: Equipment) => !equipment || !e.equipment || e.equipment === equipment

  return [...new Set(rawNames)].map(raw => {
    const exact = byLower.get(raw.trim().toLowerCase())
    if (exact) return { raw, existing: exact } // e.g. a custom made by an earlier import
    const { base, equipment, key } = normalizeImportedName(raw)
    const alias = ALIASES[alnum(raw)] ?? ALIASES[key]
    if (alias) {
      const hit = byLower.get(alias.toLowerCase())
      if (hit) return { raw, existing: hit }
    }
    const word = equipment && equipment !== 'other' ? equipment : null
    const candidates = word ? [`${word} ${base}`, `${base} ${word}`, base] : [base]
    for (const c of candidates) {
      const hit = (byKey.get(alnum(c)) ?? []).find(e => fits(e, equipment))
      if (hit) return { raw, existing: hit }
    }
    const name = raw.trim()
    return {
      raw,
      existing: null,
      create: {
        name,
        nameLower: name.toLowerCase(),
        muscleGroup: guessMuscleGroup(name),
        equipment: equipment ?? 'other',
        defaultRestSec: 90,
        isCustom: true,
      },
    }
  })
}

/* ---------- scoring the imported history ---------- */

export interface PlannedSetRow {
  exerciseId: Id
  setNumber: number
  weightKg: number
  reps: number
  isWarmup: boolean
  completedAt: number
  e1rm: number
  durationSec?: number
  distanceM?: number
}

export interface PlannedImportSession {
  name: string
  startedAt: number
  endedAt: number
  sets: PlannedSetRow[]
  event: {
    date: string
    basePoints: number
    prBonus: number
    streakMult: number
    dayFactor: number
    total: number
    breakdown: ExerciseBreakdown[]
  }
  /** Points added to the rank: the event total for a session in the current season, else 0. */
  pointsDelta: number
}

export interface ImportScoringContext {
  exerciseIdOf: (rawName: string) => Id
  exerciseNames: Map<Id, string>
  /** YYYY-MM-DD; sessions before it are history and add no rank points. */
  seasonStart: string
  /** Sets already in the app (for prior bests), any order. */
  existingSets: { exerciseId: Id; weightKg: number; reps: number; isWarmup: boolean; completedAt: number; sessionId: Id }[]
  /** Start times of the app's finished sessions (for the same-day factor). */
  existingSessionStarts: number[]
  bodyweightFor: (date: string) => number
}

/**
 * Scores imported sessions the way finishSession would have, in time order,
 * with prior bests from sets strictly BEFORE each session (the app's own and
 * the earlier imported ones): season-scoped for a session in the current
 * season, all earlier history for an older one. No streak (0) and no points
 * outside the current season; the same-day factor counts the day's earlier
 * sessions.
 */
export function planImportScoring(sessions: ImportedSession[], ctx: ImportScoringContext): PlannedImportSession[] {
  const seasonStartMs = parseLocalDate(ctx.seasonStart).getTime()
  const history = ctx.existingSets
    .filter(s => !s.isWarmup && s.weightKg > 0 && s.reps > 0)
    .map(s => ({ exerciseId: s.exerciseId, sessionKey: `x${String(s.sessionId)}`, t: s.completedAt, e1rm: epley(s.weightKg, s.reps), vol: s.weightKg * s.reps }))
  const starts = [...ctx.existingSessionStarts]
  const out: PlannedImportSession[] = []

  for (const [n, imp] of [...sessions].sort((a, b) => a.startedAt - b.startedAt).entries()) {
    const since = imp.startedAt >= seasonStartMs ? seasonStartMs : -Infinity
    const prior = history.filter(h => h.t >= since && h.t < imp.startedAt)
    const priorBestE1rm = new Map<Id, number>()
    const volBySession = new Map<string, { ex: Id; vol: number }>()
    for (const h of prior) {
      priorBestE1rm.set(h.exerciseId, Math.max(priorBestE1rm.get(h.exerciseId) ?? 0, h.e1rm))
      const k = `${h.sessionKey}|${String(h.exerciseId)}`
      volBySession.set(k, { ex: h.exerciseId, vol: (volBySession.get(k)?.vol ?? 0) + h.vol })
    }
    const priorBestVolume = new Map<Id, number>()
    for (const { ex, vol } of volBySession.values()) priorBestVolume.set(ex, Math.max(priorBestVolume.get(ex) ?? 0, vol))

    const span = Math.max(1, imp.endedAt - imp.startedAt)
    const perExercise = new Map<Id, number>()
    const sets: PlannedSetRow[] = imp.sets.map((s, i) => {
      const exerciseId = ctx.exerciseIdOf(s.exerciseName)
      const setNumber = (perExercise.get(exerciseId) ?? 0) + 1
      perExercise.set(exerciseId, setNumber)
      return {
        exerciseId,
        setNumber,
        weightKg: s.weightKg,
        reps: s.reps,
        isWarmup: s.isWarmup,
        // Spread inside the session so ordering and per-day queries hold.
        completedAt: imp.startedAt + Math.round(((i + 1) * span) / (imp.sets.length + 1)),
        e1rm: epley(s.weightKg, s.reps),
        ...(s.durationSec ? { durationSec: s.durationSec } : {}),
        ...(s.distanceM ? { distanceM: s.distanceM } : {}),
      }
    })

    const date = localDateStr(new Date(imp.startedAt))
    const sameDayEarlier = starts.some(t => t < imp.startedAt && localDateStr(new Date(t)) === date)
    const result = scoreSession({
      sets,
      bodyweightKg: ctx.bodyweightFor(date),
      priorBestE1rm,
      priorBestVolume,
      streakWeeks: 0,
      isFirstSessionOfDay: !sameDayEarlier,
      exerciseNames: ctx.exerciseNames,
    })
    out.push({
      name: imp.name,
      startedAt: imp.startedAt,
      endedAt: imp.endedAt,
      sets,
      event: { date, ...result },
      pointsDelta: imp.startedAt >= seasonStartMs ? result.total : 0,
    })
    starts.push(imp.startedAt)
    for (const s of sets) {
      if (s.isWarmup || isCardioSet(s) || s.weightKg <= 0 || s.reps <= 0) continue
      history.push({ exerciseId: s.exerciseId, sessionKey: `i${n}`, t: s.completedAt, e1rm: s.e1rm, vol: s.weightKg * s.reps })
    }
  }
  return out
}
