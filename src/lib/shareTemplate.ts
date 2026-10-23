import { db } from '../db/db'
import { withSyncLock } from './sync'
import { EQUIPMENTS, MUSCLE_GROUPS } from './equipment'
import { libraryExerciseRow, libraryIdOf, libraryRowId, loadExerciseLibrary, type ExerciseLibrary } from './exerciseLibrary'
import type {
  Equipment, Exercise, Id, MuscleGroup, PrescribedSet, Program, ProgressionScheme, TemplateItem, WorkoutTemplate,
} from '../types'

/**
 * Share a workout template or a whole program as a link or a JSON file.
 *
 * A shared item names its exercise instead of pointing at a row id (ids differ per device): the
 * English stored name, the exercise-library id when it has one, muscle group, equipment and kind.
 * The receiver matches it to a row it already has (library link, else the lower-case name) or
 * creates one, the way ExercisePicker / addLibraryExercise would. Progress (`TemplateItem.progress`)
 * and every row id stay home: the receiver starts the plan fresh.
 *
 * Link: `#/import?t=<prefix><base64url>`. Prefix `z` = JSON deflated with CompressionStream
 * ('deflate', which Node 18 also has; not 'deflate-raw'), `u` = plain JSON when the browser has
 * no CompressionStream. Links over 8 KB are refused (messengers truncate them): share the file.
 */

export const TEMPLATE_SCHEMA = 'gymtracker-template/v1'
export const PROGRAM_SCHEMA = 'gymtracker-program/v1'

/** Where a share link opens: the public PWA (also from the Android app, whose origin is local). */
export const PUBLIC_APP_URL = 'https://monniale.github.io/GymTracker/'

/** Longest link `encodeShareLink` produces (the `#/import?t=…` part). */
export const MAX_LINK_CHARS = 8 * 1024

export interface SharedExercise {
  /** English stored name (catalog names stay English, invariant 19). */
  name: string
  libraryId?: string
  muscleGroup: MuscleGroup
  equipment: Equipment
  kind?: 'strength' | 'cardio'
}

export interface SharedItem {
  exercise: SharedExercise
  targetSets: number
  targetReps: number
  targetRepsMax?: number
  restSec?: number
  supersetWithNext?: boolean
  scheme?: ProgressionScheme
  sets?: PrescribedSet[]
  setsByWeek?: PrescribedSet[][]
}

export interface SharedTemplate {
  name: string
  items: SharedItem[]
}

export interface TemplateFile {
  schema: typeof TEMPLATE_SCHEMA
  template: SharedTemplate
}

export interface ProgramFile {
  schema: typeof PROGRAM_SCHEMA
  name: string
  notes?: string
  cycleWeeks?: number
  templates: SharedTemplate[]
}

export type ShareFile = TemplateFile | ProgramFile

export type ShareErrorCode =
  /** The link payload is neither `z…` nor `u…`. */
  | 'prefix'
  /** Not a GymTracker template/program file (or a newer version of one). */
  | 'schema'
  /** The payload does not decode (truncated link, bad base64, bad JSON, bad deflate data). */
  | 'corrupt'
  /** The link would be over MAX_LINK_CHARS: share the file instead. */
  | 'tooLong'
  /** Nothing to share or import (missing template/program, no templates). */
  | 'empty'

/** Typed failure of share encode/decode/import: the UI maps `code` to its copy. */
export class ShareLinkError extends Error {
  readonly code: ShareErrorCode
  constructor(code: ShareErrorCode, detail?: string) {
    super(detail ? `share ${code}: ${detail}` : `share ${code}`)
    this.name = 'ShareLinkError'
    this.code = code
  }
}

/* ---------------- export ---------------- */

function sharedExercise(e: Exercise): SharedExercise {
  const libraryId = libraryIdOf(e)
  return {
    name: e.name,
    ...(libraryId ? { libraryId } : {}),
    muscleGroup: e.muscleGroup,
    equipment: e.equipment ?? 'other',
    ...(e.kind ? { kind: e.kind } : {}),
  }
}

function sharedItem(item: TemplateItem, e: Exercise): SharedItem {
  const out: SharedItem = { exercise: sharedExercise(e), targetSets: item.targetSets, targetReps: item.targetReps }
  if (item.targetRepsMax !== undefined) out.targetRepsMax = item.targetRepsMax
  if (item.restSec !== undefined) out.restSec = item.restSec
  if (item.supersetWithNext) out.supersetWithNext = true
  if (item.scheme) out.scheme = item.scheme
  if (item.sets?.length) out.sets = item.sets
  if (item.setsByWeek?.length) out.setsByWeek = item.setsByWeek
  return out
}

/** Items whose exercise row is missing (never deleted in practice) are left out. */
function sharedTemplate(t: WorkoutTemplate, byId: Map<Id, Exercise>): SharedTemplate {
  const items: SharedItem[] = []
  for (const item of t.items) {
    const e = byId.get(item.exerciseId)
    if (e) items.push(sharedItem(item, e))
  }
  return { name: t.name, items }
}

async function exerciseMap(): Promise<Map<Id, Exercise>> {
  return new Map((await db.exercises.toArray()).map(e => [e.id!, e]))
}

export async function exportTemplate(id: Id): Promise<TemplateFile> {
  const t = await db.templates.get(id)
  if (!t) throw new ShareLinkError('empty', 'template not found')
  return { schema: TEMPLATE_SCHEMA, template: sharedTemplate(t, await exerciseMap()) }
}

export async function exportProgram(id: Id): Promise<ProgramFile> {
  const p = await db.programs.get(id)
  if (!p) throw new ShareLinkError('empty', 'program not found')
  const [templates, byId] = await Promise.all([db.templates.bulkGet(p.templateIds), exerciseMap()])
  const file: ProgramFile = {
    schema: PROGRAM_SCHEMA,
    name: p.name,
    templates: templates.filter((t): t is WorkoutTemplate => !!t).map(t => sharedTemplate(t, byId)),
  }
  if (p.notes) file.notes = p.notes
  if (p.cycleWeeks) file.cycleWeeks = p.cycleWeeks
  return file
}

/* ---------------- validation ---------------- */

const LIMITS = { templates: 14, items: 40, sets: 30, weeks: 12, stages: 10, name: 120, notes: 2000 }

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function num(v: unknown, min: number, max: number): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : undefined
}

function int(v: unknown, min: number, max: number): number | undefined {
  const n = num(v, min, max)
  return n !== undefined ? Math.round(n) : undefined
}

function str(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.trim().slice(0, max)
  return s || undefined
}

function prescribedSet(v: unknown): PrescribedSet | null {
  const o = obj(v)
  const reps = o && int(o.reps, 0, 100)
  if (!o || reps === undefined || reps === null) return null
  const out: PrescribedSet = { reps }
  const pct = num(o.pct, 0, 2)
  if (pct !== undefined) out.pct = pct
  if (o.amrap === true) out.amrap = true
  return out
}

function setList(v: unknown): PrescribedSet[] | undefined {
  if (!Array.isArray(v)) return undefined
  const sets = v.slice(0, LIMITS.sets).map(prescribedSet)
  return sets.length && sets.every(s => s) ? (sets as PrescribedSet[]) : undefined
}

function scheme(v: unknown): ProgressionScheme | undefined {
  const o = obj(v)
  if (!o) return undefined
  switch (o.kind) {
    case 'double':
      return { kind: 'double' }
    case 'rpe':
      return { kind: 'rpe' }
    case 'linear': {
      const stepKg = num(o.stepKg, 0, 50)
      const failsToDeload = int(o.failsToDeload, 1, 20)
      const deloadPct = num(o.deloadPct, 0, 0.9)
      if (stepKg === undefined || failsToDeload === undefined || deloadPct === undefined) return undefined
      const out: Extract<ProgressionScheme, { kind: 'linear' }> = { kind: 'linear', stepKg, failsToDeload, deloadPct }
      if (Array.isArray(o.stages)) {
        const stages = o.stages.slice(0, LIMITS.stages).map(s => {
          const so = obj(s)
          const sets = so && int(so.sets, 1, LIMITS.sets)
          const reps = so && int(so.reps, 1, 100)
          if (!so || !sets || !reps) return null
          return so.amrapLast === true ? { sets, reps, amrapLast: true } : { sets, reps }
        })
        if (stages.length && stages.every(s => s)) out.stages = stages as NonNullable<(typeof stages)[number]>[]
      }
      return out
    }
    case 'percent': {
      const tmStepKg = num(o.tmStepKg, 0, 50)
      if (o.basis !== 'tm' || tmStepKg === undefined) return undefined
      const out: Extract<ProgressionScheme, { kind: 'percent' }> = { kind: 'percent', basis: 'tm', tmStepKg }
      if (Array.isArray(o.tmBumpByReps)) {
        const bumps = o.tmBumpByReps.slice(0, 10).map(b => {
          const bo = obj(b)
          const minReps = bo && int(bo.minReps, 0, 100)
          const kg = bo && num(bo.kg, -50, 50)
          return bo && minReps !== undefined && minReps !== null && kg !== undefined && kg !== null ? { minReps, kg } : null
        })
        if (bumps.length && bumps.every(b => b)) out.tmBumpByReps = bumps as { minReps: number; kg: number }[]
      }
      return out
    }
    default:
      return undefined
  }
}

function sharedExerciseOf(v: unknown): SharedExercise | null {
  const o = obj(v)
  const name = o && str(o.name, LIMITS.name)
  if (!o || !name) return null
  const out: SharedExercise = {
    name,
    muscleGroup: MUSCLE_GROUPS.includes(o.muscleGroup as MuscleGroup) ? (o.muscleGroup as MuscleGroup) : 'other',
    equipment: EQUIPMENTS.includes(o.equipment as Equipment) ? (o.equipment as Equipment) : 'other',
  }
  // Becomes part of a row id (`lib-<id>`): dataset ids are short and alphanumeric.
  if (typeof o.libraryId === 'string' && /^[A-Za-z0-9_-]{1,16}$/.test(o.libraryId)) out.libraryId = o.libraryId
  if (o.kind === 'strength' || o.kind === 'cardio') out.kind = o.kind
  return out
}

function sharedItemOf(v: unknown): SharedItem | null {
  const o = obj(v)
  const exercise = o && sharedExerciseOf(o.exercise)
  const targetSets = o && int(o.targetSets, 1, LIMITS.sets)
  const targetReps = o && int(o.targetReps, 1, 300)
  if (!o || !exercise || !targetSets || !targetReps) return null
  const out: SharedItem = { exercise, targetSets, targetReps }
  const repsMax = int(o.targetRepsMax, targetReps, 300)
  if (repsMax !== undefined) out.targetRepsMax = repsMax
  const rest = int(o.restSec, 0, 900)
  if (rest !== undefined) out.restSec = rest
  if (o.supersetWithNext === true) out.supersetWithNext = true
  const sch = scheme(o.scheme)
  if (sch) out.scheme = sch
  const sets = setList(o.sets)
  if (sets) out.sets = sets
  if (Array.isArray(o.setsByWeek)) {
    const weeks = o.setsByWeek.slice(0, LIMITS.weeks).map(setList)
    if (weeks.length && weeks.every(w => w)) out.setsByWeek = weeks as PrescribedSet[][]
  }
  return out
}

function sharedTemplateOf(v: unknown): SharedTemplate | null {
  const o = obj(v)
  const name = o && str(o.name, LIMITS.name)
  if (!o || !name || !Array.isArray(o.items)) return null
  const items = o.items.slice(0, LIMITS.items).map(sharedItemOf).filter((i): i is SharedItem => !!i)
  // The last item can't link to a next one.
  if (items.length) delete items[items.length - 1].supersetWithNext
  return { name, items }
}

/**
 * Validate an untrusted template/program file (link payload or picked file) into a clean one:
 * unknown fields dropped, numbers range-checked, bad items skipped. Throws ShareLinkError
 * 'schema' for anything that is not one of ours, 'empty' when nothing usable is left.
 */
export function parseShareFile(raw: unknown): ShareFile {
  const o = obj(raw)
  if (!o || (o.schema !== TEMPLATE_SCHEMA && o.schema !== PROGRAM_SCHEMA)) {
    throw new ShareLinkError('schema', typeof o?.schema === 'string' ? o.schema.slice(0, 60) : undefined)
  }
  if (o.schema === TEMPLATE_SCHEMA) {
    const template = sharedTemplateOf(o.template)
    if (!template || !template.items.length) throw new ShareLinkError('empty')
    return { schema: TEMPLATE_SCHEMA, template }
  }
  const name = str(o.name, LIMITS.name)
  const templates = Array.isArray(o.templates)
    ? o.templates.slice(0, LIMITS.templates).map(sharedTemplateOf).filter((t): t is SharedTemplate => !!t)
    : []
  if (!name || !templates.length) throw new ShareLinkError('empty')
  const file: ProgramFile = { schema: PROGRAM_SCHEMA, name, templates }
  const notes = str(o.notes, LIMITS.notes)
  if (notes) file.notes = notes
  const cycleWeeks = int(o.cycleWeeks, 1, 52)
  if (cycleWeeks) file.cycleWeeks = cycleWeeks
  return file
}

/* ---------------- link encoding ---------------- */

const LINK_PREFIX = '#/import?t='
/** Inflated size cap: a share file is a few KB; refuse a deflate bomb. */
const MAX_INFLATED = 512 * 1024

function toBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new ShareLinkError('corrupt', 'base64url')
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)
  let bin: string
  try {
    bin = atob(b64)
  } catch {
    throw new ShareLinkError('corrupt', 'base64url')
  }
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Whether this runtime can produce `z` (deflated) links. */
export function canCompress(): boolean {
  return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function'
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate')).getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > MAX_INFLATED) {
      void reader.cancel()
      throw new ShareLinkError('corrupt', 'too large')
    }
    chunks.push(value)
  }
  const out = new Uint8Array(size)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}

/**
 * The share link fragment for a file: `#/import?t=z…` (deflated) when CompressionStream exists,
 * else `#/import?t=u…`. `compress: false` forces the plain form. Prepend PUBLIC_APP_URL (see
 * `shareLinkUrl`). Throws ShareLinkError 'tooLong' over MAX_LINK_CHARS.
 */
export async function encodeShareLink(file: ShareFile, opts: { compress?: boolean } = {}): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(file))
  const payload = (opts.compress ?? true) && canCompress() ? 'z' + toBase64Url(await deflate(json)) : 'u' + toBase64Url(json)
  const link = LINK_PREFIX + payload
  if (link.length > MAX_LINK_CHARS) throw new ShareLinkError('tooLong', `${link.length} chars`)
  return link
}

/** The full URL to send: the public PWA + the fragment from `encodeShareLink`. */
export function shareLinkUrl(fragment: string): string {
  return PUBLIC_APP_URL + fragment
}

/** Decode the `t` parameter of a share link (`z…` or `u…`) into a validated file. */
export async function decodeShareLink(param: string): Promise<ShareFile> {
  const p = param.trim()
  const prefix = p.charAt(0)
  if (prefix !== 'z' && prefix !== 'u') throw new ShareLinkError('prefix')
  let bytes = fromBase64Url(p.slice(1))
  if (prefix === 'z') {
    if (typeof DecompressionStream !== 'function') throw new ShareLinkError('corrupt', 'no DecompressionStream')
    try {
      bytes = await inflate(bytes)
    } catch (err) {
      if (err instanceof ShareLinkError) throw err
      throw new ShareLinkError('corrupt', 'deflate')
    }
  }
  let raw: unknown
  try {
    raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    throw new ShareLinkError('corrupt', 'json')
  }
  return parseShareFile(raw)
}

/**
 * What a user pastes: a full link (`…#/import?t=…`), the bare `t` value, or the file's JSON.
 */
export async function decodeShareInput(text: string): Promise<ShareFile> {
  const s = text.trim()
  if (s.startsWith('{')) {
    let raw: unknown
    try {
      raw = JSON.parse(s)
    } catch {
      throw new ShareLinkError('corrupt', 'json')
    }
    return parseShareFile(raw)
  }
  const m = /[?&]t=([^&#\s]+)/.exec(s)
  return decodeShareLink(m ? decodeURIComponent(m[1]) : s)
}

/* ---------------- import ---------------- */

export type ShareItemStatus = 'known' | 'library' | 'new'

export interface ShareImportPreview {
  templates: { name: string; items: { name: string; status: ShareItemStatus }[] }[]
  /** Distinct exercises the device already has. */
  known: number
  /** Distinct exercises the import will add (from the library or as custom ones). */
  toCreate: number
}

function templatesOf(file: ShareFile): SharedTemplate[] {
  return file.schema === TEMPLATE_SCHEMA ? [file.template] : file.templates
}

/** Same exercise inside one file: by library id, else by lower-case name. */
function refKey(x: SharedExercise): string {
  return x.libraryId ? `lib:${x.libraryId}` : `name:${x.name.toLowerCase()}`
}

/** The row a shared exercise stands for: library link first, else the lower-case name. */
function findExisting(x: SharedExercise, exercises: Exercise[]): Exercise | undefined {
  if (x.libraryId) {
    const linked = exercises.find(e => libraryIdOf(e) === x.libraryId)
    if (linked) return linked
  }
  const lower = x.name.toLowerCase()
  return exercises.find(e => e.nameLower === lower)
}

export function previewShareImport(file: ShareFile, exercises: Exercise[]): ShareImportPreview {
  const statusOf = new Map<string, ShareItemStatus>()
  const templates = templatesOf(file).map(t => ({
    name: t.name,
    items: t.items.map(i => {
      const key = refKey(i.exercise)
      let status = statusOf.get(key)
      if (!status) {
        status = findExisting(i.exercise, exercises) ? 'known' : i.exercise.libraryId ? 'library' : 'new'
        statusOf.set(key, status)
      }
      return { name: i.exercise.name, status }
    }),
  }))
  const statuses = [...statusOf.values()]
  return {
    templates,
    known: statuses.filter(s => s === 'known').length,
    toCreate: statuses.filter(s => s !== 'known').length,
  }
}

/** A new row for a shared exercise: the library's own row when the entry is known, else from the file. */
function newExerciseRow(x: SharedExercise, library: ExerciseLibrary | null): Exercise {
  const lib = x.libraryId ? library?.byId.get(x.libraryId) : undefined
  if (lib) return libraryExerciseRow(lib)
  // Library offline (or an id this build lacks): the same deterministic id, from the file's data.
  const base: Exercise = {
    name: x.name,
    nameLower: x.name.toLowerCase(),
    muscleGroup: x.muscleGroup,
    equipment: x.equipment,
    defaultRestSec: x.kind === 'cardio' || x.muscleGroup === 'cardio' ? 60 : 90,
    isCustom: true,
    ...(x.kind ? { kind: x.kind } : {}),
  }
  return x.libraryId
    ? { ...base, id: libraryRowId(x.libraryId), libraryId: x.libraryId }
    : { ...base, id: crypto.randomUUID() }
}

function templateItem(i: SharedItem, exerciseId: Id): TemplateItem {
  const out: TemplateItem = { exerciseId, targetSets: i.targetSets, targetReps: i.targetReps }
  if (i.targetRepsMax !== undefined) out.targetRepsMax = i.targetRepsMax
  if (i.restSec !== undefined) out.restSec = i.restSec
  if (i.supersetWithNext) out.supersetWithNext = true
  if (i.scheme) out.scheme = i.scheme
  if (i.sets) out.sets = i.sets
  if (i.setsByWeek) out.setsByWeek = i.setsByWeek
  return out
}

/**
 * Write a shared template/program: one transaction on the sync lock (never overlapping a pull),
 * tracked writes so it syncs. Exercises are matched (library link, else lower-case name) or
 * created (library row `lib-<id>`, else a custom one); templates go after the existing ones. A
 * program file also adds a Program row, not started (`cycleStartDate` unset). `presetId` marks
 * a program installed from a bundled preset.
 */
export async function applyShareImport(
  input: ShareFile,
  opts: { presetId?: string } = {},
): Promise<{ templateIds: Id[]; programId?: Id }> {
  const file = parseShareFile(input)
  const needsLibrary = templatesOf(file).some(t => t.items.some(i => i.exercise.libraryId))
  // Fetched before the transaction (IndexedDB transactions can't wait on the network).
  const library = needsLibrary ? await loadExerciseLibrary().catch(() => null) : null
  const tables = file.schema === PROGRAM_SCHEMA ? [db.exercises, db.templates, db.programs] : [db.exercises, db.templates]
  return withSyncLock(() =>
    db.transaction('rw', tables, async () => {
      const [exercises, existing] = await Promise.all([db.exercises.toArray(), db.templates.toArray()])
      const idOf = new Map<string, Id>()
      async function resolve(x: SharedExercise): Promise<Id> {
        const key = refKey(x)
        const known = idOf.get(key)
        if (known !== undefined) return known
        let row = findExisting(x, exercises)
        if (!row) {
          row = newExerciseRow(x, library)
          await db.exercises.add(row)
          exercises.push(row)
        }
        idOf.set(key, row.id!)
        return row.id!
      }

      let position = existing.reduce((m, t) => Math.max(m, t.position), -1) + 1
      const templateIds: Id[] = []
      for (const t of templatesOf(file)) {
        const items: TemplateItem[] = []
        for (const i of t.items) items.push(templateItem(i, await resolve(i.exercise)))
        const id = crypto.randomUUID()
        await db.templates.add({ id, name: t.name, position: position++, items, updatedAt: Date.now() })
        templateIds.push(id)
      }
      if (file.schema !== PROGRAM_SCHEMA) return { templateIds }

      const program: Program = { id: crypto.randomUUID(), name: file.name, templateIds }
      if (opts.presetId) program.presetId = opts.presetId
      if (file.cycleWeeks) program.cycleWeeks = file.cycleWeeks
      if (file.notes) program.notes = file.notes
      await db.programs.add(program)
      return { templateIds, programId: program.id! }
    }),
  )
}
