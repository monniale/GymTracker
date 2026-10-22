import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { db } from '../db/db'
import { ensureSeeded } from '../db/seed'
import { en } from '../i18n/en'
import { BODY_TARGETS } from '../components/library/BodyMap'
import { useUiStore } from './uiStore'
import {
  LIBRARY_TARGETS, SEED_LIBRARY_IDS, addLibraryExercise, filterLibrary, libEquipment, libMuscleGroup,
  libraryIdOf, libraryLabelKey, matchesQuery, mediaUrls, parseLibrary, stepsFor, targetCounts, targetLabel,
  type LibraryFilter,
} from './exerciseLibrary'

const library = parseLibrary(JSON.parse(readFileSync(new URL('../../public/exercise-library.json', import.meta.url), 'utf8')))
const NONE: LibraryFilter = { query: '', group: 'all', equipment: 'all', target: null }

/** The English catalog names, read from the seed's `ROWS` (not exported: the seed owns them). */
const SEED_NAMES = [...readFileSync(new URL('../db/seed.ts', import.meta.url), 'utf8')
  .matchAll(/^\s*\['([^']+)', '[a-z]+', '[a-z]+', \d+\],?$/gm)].map(m => m[1])

describe('the library file', () => {
  it('parses every exercise, sorted by name, with English and Italian steps', () => {
    expect(library.exercises.length).toBe(1324)
    const names = library.exercises.map(e => e.name.toLowerCase())
    expect(names).toEqual([...names].sort((a, b) => (a < b ? -1 : 1)))
    expect(new Set(names).size).toBe(names.length)
    for (const e of library.exercises) {
      expect(e.steps.en.length).toBeGreaterThan(0)
      expect(e.steps.it.length).toBeGreaterThan(0)
    }
    expect(library.byId.get('0025')?.name).toBe('Barbell Bench Press')
    expect(library.attribution).toContain('Gym visual')
  })

  it('pins the media to a commit of the dataset repo', () => {
    expect(mediaUrls(library, { media: '0025-EIeI8Vf' }).gif).toMatch(
      /^https:\/\/raw\.githubusercontent\.com\/hasaneyldrm\/exercises-dataset\/[0-9a-f]{40}\/videos\/0025-EIeI8Vf\.gif$/)
  })

  it('has a label in both languages for every target and secondary muscle', () => {
    const secondary = new Set(library.exercises.flatMap(e => e.secondary))
    for (const target of new Set(library.exercises.map(e => e.target))) {
      expect(LIBRARY_TARGETS).toContain(target)
      expect(en.library.targets).toHaveProperty(libraryLabelKey(target))
    }
    for (const muscle of secondary) expect(en.library.secondary).toHaveProperty(libraryLabelKey(muscle))
  })

  it('draws every target but cardio on the body map', () => {
    expect([...BODY_TARGETS].sort()).toEqual(LIBRARY_TARGETS.filter(t => t !== 'cardiovascular system').sort())
  })
})

describe('mapping to the app', () => {
  it('maps dataset equipment and targets to the six equipments and the muscle groups', () => {
    expect(libEquipment({ equipment: 'ez barbell' })).toBe('barbell')
    expect(libEquipment({ equipment: 'smith machine' })).toBe('machine')
    expect(libEquipment({ equipment: 'body weight' })).toBe('bodyweight')
    expect(libEquipment({ equipment: 'kettlebell' })).toBe('other')
    expect(libMuscleGroup({ target: 'lats', bodyPart: 'back' })).toBe('back')
    expect(libMuscleGroup({ target: 'cardiovascular system', bodyPart: 'cardio' })).toBe('cardio')
    expect(libMuscleGroup({ target: 'quads', bodyPart: 'upper legs' })).toBe('legs')
  })

  it('links catalog names to existing entries of a matching muscle group', () => {
    const groups = new Map(
      [...readFileSync(new URL('../db/seed.ts', import.meta.url), 'utf8')
        .matchAll(/^\s*\['([^']+)', '([a-z]+)', '[a-z]+', \d+\],?$/gm)].map(m => [m[1], m[2]]))
    for (const [name, id] of Object.entries(SEED_LIBRARY_IDS)) {
      expect(SEED_NAMES, name).toContain(name)
      const lib = library.byId.get(id)
      expect(lib, `${name} → ${id}`).toBeDefined()
      // The dataset files squats, deadlifts and lunges under the glutes; the catalog keeps its own
      // group, and the Legs filter still finds those entries by body part.
      if (libMuscleGroup(lib!) === 'glutes' && groups.get(name) !== 'glutes') {
        expect(['legs', 'back'], name).toContain(groups.get(name))
      } else {
        expect(libMuscleGroup(lib!), name).toBe(groups.get(name))
      }
    }
  })

  it('finds the link of a catalog row by name and of a library row by libraryId', () => {
    expect(libraryIdOf({ name: 'Bench Press', isCustom: false })).toBe('0025')
    expect(libraryIdOf({ name: 'Bench Press', isCustom: true })).toBeUndefined()
    expect(libraryIdOf({ name: 'Whatever', isCustom: true, libraryId: '0001' })).toBe('0001')
  })
})

describe('search and filters', () => {
  afterEach(() => useUiStore.setState({ language: 'en' }))

  it('matches every word of the query', () => {
    expect(matchesQuery('Barbell Bench Press', 'bench  barbell')).toBe(true)
    expect(matchesQuery('Barbell Bench Press', 'db press')).toBe(false)
    expect(matchesQuery('anything', '  ')).toBe(true)
  })

  it('filters by name, target name, group, equipment and target', () => {
    const benches = filterLibrary(library.exercises, { ...NONE, query: 'bench press', equipment: 'barbell' })
    expect(benches.map(e => e.id)).toContain('0025')
    expect(benches.every(e => libEquipment(e) === 'barbell')).toBe(true)

    const lats = filterLibrary(library.exercises, { ...NONE, target: 'lats' })
    expect(lats.length).toBe(81)
    expect(filterLibrary(library.exercises, { ...NONE, query: 'lats' }).length).toBeGreaterThanOrEqual(81)

    const cardio = filterLibrary(library.exercises, { ...NONE, group: 'cardio' })
    expect(cardio.every(e => libMuscleGroup(e) === 'cardio')).toBe(true)

    const legs = filterLibrary(library.exercises, { ...NONE, group: 'legs' }).map(e => e.id)
    expect(legs).toContain('0043') // Barbell Full Squat: target glutes, body part upper legs
    expect(filterLibrary(library.exercises, { ...NONE, group: 'glutes' }).map(e => e.id)).toContain('0043')
  })

  it('searches target names in the UI language', () => {
    useUiStore.setState({ language: 'it' })
    expect(targetLabel('lats')).toBe('Dorsali')
    expect(filterLibrary(library.exercises, { ...NONE, query: 'dorsali' }).length).toBe(81)
  })

  it('counts entries per target under the other filters, ignoring the target filter', () => {
    const counts = targetCounts(library.exercises, { ...NONE, equipment: 'cable', target: 'lats' })
    expect(counts.lats).toBe(filterLibrary(library.exercises, { ...NONE, equipment: 'cable', target: 'lats' }).length)
    expect(counts.pectorals).toBeGreaterThan(0)
    expect(Object.values(targetCounts(library.exercises, NONE)).reduce((a, b) => a + b, 0)).toBe(1324)
  })

  it('shows the instructions in the UI language', () => {
    const bench = library.byId.get('0025')!
    expect(stepsFor(bench, 'it')).toBe(bench.steps.it)
    expect(stepsFor({ ...bench, steps: { en: bench.steps.en, it: [] } }, 'it')).toBe(bench.steps.en)
  })
})

describe('addLibraryExercise', () => {
  beforeEach(async () => {
    db.close()
    await Dexie.delete('gymtracker')
    await db.open()
    await ensureSeeded()
  })

  it('adds a row with a deterministic id once, then returns it', async () => {
    const lib = library.byId.get('0001')!
    const first = await addLibraryExercise(lib)
    expect(first).toMatchObject({ id: 'lib-0001', name: lib.name, libraryId: '0001', muscleGroup: 'core', isCustom: true })
    expect(first.updatedAt).toBeGreaterThan(0)
    const again = await addLibraryExercise(lib)
    expect(again.id).toBe('lib-0001')
    expect(await db.exercises.where('id').equals('lib-0001').count()).toBe(1)
  })

  it('returns the catalog row for an entry the catalog is linked to', async () => {
    const e = await addLibraryExercise(library.byId.get('0025')!)
    expect(e.name).toBe('Bench Press')
    expect(typeof e.id).toBe('number')
  })

  it('files cardio entries as cardio', async () => {
    const run = await addLibraryExercise(library.byId.get('2612')!)
    expect(run.name).toBe('Jump Rope')
    const lib = library.exercises.find(e => e.target === 'cardiovascular system' && !Object.values(SEED_LIBRARY_IDS).includes(e.id))!
    expect((await addLibraryExercise(lib)).muscleGroup).toBe('cardio')
  })
})
