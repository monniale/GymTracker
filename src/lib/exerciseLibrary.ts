import { useEffect, useState } from 'react'
import { db } from '../db/db'
import { t, type Key } from '../i18n'
import type { Lang } from './uiStore'
import type { Equipment, Exercise, MuscleGroup } from '../types'

/**
 * The exercise library: 1,324 exercises from hasaneyldrm/exercises-dataset (data MIT), built into
 * `public/exercise-library.json` by `scripts/build-exercise-library.mjs` and fetched on first use
 * (precached by the service worker, bundled in the APK). Library entries are not exercises until
 * the user picks one: `addLibraryExercise` then writes an `Exercise` row with a deterministic id,
 * so the same pick on two devices merges into one row.
 */
export interface LibraryExercise {
  /** Dataset id, e.g. "0025". */
  id: string
  /** Title-cased English name (the stored name of a row added from it). */
  name: string
  /** Dataset body part: "chest", "upper legs", "waist", "cardio"… */
  bodyPart: string
  /** Dataset equipment: "barbell", "leverage machine", "body weight"… (see `libEquipment`). */
  equipment: string
  /** Primary target muscle (one of `LIBRARY_TARGETS`). */
  target: string
  secondary: string[]
  steps: Record<Lang, string[]>
  /** Media file stem ("0025-EIeI8Vf"): images/<stem>.jpg and videos/<stem>.gif in the dataset repo. */
  media: string
}

export interface ExerciseLibrary {
  exercises: LibraryExercise[]
  byId: Map<string, LibraryExercise>
  /** Dataset repo at the pinned commit, for the opt-in media. */
  mediaBase: string
  /** Credit every shown image must carry. */
  attribution: string
}

/** Target muscles in head-to-toe order, plus the cardio "muscle". */
export const LIBRARY_TARGETS = [
  'traps', 'levator scapulae', 'delts', 'pectorals', 'serratus anterior', 'biceps', 'triceps', 'forearms',
  'abs', 'upper back', 'lats', 'spine', 'glutes', 'abductors', 'adductors', 'quads', 'hamstrings', 'calves',
  'cardiovascular system',
] as const

/** The app's coarse muscle group for each target (what a row added from the library is filed under). */
const TARGET_GROUP: Record<string, MuscleGroup> = {
  'traps': 'shoulders',
  'levator scapulae': 'other',
  'delts': 'shoulders',
  'pectorals': 'chest',
  'serratus anterior': 'chest',
  'biceps': 'biceps',
  'triceps': 'triceps',
  'forearms': 'other',
  'abs': 'core',
  'upper back': 'back',
  'lats': 'back',
  'spine': 'back',
  'glutes': 'glutes',
  'abductors': 'glutes',
  'adductors': 'legs',
  'quads': 'legs',
  'hamstrings': 'legs',
  'calves': 'legs',
  'cardiovascular system': 'cardio',
}

/** Dataset equipment → the app's six. Plate maths and the warm-up ramp only follow 'barbell'. */
const EQUIPMENT_MAP: Record<string, Equipment> = {
  'barbell': 'barbell',
  'ez barbell': 'barbell',
  'olympic barbell': 'barbell',
  'trap bar': 'barbell',
  'dumbbell': 'dumbbell',
  'cable': 'cable',
  'leverage machine': 'machine',
  'smith machine': 'machine',
  'sled machine': 'machine',
  'stationary bike': 'machine',
  'elliptical machine': 'machine',
  'skierg machine': 'machine',
  'stepmill machine': 'machine',
  'upper body ergometer': 'machine',
  'body weight': 'bodyweight',
  'weighted': 'bodyweight',
}

export function libEquipment(lib: Pick<LibraryExercise, 'equipment'>): Equipment {
  return EQUIPMENT_MAP[lib.equipment] ?? 'other'
}

export function libMuscleGroup(lib: Pick<LibraryExercise, 'target' | 'bodyPart'>): MuscleGroup {
  return TARGET_GROUP[lib.target] ?? (lib.bodyPart === 'cardio' ? 'cardio' : 'other')
}

/** Body parts that imply a group of their own (squats target the glutes but are leg exercises too). */
const BODY_PART_GROUP: Record<string, MuscleGroup> = {
  'upper legs': 'legs',
  'lower legs': 'legs',
  'waist': 'core',
  'chest': 'chest',
  'back': 'back',
  'shoulders': 'shoulders',
  'cardio': 'cardio',
}

/** A library entry passes a muscle-group filter by its target's group or by its body part. */
export function libMatchesGroup(lib: Pick<LibraryExercise, 'target' | 'bodyPart'>, group: MuscleGroup): boolean {
  return libMuscleGroup(lib) === group || BODY_PART_GROUP[lib.bodyPart] === group
}

/** The coarse group a target belongs to (used to filter custom rows that have no library link). */
export function targetGroup(target: string): MuscleGroup {
  return TARGET_GROUP[target] ?? 'other'
}

/**
 * Library entries for the built-in catalog (`ROWS` in src/db/seed.ts), by English name: catalog
 * rows show the entry's muscles and instructions and hide it from the library list. Names without
 * a fair match (Glute Kickback, Plank, Rowing Machine) are left out.
 */
export const SEED_LIBRARY_IDS: Record<string, string> = {
  'Bench Press': '0025',
  'Incline Bench Press': '0047',
  'Dumbbell Bench Press': '0289',
  'Incline Dumbbell Press': '0314',
  'Chest Press Machine': '0577',
  'Chest Fly': '0308',
  'Cable Crossover': '0155',
  'Pec Deck': '0596',
  'Push-Up': '0662',
  'Dips': '0251',
  'Deadlift': '0032',
  'Pull-Up': '0652',
  'Chin-Up': '1326',
  'Lat Pulldown': '0150',
  'Barbell Row': '0027',
  'Dumbbell Row': '0293',
  'Seated Cable Row': '0861',
  'T-Bar Row': '0606',
  'Straight-Arm Pulldown': '0238',
  'Back Extension': '0489',
  'Overhead Press': '1456',
  'Seated Dumbbell Press': '0405',
  'Arnold Press': '2137',
  'Lateral Raise': '0334',
  'Cable Lateral Raise': '0178',
  'Front Raise': '0310',
  'Rear Delt Fly': '0378',
  'Face Pull': '0203',
  'Upright Row': '0120',
  'Shrug': '0406',
  'Barbell Curl': '0031',
  'Dumbbell Curl': '0294',
  'Hammer Curl': '0313',
  'Incline Dumbbell Curl': '0318',
  'Preacher Curl': '0592',
  'Cable Curl': '0868',
  'Close-Grip Bench Press': '0030',
  'Skull Crusher': '0060',
  'Triceps Pushdown': '0241',
  'Overhead Triceps Extension': '0194',
  'Triceps Dip Machine': '0591',
  'Squat': '0043',
  'Front Squat': '0042',
  'Goblet Squat': '1760',
  'Leg Press': '0739',
  'Hack Squat': '0743',
  'Romanian Deadlift': '0085',
  'Sumo Deadlift': '0117',
  'Leg Extension': '0585',
  'Leg Curl': '0586',
  'Bulgarian Split Squat': '0410',
  'Walking Lunge': '1460',
  'Standing Calf Raise': '0605',
  'Seated Calf Raise': '0594',
  'Hip Thrust': '1409',
  'Hip Abduction': '0597',
  'Crunch': '0274',
  'Cable Crunch': '0175',
  'Hanging Leg Raise': '0472',
  'Russian Twist': '0687',
  'Ab Wheel Rollout': '0857',
  'Treadmill Run': '0685',
  'Stationary Bike': '2138',
  'Jump Rope': '2612',
}

/** The library entry an exercise row stands for, if any. */
export function libraryIdOf(e: Pick<Exercise, 'name' | 'isCustom' | 'libraryId'>): string | undefined {
  if (e.libraryId) return e.libraryId
  return !e.isCustom && Object.prototype.hasOwnProperty.call(SEED_LIBRARY_IDS, e.name) ? SEED_LIBRARY_IDS[e.name] : undefined
}

/** Row id of an exercise added from the library: the same on every device. */
export function libraryRowId(libId: string): string {
  return `lib-${libId}`
}

type RawRow = [string, string, string, string, string, string[], string[], string[], string]

/** Parse `public/exercise-library.json` (rows are positional tuples to keep the file small). */
export function parseLibrary(raw: unknown): ExerciseLibrary {
  const data = raw as { exercises?: RawRow[]; media?: { base?: string; attribution?: string } }
  if (!data || !Array.isArray(data.exercises)) throw new Error('Bad exercise library file')
  const exercises = data.exercises.map(([id, name, bodyPart, equipment, target, secondary, stepsEn, stepsIt, media]) => ({
    id, name, bodyPart, equipment, target, secondary, steps: { en: stepsEn, it: stepsIt }, media,
  }))
  exercises.sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1))
  return {
    exercises,
    byId: new Map(exercises.map(e => [e.id, e])),
    mediaBase: data.media?.base ?? '',
    attribution: data.media?.attribution ?? '',
  }
}

let loading: Promise<ExerciseLibrary> | null = null

/** Fetch + parse the library once per app run (a failed fetch is retried on the next call). */
export function loadExerciseLibrary(): Promise<ExerciseLibrary> {
  loading ??= fetch(`${import.meta.env.BASE_URL}exercise-library.json`)
    .then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    })
    .then(parseLibrary)
    .catch(err => {
      loading = null
      throw err
    })
  return loading
}

/** React: the library once loaded (null while loading), and whether loading failed. */
export function useExerciseLibrary(): { library: ExerciseLibrary | null; failed: boolean; retry: () => void } {
  const [library, setLibrary] = useState<ExerciseLibrary | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let live = true
    setFailed(false)
    loadExerciseLibrary().then(
      lib => { if (live) setLibrary(lib) },
      () => { if (live) setFailed(true) },
    )
    return () => { live = false }
  }, [attempt])
  return { library, failed, retry: () => setAttempt(a => a + 1) }
}

export interface LibraryFilter {
  query: string
  group: MuscleGroup | 'all'
  equipment: Equipment | 'all'
  /** A target muscle picked on the body map, or null. */
  target: string | null
}

/** Every word of the query appears in the text ("db press" doesn't match; "bench press" does). */
export function matchesQuery(text: string, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const hay = text.toLowerCase()
  return words.every(w => hay.includes(w))
}

/** Library entries passing the filter (search on the name and the target muscle's names). */
export function filterLibrary(list: LibraryExercise[], f: LibraryFilter): LibraryExercise[] {
  return list.filter(lib =>
    (f.group === 'all' || libMatchesGroup(lib, f.group)) &&
    (f.equipment === 'all' || libEquipment(lib) === f.equipment) &&
    (!f.target || lib.target === f.target) &&
    (!f.query.trim() || matchesQuery(`${lib.name} ${lib.target} ${targetLabel(lib.target)}`, f.query)))
}

/** Entries per target muscle under the group/equipment/query filters (the body map's numbers). */
export function targetCounts(list: LibraryExercise[], f: LibraryFilter): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const lib of filterLibrary(list, { ...f, target: null })) counts[lib.target] = (counts[lib.target] ?? 0) + 1
  return counts
}

/** Instructions in the UI language (English when a translation is missing). */
export function stepsFor(lib: LibraryExercise, lang: Lang): string[] {
  return lib.steps[lang]?.length ? lib.steps[lang] : lib.steps.en
}

export function mediaUrls(library: Pick<ExerciseLibrary, 'mediaBase'>, lib: Pick<LibraryExercise, 'media'>): { thumb: string; gif: string } {
  return {
    thumb: `${library.mediaBase}images/${lib.media}.jpg`,
    gif: `${library.mediaBase}videos/${lib.media}.gif`,
  }
}

/** "upper back" → "upperBack" (dictionary key). */
export function libraryLabelKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+(.)/g, (_, c: string) => c.toUpperCase()).replace(/[^a-zA-Z0-9]/g, '')
}

function translated(prefix: 'library.targets' | 'library.secondary', s: string): string {
  const key = `${prefix}.${libraryLabelKey(s)}` as Key
  const label = t(key)
  return label === key ? s.charAt(0).toUpperCase() + s.slice(1) : label
}

/** A target muscle in the UI language ("lats" → "Lats" / "Dorsali"). */
export function targetLabel(target: string): string {
  return translated('library.targets', target)
}

/** A secondary muscle in the UI language (unknown names pass through capitalised). */
export function secondaryLabel(muscle: string): string {
  return translated('library.secondary', muscle)
}

function defaultRest(lib: LibraryExercise): number {
  const group = libMuscleGroup(lib)
  if (group === 'cardio' || group === 'core') return 60
  if (libEquipment(lib) === 'barbell' && ['legs', 'back', 'chest', 'glutes'].includes(group)) return 150
  return 90
}

/** The row a library pick becomes. Cardio entries log time + distance (by muscle group). */
export function libraryExerciseRow(lib: LibraryExercise): Exercise {
  return {
    id: libraryRowId(lib.id),
    name: lib.name,
    nameLower: lib.name.toLowerCase(),
    muscleGroup: libMuscleGroup(lib),
    equipment: libEquipment(lib),
    defaultRestSec: defaultRest(lib),
    isCustom: true,
    libraryId: lib.id,
  }
}

/**
 * The exercise for a library entry: the row already linked to it (a catalog row, or one added
 * earlier on any device), else a new row. Exercises are never deleted, so the deterministic id
 * can't collide with a tombstone.
 */
export async function addLibraryExercise(lib: LibraryExercise): Promise<Exercise> {
  return db.transaction('rw', db.exercises, async () => {
    const linked = (await db.exercises.toArray()).find(e => libraryIdOf(e) === lib.id)
    if (linked) return linked
    const row = libraryExerciseRow(lib)
    await db.exercises.add(row)
    return (await db.exercises.get(row.id!))!
  })
}
