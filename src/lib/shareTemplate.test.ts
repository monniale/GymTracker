import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { readFileSync } from 'node:fs'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '../db/db'
import { ensureSeeded } from '../db/seed'
import {
  applyShareImport, decodeShareInput, decodeShareLink, encodeShareLink, exportProgram, exportTemplate,
  parseShareFile, previewShareImport, shareLinkUrl, ShareLinkError, MAX_LINK_CHARS, PROGRAM_SCHEMA, TEMPLATE_SCHEMA,
  type ProgramFile, type ShareFile, type TemplateFile,
} from './shareTemplate'
import { parseLibrary, type ExerciseLibrary } from './exerciseLibrary'
import { presetProgramFile, type PresetFile } from './programs'
import type { Exercise, Id, TemplateItem } from '../types'

const PUBLIC = new URL('../../public/', import.meta.url)
const readPublic = (name: string) => JSON.parse(readFileSync(new URL(name, PUBLIC), 'utf8'))

function memoryStorage(): Storage {
  const m = new Map<string, string>()
  return {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: k => m.get(k) ?? null,
    key: i => [...m.keys()][i] ?? null,
    removeItem: k => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  }
}

// The library fetch is not reachable in tests: rows are built from the file (offline path),
// unless a test sets `libraryState.value` (the online path).
const libraryState = vi.hoisted(() => ({ value: null as ExerciseLibrary | null }))
vi.mock('./exerciseLibrary', async importOriginal => {
  const mod = await importOriginal<typeof import('./exerciseLibrary')>()
  return {
    ...mod,
    loadExerciseLibrary: () => (libraryState.value ? Promise.resolve(libraryState.value) : Promise.reject(new Error('offline'))),
  }
})

beforeEach(async () => {
  vi.stubGlobal('localStorage', memoryStorage())
  db.close()
  await Dexie.delete('gymtracker')
  await db.open()
  await ensureSeeded()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function exId(name: string): Promise<Id> {
  return (await db.exercises.where('nameLower').equals(name.toLowerCase()).first())!.id!
}

async function makeTemplate(name: string, names: string[], extra: Partial<TemplateItem> = {}): Promise<Id> {
  const items: TemplateItem[] = []
  for (const n of names) items.push({ exerciseId: await exId(n), targetSets: 3, targetReps: 8, restSec: 120, ...extra })
  const id = crypto.randomUUID()
  await db.templates.add({ id, name, position: await db.templates.count(), items, updatedAt: Date.now() })
  return id
}

const b64u = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const SIX = ['Bench Press', 'Incline Dumbbell Press', 'Chest Fly', 'Deadlift', 'Pull-Up', 'Lat Pulldown']

const TPL: TemplateFile = {
  schema: TEMPLATE_SCHEMA,
  template: {
    name: 'Push',
    items: [
      { exercise: { name: 'Bench Press', libraryId: '0025', muscleGroup: 'chest', equipment: 'barbell' }, targetSets: 5, targetReps: 5,
        scheme: { kind: 'linear', stepKg: 2.5, failsToDeload: 3, deloadPct: 0.1 } },
      { exercise: { name: 'pec deck', muscleGroup: 'chest', equipment: 'machine' }, targetSets: 1, targetReps: 5 },
      { exercise: { name: 'Barbell Front Squat Hold', libraryId: '3001', muscleGroup: 'legs', equipment: 'barbell' }, targetSets: 3, targetReps: 5,
        setsByWeek: [[{ pct: 0.65, reps: 5 }, { pct: 0.75, reps: 5 }, { pct: 0.85, reps: 5, amrap: true }]] },
      { exercise: { name: 'Zercher Hold', muscleGroup: 'core', equipment: 'barbell' }, targetSets: 3, targetReps: 8, targetRepsMax: 12 },
    ],
  },
}

describe('export', () => {
  it('names exercises (English name, library id) and never carries progress or row ids', async () => {
    const id = await makeTemplate('Push', ['Bench Press', 'Deadlift'], {
      targetRepsMax: 10,
      progress: { failStreak: 2, lastOutcome: 'fail', lastSessionId: 's1' },
    })
    const file = await exportTemplate(id)
    expect(file.schema).toBe(TEMPLATE_SCHEMA)
    expect(file.template.items[0]).toEqual({
      exercise: { name: 'Bench Press', libraryId: '0025', muscleGroup: 'chest', equipment: 'barbell' },
      targetSets: 3, targetReps: 8, targetRepsMax: 10, restSec: 120,
    })
    expect(file.template.items[1].exercise).toEqual({ name: 'Deadlift', libraryId: '0032', muscleGroup: 'back', equipment: 'barbell' })
    const json = JSON.stringify(file)
    expect(json).not.toContain('progress')
    expect(json).not.toContain('exerciseId')
  })

  it('exports a program with its templates in order', async () => {
    const a = await makeTemplate('A', ['Bench Press'])
    const b = await makeTemplate('B', ['Deadlift'])
    const pid = crypto.randomUUID()
    await db.programs.add({ id: pid, name: 'My plan', templateIds: [b, a], cycleWeeks: 4, cycleStartDate: '2026-10-19' })
    const file = await exportProgram(pid)
    expect(file.schema).toBe(PROGRAM_SCHEMA)
    expect(file.name).toBe('My plan')
    expect(file.cycleWeeks).toBe(4)
    expect(file.templates.map(t => t.name)).toEqual(['B', 'A'])
    expect(JSON.stringify(file)).not.toContain('cycleStartDate')
  })

  it('throws empty for a missing template', async () => {
    await expect(exportTemplate('nope')).rejects.toMatchObject({ code: 'empty' })
  })
})

describe('share links', () => {
  it('has CompressionStream in this runtime (z path is really exercised)', () => {
    expect(typeof CompressionStream).toBe('function')
  })

  for (const compress of [true, false]) {
    it(`round-trips a template and a program (${compress ? 'z' : 'u'})`, async () => {
      const prog: ProgramFile = { schema: PROGRAM_SCHEMA, name: 'Plan', cycleWeeks: 4, notes: 'Two days', templates: [TPL.template, { ...TPL.template, name: 'Pull' }] }
      for (const file of [TPL, prog] as ShareFile[]) {
        const link = await encodeShareLink(file, { compress })
        expect(link.startsWith(`#/import?t=${compress ? 'z' : 'u'}`)).toBe(true)
        expect(link).toMatch(/^#\/import\?t=[A-Za-z0-9_-]+$/)
        const back = await decodeShareLink(link.slice('#/import?t='.length))
        expect(back).toEqual(file)
        expect(await decodeShareInput(shareLinkUrl(link))).toEqual(file)
      }
    })
  }

  it('falls back to u when CompressionStream is missing', async () => {
    vi.stubGlobal('CompressionStream', undefined)
    const link = await encodeShareLink(TPL)
    expect(link.startsWith('#/import?t=u')).toBe(true)
    vi.unstubAllGlobals()
    expect(await decodeShareLink(link.slice(11))).toEqual(TPL)
  })

  it('keeps a 6-item template link under 1000 chars', async () => {
    const id = await makeTemplate('Upper', SIX)
    const file = await exportTemplate(id)
    const z = await encodeShareLink(file)
    const u = await encodeShareLink(file, { compress: false })
    expect(shareLinkUrl(z).length).toBeLessThan(1000)
    expect(z.length).toBeLessThan(u.length)
  })

  it('keeps the largest preset programs well under the link limit when deflated', async () => {
    const presets = (readPublic('programs.json') as { presets: PresetFile[] }).presets
    const sizes = new Map<string, number>()
    for (const p of presets) {
      const z = await encodeShareLink(presetProgramFile(p, 'it'))
      expect(z.startsWith('#/import?t=z')).toBe(true)
      sizes.set(p.id, shareLinkUrl(z).length)
    }
    for (const id of ['531-bbb', 'nsuns-5day', 'reddit-ppl', 'upper-lower-4day']) {
      expect(sizes.get(id)).toBeLessThan(2000)
    }
    expect(Math.max(...sizes.values())).toBeLessThan(MAX_LINK_CHARS)
  })

  it('refuses a link over 8 KB', async () => {
    const big: ProgramFile = {
      schema: PROGRAM_SCHEMA,
      name: 'Big',
      templates: Array.from({ length: 14 }, (_, t) => ({
        name: `Day ${t}`,
        items: Array.from({ length: 40 }, (_, i) => ({
          exercise: { name: `Exercise ${t}-${i} ${crypto.randomUUID()}`, muscleGroup: 'other' as const, equipment: 'other' as const },
          targetSets: 3, targetReps: 10,
        })),
      })),
    }
    await expect(encodeShareLink(big)).rejects.toMatchObject({ code: 'tooLong' })
  })

  it('rejects an unknown prefix, schema, or broken payload with typed errors', async () => {
    await expect(decodeShareLink('xABC')).rejects.toBeInstanceOf(ShareLinkError)
    await expect(decodeShareLink('xABC')).rejects.toMatchObject({ code: 'prefix' })
    const other = 'u' + b64u(JSON.stringify({ schema: 'gymtracker-template/v2', template: TPL.template }))
    await expect(decodeShareLink(other)).rejects.toMatchObject({ code: 'schema' })
    await expect(decodeShareLink('u' + b64u('{"a":1}'))).rejects.toMatchObject({ code: 'schema' })
    await expect(decodeShareLink('u%%%')).rejects.toMatchObject({ code: 'corrupt' })
    await expect(decodeShareLink('u' + b64u('not json'))).rejects.toMatchObject({ code: 'corrupt' })
    const z = await encodeShareLink(TPL)
    await expect(decodeShareLink(z.slice(11, 40))).rejects.toMatchObject({ code: 'corrupt' })
  })
})

describe('parseShareFile', () => {
  it('drops unknown fields, bad items and out-of-range numbers', () => {
    const raw = {
      schema: TEMPLATE_SCHEMA,
      template: {
        name: ' Legs ',
        id: 7,
        items: [
          { exercise: { name: 'Squat', muscleGroup: 'quads', equipment: 'rack', libraryId: '../x' }, targetSets: 3, targetReps: 5,
            restSec: 99999, progress: { failStreak: 9 }, supersetWithNext: true, exerciseId: 3 },
          { exercise: { name: '' }, targetSets: 3, targetReps: 5 },
          { exercise: { name: 'Lunge', muscleGroup: 'legs', equipment: 'dumbbell' }, targetSets: 0, targetReps: 5 },
        ],
      },
    }
    const file = parseShareFile(raw) as TemplateFile
    expect(file).toEqual({
      schema: TEMPLATE_SCHEMA,
      template: { name: 'Legs', items: [{ exercise: { name: 'Squat', muscleGroup: 'other', equipment: 'other' }, targetSets: 3, targetReps: 5 }] },
    })
  })

  it('throws empty when nothing usable is left', () => {
    expect(() => parseShareFile({ schema: PROGRAM_SCHEMA, name: 'X', templates: [] })).toThrow(ShareLinkError)
  })
})

describe('previewShareImport', () => {
  it('marks known, library and new exercises and counts distinct ones', async () => {
    const exercises: Exercise[] = await db.exercises.toArray()
    const file: ProgramFile = { schema: PROGRAM_SCHEMA, name: 'P', templates: [TPL.template, TPL.template] }
    const p = previewShareImport(file, exercises)
    expect(p.templates[0].items.map(i => [i.name, i.status])).toEqual([
      ['Bench Press', 'known'], // catalog row linked by SEED_LIBRARY_IDS
      ['pec deck', 'known'], // by lower-case name
      ['Barbell Front Squat Hold', 'library'],
      ['Zercher Hold', 'new'],
    ])
    expect(p.templates[1].items.map(i => i.status)).toEqual(['known', 'known', 'library', 'new'])
    expect(p.known).toBe(2)
    expect(p.toCreate).toBe(2)
  })
})

describe('applyShareImport', () => {
  it('matches or creates exercises and appends the template', async () => {
    await makeTemplate('Existing', ['Bench Press'])
    const before = await db.exercises.count()
    const { templateIds, programId } = await applyShareImport(TPL)
    expect(programId).toBeUndefined()
    expect(templateIds).toHaveLength(1)
    const t = (await db.templates.get(templateIds[0]))!
    expect(t.name).toBe('Push')
    expect(t.position).toBe(1)
    expect(t.items[0].exerciseId).toBe(await exId('Bench Press'))
    expect(t.items[0].scheme).toEqual({ kind: 'linear', stepKg: 2.5, failsToDeload: 3, deloadPct: 0.1 })
    expect(t.items[0].progress).toBeUndefined()
    expect(t.items[1].exerciseId).toBe(await exId('Pec Deck'))
    expect(t.items[2].exerciseId).toBe('lib-3001')
    expect(t.items[2].setsByWeek).toEqual(TPL.template.items[2].setsByWeek)
    expect(t.items[3].targetRepsMax).toBe(12)
    expect(await db.exercises.count()).toBe(before + 2)
    expect(await db.exercises.get('lib-3001')).toMatchObject({ name: 'Barbell Front Squat Hold', libraryId: '3001', isCustom: true })
    const custom = await db.exercises.get(t.items[3].exerciseId)
    expect(custom).toMatchObject({ name: 'Zercher Hold', nameLower: 'zercher hold', muscleGroup: 'core', equipment: 'barbell', isCustom: true })
    expect(custom!.libraryId).toBeUndefined()
  })

  it('creates no duplicate exercises on re-import', async () => {
    const first = await applyShareImport(TPL)
    const count = await db.exercises.count()
    const second = await applyShareImport(TPL)
    expect(await db.exercises.count()).toBe(count)
    const [a, b] = await db.templates.bulkGet([first.templateIds[0], second.templateIds[0]])
    expect(b!.items.map(i => i.exerciseId)).toEqual(a!.items.map(i => i.exerciseId))
    expect(b!.position).toBe(a!.position + 1)
    // A preview now finds every exercise.
    expect(previewShareImport(TPL, await db.exercises.toArray()).toCreate).toBe(0)
  })

  it('reuses one row for an exercise repeated in a program, and adds a program not started', async () => {
    const file: ProgramFile = { schema: PROGRAM_SCHEMA, name: 'Plan', cycleWeeks: 4, notes: 'n', templates: [TPL.template, { ...TPL.template, name: 'B' }] }
    const before = await db.exercises.count()
    const { templateIds, programId } = await applyShareImport(file, { presetId: 'gzclp' })
    expect(await db.exercises.count()).toBe(before + 2)
    const program = (await db.programs.get(programId!))!
    expect(program).toMatchObject({ name: 'Plan', templateIds, cycleWeeks: 4, notes: 'n', presetId: 'gzclp' })
    expect(program.cycleStartDate).toBeUndefined()
    expect(program.endedAt).toBeUndefined()
    const ts = await db.templates.bulkGet(templateIds)
    expect(ts.map(t => t!.position)).toEqual([0, 1])
    expect(ts[1]!.items[3].exerciseId).toBe(ts[0]!.items[3].exerciseId)
  })

  it('round-trips export → link → import onto the same device without new exercises', async () => {
    const id = await makeTemplate('Upper', SIX)
    const count = await db.exercises.count()
    const link = await encodeShareLink(await exportTemplate(id))
    const file = await decodeShareInput(shareLinkUrl(link))
    const { templateIds } = await applyShareImport(file)
    expect(await db.exercises.count()).toBe(count)
    const [orig, copy] = await db.templates.bulkGet([id, templateIds[0]])
    expect(copy!.items).toEqual(orig!.items)
  })
})

describe('applyShareImport with the exercise library loaded', () => {
  beforeEach(() => {
    libraryState.value = parseLibrary(readPublic('exercise-library.json'))
  })
  afterEach(() => {
    libraryState.value = null
  })

  const FILE: TemplateFile = {
    schema: TEMPLATE_SCHEMA,
    template: {
      name: 'Pull',
      items: [
        // Known to the library: the library's own row (its name, not the file's).
        { exercise: { name: 'Clean', libraryId: '0648', muscleGroup: 'other', equipment: 'other' }, targetSets: 5, targetReps: 3 },
        // An id this build's library lacks (a link from a newer build): still deterministic and linked.
        { exercise: { name: 'Barbell Front Squat Hold', libraryId: '3001', muscleGroup: 'legs', equipment: 'barbell' }, targetSets: 3, targetReps: 5 },
      ],
    },
  }

  it('a known library id imports as the library row', async () => {
    const preview = previewShareImport(FILE, await db.exercises.toArray())
    expect(preview.templates[0].items.map(i => i.status)).toEqual(['library', 'library'])
    const { templateIds } = await applyShareImport(FILE)
    const t = (await db.templates.get(templateIds[0]))!
    expect(t.items.map(i => i.exerciseId)).toEqual(['lib-0648', 'lib-3001'])
    expect(await db.exercises.get('lib-0648')).toMatchObject({ name: 'Power Clean', libraryId: '0648', isCustom: true })
  })

  it('an id missing from the library keeps its deterministic id and link, like the offline path', async () => {
    await applyShareImport(FILE)
    expect(await db.exercises.get('lib-3001')).toMatchObject({ name: 'Barbell Front Squat Hold', libraryId: '3001', muscleGroup: 'legs' })
    const count = await db.exercises.count()
    await applyShareImport(FILE)
    expect(await db.exercises.count()).toBe(count)
  })

  it('the same link imported offline on another device lands on the same rows', async () => {
    const online = (await db.templates.get((await applyShareImport(FILE)).templateIds[0]))!.items.map(i => i.exerciseId)
    db.close()
    await Dexie.delete('gymtracker')
    await db.open()
    await ensureSeeded()
    libraryState.value = null
    const offline = (await db.templates.get((await applyShareImport(FILE)).templateIds[0]))!.items.map(i => i.exerciseId)
    expect(offline).toEqual(online)
  })
})
