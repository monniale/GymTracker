import { db } from '../db/db'
import { withSyncLock } from './sync'
import { localDateStr, mondayOf } from './dates'
import { addLibraryExercise, libraryIdOf, libraryRowId, loadExerciseLibrary } from './exerciseLibrary'
import { nextTemplate, type NextTemplate } from './nextTemplate'
import { applyOutcome, currentWeek, cycleStartOf } from './prescription'
import { sessionItems } from './sessionItems'
import type { Lang } from './uiStore'
import type { ProgramFile, SharedExercise, SharedItem, SharedTemplate } from './shareTemplate'
import type {
  Exercise, Id, ItemProgress, Program, ProgressionScheme, Session, SetRow, TemplateItem, WorkoutTemplate,
} from '../types'

/**
 * Training programs: a `Program` row (Dexie v10 `programs`, synced) cycles over its templates.
 * Active = `cycleStartDate` set and no `endedAt`; the program week comes from
 * `prescription.currentWeek`. Progression state lives only in `TemplateItem.progress` and
 * `Exercise.trainingMaxKg`, written once per finished workout by `applySessionProgression`
 * (finishSession), never by rescoreSession or report mode.
 *
 * Presets are hand-written files in scripts/programs/*.json, validated and bundled into
 * `public/programs.json` by scripts/build-programs.mjs (precached by the service worker, bundled
 * in the APK). A preset has the shape of a shared program file (`ProgramFile`) with its texts in
 * both languages; installing one writes the templates and the program in the UI language
 * (user content the user can rename), while exercises stay English catalog / library rows.
 */

/** A text in both UI languages. */
export type LocalizedText = Record<Lang, string>

export interface PresetTemplate extends Omit<SharedTemplate, 'name'> {
  name: LocalizedText
}

/** One bundled program preset (`public/programs.json`). */
export interface PresetFile extends Omit<ProgramFile, 'name' | 'notes' | 'templates'> {
  /** File name in scripts/programs/ and `Program.presetId` once installed. */
  id: string
  name: LocalizedText
  description: LocalizedText
  level: 'beginner' | 'intermediate' | 'advanced'
  daysPerWeek: number
  templates: PresetTemplate[]
}

let loading: Promise<PresetFile[]> | null = null

/** Fetch the bundled presets once per app run (a failed fetch is retried on the next call). */
export function loadPrograms(): Promise<PresetFile[]> {
  loading ??= fetch(`${import.meta.env.BASE_URL}programs.json`)
    .then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    })
    .then((data: { presets?: PresetFile[] }) => {
      if (!data || !Array.isArray(data.presets)) throw new Error('Bad programs file')
      return data.presets
    })
    .catch(err => {
      loading = null
      throw err
    })
  return loading
}

/** A preset as a plain shared program file in one language (preview, share, import). */
export function presetProgramFile(preset: PresetFile, lang: Lang): ProgramFile {
  const file: ProgramFile = {
    schema: 'gymtracker-program/v1',
    name: preset.name[lang] || preset.name.en,
    notes: preset.description[lang] || preset.description.en,
    templates: preset.templates.map(t => ({ name: t.name[lang] || t.name.en, items: t.items })),
  }
  if (preset.cycleWeeks) file.cycleWeeks = preset.cycleWeeks
  return file
}

function itemOf(i: SharedItem, exerciseId: Id): TemplateItem {
  const out: TemplateItem = { exerciseId, targetSets: i.targetSets, targetReps: i.targetReps }
  if (i.targetRepsMax !== undefined) out.targetRepsMax = i.targetRepsMax
  if (i.restSec !== undefined) out.restSec = i.restSec
  if (i.supersetWithNext) out.supersetWithNext = true
  if (i.scheme) out.scheme = i.scheme
  if (i.sets?.length) out.sets = i.sets
  if (i.setsByWeek?.length) out.setsByWeek = i.setsByWeek
  return out
}

/**
 * Install a bundled preset: its templates (after the existing ones, named in `lang`) and a
 * Program row started this Monday, in one transaction on the sync lock. The program becomes the
 * active one (any other active program is stopped). Exercises resolve to deterministic rows, so
 * two devices installing the same preset merge into the same exercises: the catalog row linked to
 * the library entry (`SEED_LIBRARY_IDS`), else `lib-<libraryId>` (`addLibraryExercise`).
 * Installing twice adds a second program with its own templates, never duplicate exercises.
 * Resolves to the new program's id.
 */
export async function installPreset(presetId: string, lang: Lang): Promise<Id> {
  const preset = (await loadPrograms()).find(p => p.id === presetId)
  if (!preset) throw new Error(`Unknown program preset ${presetId}`)
  // Fetched before the transaction: an IndexedDB transaction can't wait on the network.
  const library = await loadExerciseLibrary()
  const file = presetProgramFile(preset, lang)
  const today = localDateStr()

  return withSyncLock(() =>
    db.transaction('rw', db.exercises, db.templates, db.programs, async () => {
      const idOf = new Map<string, Id>()
      const resolve = async (x: SharedExercise): Promise<Id> => {
        const key = x.libraryId ? `lib:${x.libraryId}` : `name:${x.name.toLowerCase()}`
        const known = idOf.get(key)
        if (known !== undefined) return known
        const lib = x.libraryId ? library.byId.get(x.libraryId) : undefined
        let id: Id
        if (lib) {
          id = (await addLibraryExercise(lib)).id!
        } else {
          // Library entry missing (the build script rules this out): link by name, else a row from
          // the preset's own data, with the deterministic library id when it has one.
          const all = await db.exercises.toArray()
          const lower = x.name.toLowerCase()
          const found = all.find(e => x.libraryId && libraryIdOf(e) === x.libraryId)
            ?? all.find(e => e.nameLower === lower)
          if (found) {
            id = found.id!
          } else {
            const row: Exercise = {
              id: x.libraryId ? libraryRowId(x.libraryId) : crypto.randomUUID(),
              name: x.name,
              nameLower: lower,
              muscleGroup: x.muscleGroup,
              equipment: x.equipment,
              defaultRestSec: x.muscleGroup === 'cardio' ? 60 : 90,
              isCustom: true,
              ...(x.libraryId ? { libraryId: x.libraryId } : {}),
              ...(x.kind ? { kind: x.kind } : {}),
            }
            await db.exercises.add(row)
            id = row.id!
          }
        }
        idOf.set(key, id)
        return id
      }

      const existing = await db.templates.toArray()
      let position = existing.reduce((m, t) => Math.max(m, t.position), -1) + 1
      const templateIds: Id[] = []
      for (const t of file.templates) {
        const items: TemplateItem[] = []
        for (const i of t.items) items.push(itemOf(i, await resolve(i.exercise)))
        const id = crypto.randomUUID()
        await db.templates.add({ id, name: t.name, position: position++, items, updatedAt: Date.now() })
        templateIds.push(id)
      }

      // One active program at a time.
      const now = Date.now()
      for (const p of await db.programs.toArray()) {
        if (p.cycleStartDate && p.endedAt === undefined) await db.programs.update(p.id!, { endedAt: now })
      }

      const program: Program = {
        id: crypto.randomUUID(),
        name: file.name,
        presetId: preset.id,
        templateIds,
        cycleStartDate: mondayOf(today),
      }
      if (file.cycleWeeks) program.cycleWeeks = file.cycleWeeks
      if (file.notes) program.notes = file.notes
      await db.programs.add(program)
      return program.id!
    }),
  )
}

const isActive = (p: Program) => !!p.cycleStartDate && p.endedAt === undefined

/** Newest first: last written, then the later cycle start. */
function newestFirst(a: Program, b: Program): number {
  return (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || (b.cycleStartDate ?? '').localeCompare(a.cycleStartDate ?? '')
}

/** The running program: started (`cycleStartDate`) and not stopped; the newest if a merge left two. */
export async function activeProgram(): Promise<Program | undefined> {
  return (await db.programs.toArray()).filter(isActive).sort(newestFirst)[0]
}

/** The program a template belongs to: the active one first, else the newest that lists it. */
export async function programForTemplate(templateId: Id): Promise<Program | undefined> {
  const key = String(templateId)
  const owners = (await db.programs.toArray()).filter(p => p.templateIds.some(id => String(id) === key))
  return owners.filter(isActive).sort(newestFirst)[0] ?? owners.sort(newestFirst)[0]
}

/**
 * The program's next workout: `nextTemplate` over the program's templates in `templateIds` order
 * (the template positions are ignored; weekday schedules still win). Templates not in the program,
 * or deleted ones, are skipped. Pass as `lastFinished` the last finished session of one of the
 * program's templates (`lastProgramSession`): any other session restarts the rotation at day one.
 */
export function nextProgramTemplate<T extends Pick<WorkoutTemplate, 'id' | 'position' | 'weekdays'>>(
  program: Pick<Program, 'templateIds'>,
  templates: T[],
  lastFinished: Pick<Session, 'templateId' | 'startedAt'> | undefined,
  today: string = localDateStr(),
  doneToday?: ReadonlySet<string>,
): NextTemplate<T> | null {
  const byId = new Map(templates.map(t => [String(t.id), t]))
  const seen = new Set<string>()
  const ordered: { t: T; position: number; id: T['id']; weekdays: T['weekdays'] }[] = []
  for (const id of program.templateIds) {
    const t = byId.get(String(id))
    if (!t || seen.has(String(id))) continue
    seen.add(String(id))
    ordered.push({ t, position: ordered.length, id: t.id, weekdays: t.weekdays })
  }
  const next = nextTemplate(ordered, lastFinished, today, doneToday)
  return next ? { template: next.template.t, reason: next.reason } : null
}

/** The last finished session of one of the program's templates (the `lastFinished` of nextProgramTemplate). */
export async function lastProgramSession(program: Pick<Program, 'templateIds'>): Promise<Session | undefined> {
  const ids = new Set(program.templateIds.map(String))
  return db.sessions.orderBy('startedAt').reverse()
    .filter(s => s.endedAt !== undefined && s.templateId !== undefined && ids.has(String(s.templateId)))
    .first()
}

/**
 * Apply a finished workout to its template's progression: for every template item with a scheme
 * or a rep range, `applyOutcome` over the work sets logged for it (warm-ups left out; an exercise
 * listed twice gets its sets split in set order, `targetSets` each, the last item the rest), then
 * `TemplateItem.progress` and `Exercise.trainingMaxKg` are written as tracked (synced) writes in one
 * transaction. The program week is the week the workout started in. An item swapped for another
 * exercise in this session, or with no logged sets, is left alone. Idempotent: an item whose
 * `progress.lastSessionId` is this session is skipped, so a second call writes nothing.
 * A linear lift is one progression across the program: the new progress of a linear line is also
 * written to the lines of the same exercise with the same scheme in the program's other templates
 * (Starting Strength squat in Workout A and B), so each workout moves it on, not every other one.
 * Called by finishSession only (never rescoreSession or report mode).
 */
export async function applySessionProgression(sessionId: Id): Promise<void> {
  const session = await db.sessions.get(sessionId)
  if (!session || session.templateId === undefined) return
  const templateId = session.templateId
  const program = await programForTemplate(templateId)

  const today = localDateStr(new Date(session.startedAt))
  const ctx = {
    week: program ? currentWeek(program, today) : 1,
    cycleWeeks: program?.cycleWeeks,
    cycleStart: program ? cycleStartOf(program, today) : undefined,
    sessionId,
  }

  await db.transaction('rw', db.templates, db.exercises, db.sets, async () => {
    const template = await db.templates.get(templateId)
    if (!template || template.items.length === 0) return
    if (!template.items.some(i => i.scheme || i.targetRepsMax !== undefined)) return

    const exIds = [...new Set(template.items.map(i => i.exerciseId))]
    const exRows = await db.exercises.bulkGet(exIds)
    const exMap = new Map<Id, Exercise>()
    exRows.forEach((e, i) => { if (e) exMap.set(exIds[i], e) })

    // Template lines after this session's swaps: same order, a swapped line has `swappedFrom`.
    const lines = sessionItems(template, { extraExerciseIds: [], swaps: session.swaps }, exMap)
    const logged = (await db.sets.where('sessionId').equals(sessionId).toArray())
      .filter(s => !s.isWarmup)
      .sort((a, b) => a.setNumber - b.setNumber || a.completedAt - b.completedAt)
    const byExercise = new Map<string, SetRow[]>()
    for (const s of logged) {
      const key = String(s.exerciseId)
      byExercise.set(key, [...(byExercise.get(key) ?? []), s])
    }
    const lastIndexOf = new Map<string, number>()
    template.items.forEach((it, i) => lastIndexOf.set(String(it.exerciseId), i))

    let changed = false
    const tmChanges = new Map<string, { id: Id; kg: number }>()
    /** Linear progress to share with the program's other lines of the lift: key → progress. */
    const shared = new Map<string, ItemProgress>()
    const items = template.items.map((item, i) => {
      const key = String(item.exerciseId)
      const all = byExercise.get(key) ?? []
      // An exercise listed twice: earlier lines take their `targetSets`, the last line the rest.
      const mine = lastIndexOf.get(key) === i ? all : lineShare(all, item.targetSets)
      byExercise.set(key, all.slice(mine.length))

      if (!item.scheme && item.targetRepsMax === undefined) return item
      if (lines[i]?.swappedFrom !== undefined) return item
      if (item.progress?.lastSessionId !== undefined && String(item.progress.lastSessionId) === String(sessionId)) return item
      const ex = exMap.get(item.exerciseId)
      if (!ex || mine.length === 0) return item

      const out = applyOutcome(item, ex, mine, ctx)
      // Not applied (no work set among them): applyOutcome hands back the old state.
      if (String(out.progress.lastSessionId) !== String(sessionId)) return item
      changed = true
      if (out.trainingMaxKg !== undefined && !tmChanges.has(key)) {
        tmChanges.set(key, { id: item.exerciseId, kg: out.trainingMaxKg })
        // A later line of the same exercise reads the new training max.
        exMap.set(item.exerciseId, { ...ex, trainingMaxKg: out.trainingMaxKg })
      }
      const lk = linearKey(item)
      if (lk !== undefined) shared.set(lk, out.progress)
      return { ...item, progress: out.progress }
    })

    if (changed) await db.templates.update(templateId, { items })
    for (const { id, kg } of tmChanges.values()) await db.exercises.update(id, { trainingMaxKg: kg })

    if (!program || shared.size === 0) return
    const others = program.templateIds.filter(id => String(id) !== String(templateId))
    for (const other of await db.templates.bulkGet(others)) {
      if (!other) continue
      let touched = false
      const next = other.items.map(it => {
        const lk = linearKey(it)
        const progress = lk !== undefined ? shared.get(lk) : undefined
        if (!progress || String(it.progress?.lastSessionId) === String(sessionId)) return it
        touched = true
        return { ...it, progress }
      })
      if (touched) await db.templates.update(other.id!, { items: next })
    }
  })
}

/**
 * The first line's share of an exercise listed twice: its `targetSets` work sets, with the drop
 * sets logged among or right after them (a drop set is never a prescribed work set).
 */
function lineShare(all: SetRow[], targetSets: number): SetRow[] {
  const n = Math.max(0, targetSets)
  let taken = 0
  let work = 0
  while (taken < all.length) {
    const drop = all[taken].setType === 'drop'
    if (!drop && work >= n) break
    if (!drop) work++
    taken++
  }
  return all.slice(0, taken)
}

function linearSchemeKey(s: Extract<ProgressionScheme, { kind: 'linear' }>): string {
  return JSON.stringify([s.stepKg, s.failsToDeload, s.deloadPct, (s.stages ?? []).map(st => [st.sets, st.reps, !!st.amrapLast])])
}

/** Lines sharing one linear progression: same exercise and same linear scheme; undefined otherwise. */
function linearKey(item: TemplateItem): string | undefined {
  return item.scheme?.kind === 'linear' ? `${String(item.exerciseId)}|${linearSchemeKey(item.scheme)}` : undefined
}
