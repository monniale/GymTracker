import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '../../db/db'
import { sessionItems } from '../../lib/sessionItems'
import { swapCandidates, swapSessionExercise, SwapTemplateConflict } from './ExerciseCardMenu'
import type { ExerciseLibrary, LibraryExercise } from '../../lib/exerciseLibrary'
import type { Equipment, Exercise, Id, MuscleGroup, Session, WorkoutTemplate } from '../../types'

const ex = (id: number): Exercise => ({ id, name: `Ex ${id}`, muscleGroup: 'chest', equipment: 'barbell' } as Exercise)
const exMap = new Map([1, 2, 3, 4].map(i => [i, ex(i)] as const))

const TPL: WorkoutTemplate = {
  id: 't1', name: 'Push', position: 0, updatedAt: 1,
  items: [{ exerciseId: 1, targetSets: 3, targetReps: 5, restSec: 120 }, { exerciseId: 2, targetSets: 3, targetReps: 10 }],
}
const SESSION: Session = { id: 's1', name: 'Push', templateId: 't1', startedAt: 1000, bodyweightKg: 80, extraExerciseIds: [] }

async function load() {
  return { session: (await db.sessions.get('s1'))!, template: (await db.templates.get('t1'))! }
}

describe('swapSessionExercise', () => {
  beforeEach(async () => {
    await db.sessions.clear()
    await db.templates.clear()
    await db.sessions.put({ ...SESSION })
    await db.templates.put({ ...TPL, items: TPL.items.map(i => ({ ...i })) })
  })

  it('a template line: appends a session swap, leaves the template alone', async () => {
    await swapSessionExercise(SESSION, { exerciseId: 1 }, 3, { fromTemplate: true, hasLogged: false, template: TPL })
    const { session, template } = await load()
    expect(session.swaps).toEqual([{ from: 1, to: 3 }])
    expect(template.items.map(i => i.exerciseId)).toEqual([1, 2])
    expect(sessionItems(template, session, exMap)[0]).toMatchObject({ exerciseId: 3, swappedFrom: 1, targetReps: 5 })
  })

  it('also updating the template with nothing logged: no session swap, so re-adding the old exercise works', async () => {
    await swapSessionExercise(SESSION, { exerciseId: 1 }, 3, { fromTemplate: true, hasLogged: false, template: TPL, updateTemplate: true })
    const { session, template } = await load()
    expect(session.swaps).toBeUndefined()
    expect(template.items.map(i => i.exerciseId)).toEqual([3, 2])
    expect(template.items[0]).toMatchObject({ targetSets: 3, targetReps: 5, restSec: 120 })
    const readded = { ...session, extraExerciseIds: [1] }
    expect(sessionItems(template, readded, exMap).map(i => i.exerciseId)).toEqual([3, 2, 1])
  })

  it('also updating the template with logged sets: keeps the swap so the old sets stay on a card', async () => {
    await swapSessionExercise(SESSION, { exerciseId: 1 }, 3, { fromTemplate: true, hasLogged: true, template: TPL, updateTemplate: true })
    const { session, template } = await load()
    expect(session.swaps).toEqual([{ from: 1, to: 3 }])
    const items = sessionItems(template, session, exMap, new Set([1]))
    expect(items.map(i => [i.exerciseId, i.targetSets, i.swappedOut])).toEqual([[3, 3, undefined], [2, 3, undefined], [1, 0, true]])
  })

  it('a chained swap updates the template line it was written for', async () => {
    const first = { ...SESSION, swaps: [{ from: 1, to: 3 }] }
    await db.sessions.put(first)
    await swapSessionExercise(first, { exerciseId: 3, swappedFrom: 1 }, 4, { fromTemplate: true, hasLogged: false, template: TPL, updateTemplate: true })
    const { session, template } = await load()
    expect(template.items.map(i => i.exerciseId)).toEqual([4, 2])
    expect(session.swaps).toEqual([{ from: 1, to: 3 }])
    expect(sessionItems(template, session, exMap)[0].exerciseId).toBe(4)
  })

  it('swapping back to the original with "also update the template" undoes the earlier swap', async () => {
    const first = { ...SESSION, swaps: [{ from: 1, to: 3 }] }
    await db.sessions.put(first)
    await swapSessionExercise(first, { exerciseId: 3, swappedFrom: 1 }, 1, { fromTemplate: true, hasLogged: false, template: TPL, updateTemplate: true })
    const { session, template } = await load()
    expect(template.items.map(i => i.exerciseId)).toEqual([1, 2])
    expect(session.swaps).toEqual([{ from: 1, to: 3 }, { from: 3, to: 1 }])
    const line = sessionItems(template, session, exMap)[0]
    expect(line.exerciseId).toBe(1)
    expect(line.swappedFrom).toBeUndefined()
  })

  it('an added exercise with logged sets is replaced in place and keeps its sets on a swapped-out card', async () => {
    const s = { ...SESSION, extraExerciseIds: [4] }
    await db.sessions.put(s)
    await swapSessionExercise(s, { exerciseId: 4 }, 3, { fromTemplate: false, hasLogged: true, template: TPL })
    const { session, template } = await load()
    expect(session.extraExerciseIds).toEqual([3])
    expect(session.swaps).toEqual([{ from: 4, to: 3 }])
    const items = sessionItems(template, session, exMap, new Set([4]))
    expect(items.map(i => [i.exerciseId, i.targetSets, i.swappedOut])).toEqual([
      [1, 3, undefined], [2, 3, undefined], [3, 3, undefined], [4, 0, true],
    ])
  })

  it('a re-added template exercise with logged sets can be swapped again', async () => {
    // Template line 1 swapped to 2 (nothing logged), 1 added back, a set logged on it, then swapped to 4.
    const s = { ...SESSION, extraExerciseIds: [1], swaps: [{ from: 1, to: 3 }] }
    await db.sessions.put(s)
    await swapSessionExercise(s, { exerciseId: 1 }, 4, { fromTemplate: false, hasLogged: true, template: TPL })
    const { session, template } = await load()
    const items = sessionItems(template, session, exMap, new Set([1]))
    expect(items.map(i => [i.exerciseId, i.swappedOut])).toEqual([[3, undefined], [2, undefined], [4, undefined], [1, true]])
  })

  it('an added exercise without sets is replaced in place in extraExerciseIds', async () => {
    const s = { ...SESSION, extraExerciseIds: [4] }
    await db.sessions.put(s)
    await swapSessionExercise(s, { exerciseId: 4 }, 3, { fromTemplate: false, hasLogged: false, template: TPL, updateTemplate: true })
    const { session, template } = await load()
    expect(session.extraExerciseIds).toEqual([3])
    expect(session.swaps).toBeUndefined()
    expect(template.items.map(i => i.exerciseId)).toEqual([1, 2])
  })

  it('refuses to also put the exercise of another template line on this one', async () => {
    // Line 1 swapped from 1 to 3 for today only; line 2 then swapped to 1 with "also update the template".
    const first = { ...SESSION, swaps: [{ from: 1, to: 3 }] }
    await db.sessions.put(first)
    await expect(
      swapSessionExercise(first, { exerciseId: 2 }, 1, { fromTemplate: true, hasLogged: false, template: TPL, updateTemplate: true }),
    ).rejects.toBeInstanceOf(SwapTemplateConflict)
    const { session, template } = await load()
    expect(template.items.map(i => i.exerciseId)).toEqual([1, 2])
    expect(session.swaps).toEqual([{ from: 1, to: 3 }])
    // For this workout only it still works, and line 1 keeps its swap.
    await swapSessionExercise(first, { exerciseId: 2 }, 1, { fromTemplate: true, hasLogged: false, template: TPL })
    const after = await load()
    expect(sessionItems(after.template, after.session, exMap).map(i => i.exerciseId)).toEqual([3, 1])
  })
})

const libEntry = (id: string, name: string, bodyPart: string, equipment: string, target: string): LibraryExercise =>
  ({ id, name, bodyPart, equipment, target, secondary: [], steps: { en: [], it: [] }, media: '' })
const mine = (id: Id, name: string, muscleGroup: MuscleGroup, equipment: Equipment, libraryId?: string): Exercise =>
  ({ id, name, nameLower: name.toLowerCase(), muscleGroup, equipment, defaultRestSec: 90, isCustom: true, libraryId })

function makeLibrary(entries: LibraryExercise[]): ExerciseLibrary {
  return { exercises: entries, byId: new Map(entries.map(e => [e.id, e])), mediaBase: '', attribution: '' }
}

const LIB = makeLibrary([
  libEntry('9001', 'Lib Bench', 'chest', 'barbell', 'pectorals'),
  libEntry('9002', 'Lib Fly', 'chest', 'cable', 'pectorals'),
  libEntry('9003', 'Lib Pushup', 'chest', 'body weight', 'pectorals'),
  libEntry('9004', 'Lib Row', 'back', 'cable', 'upper back'),
  libEntry('9005', 'Lib Dip', 'chest', 'body weight', 'triceps'),
  libEntry('9006', 'Lib Close Bench', 'chest', 'barbell', 'pectorals'),
  libEntry('9007', 'Lib Archer', 'chest', 'body weight', 'pectorals'),
])

const BENCH = mine(10, 'Bench', 'chest', 'barbell', '9001')
const MINE: Exercise[] = [
  BENCH,
  mine(11, 'Cable Fly', 'chest', 'cable', '9002'),
  mine(12, 'Floor Press', 'chest', 'barbell'),
  mine(13, 'Dip', 'chest', 'bodyweight', '9005'),
  mine(14, 'Row', 'back', 'cable', '9004'),
  mine(15, 'Excluded Press', 'chest', 'dumbbell'),
  mine(16, 'Pec Thing', 'other', 'machine', '9003'),
]
const keys = (c: ReturnType<typeof swapCandidates>) => c.map(x => x.key)

describe('swapCandidates', () => {
  it('matches the library target: mine first (other equipment first), then unlinked library entries', () => {
    const c = swapCandidates(BENCH, MINE, LIB, new Set<Id>([15]), '')
    // Mine: 11 and 16 share the target through their entries (16's own group is 'other'), 12 has no
    // link but its group is the target's group; 13 (triceps) and 14 (back) do not match.
    // Library: 9001, 9002 and 9003 are linked to my rows, 9004 and 9005 have another target.
    expect(keys(c)).toEqual(['m-11', 'm-16', 'm-12', 'l-9007', 'l-9006'])
  })

  it('leaves out the exercise itself and the excluded ids', () => {
    const c = swapCandidates(BENCH, MINE, LIB, new Set<Id>([11, 12]), '')
    expect(keys(c)).not.toContain('m-10')
    expect(keys(c)).not.toContain('m-11')
    expect(keys(c)).not.toContain('m-12')
  })

  it('without a library link, falls back to the muscle group (mine by group or library body part)', () => {
    const own = mine(20, 'My Chest Thing', 'chest', 'machine')
    const c = swapCandidates(own, MINE, LIB, new Set(), '')
    // Machine rows sort last; 16 is a machine and matches through its entry's body part.
    expect(keys(c)).toEqual(['m-10', 'm-11', 'm-13', 'm-15', 'm-12', 'm-16', 'l-9007', 'l-9006'])
  })

  it('applies the search query to both lists', () => {
    expect(keys(swapCandidates(BENCH, MINE, LIB, new Set(), 'fly'))).toEqual(['m-11'])
    expect(keys(swapCandidates(BENCH, MINE, LIB, new Set(), 'archer'))).toEqual(['l-9007'])
  })

  it('works without a library (mine only, by their muscle group)', () => {
    expect(keys(swapCandidates(BENCH, MINE, null, new Set(), ''))).toEqual(['m-11', 'm-13', 'm-15', 'm-12'])
  })

  it('caps the list at 30', () => {
    const many = makeLibrary(Array.from({ length: 40 }, (_, i) => libEntry(`8${String(i).padStart(3, '0')}`, `Press ${i}`, 'chest', 'dumbbell', 'pectorals')))
    const c = swapCandidates(mine(30, 'Bench', 'chest', 'barbell', '8000'), [], many, new Set(), '')
    expect(c).toHaveLength(30)
  })
})
