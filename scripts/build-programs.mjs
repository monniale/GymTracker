#!/usr/bin/env node
/**
 * Builds public/programs.json from the hand-written presets in scripts/programs/*.json (our own
 * data, MIT, like the rest of the repo). Each preset has the shape of a shared program file
 * (src/lib/shareTemplate.ts ProgramFile, schema 'gymtracker-program/v1') plus `id` (= file name),
 * `name` / `description` / every template `name` as { en, it }, `level` and `daysPerWeek`.
 * Exercises point at the exercise library by `libraryId` (public/exercise-library.json) and keep
 * an English `name`, `muscleGroup` and `equipment` as a fallback.
 *
 *   node scripts/build-programs.mjs          validate, then write public/programs.json
 *   node scripts/build-programs.mjs --check  validate and fail if public/programs.json is stale (CI)
 *
 * Exits non-zero on any problem: unknown library id, bad scheme shape, missing Italian (or
 * English) text, a `setsByWeek` whose length is not the program's `cycleWeeks`, a lift whose
 * training max more than one item changes (each percent item with a `tmBumpByReps` table or a
 * `tmStepKg` above 0 bumps the shared `Exercise.trainingMaxKg`), and so on.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC_DIR = join(ROOT, 'scripts/programs')
const LIBRARY = join(ROOT, 'public/exercise-library.json')
const OUT = join(ROOT, 'public/programs.json')
const CHECK = process.argv.includes('--check')

/** Display order of the presets (any other file follows, by name). */
const ORDER = [
  'starting-strength', 'stronglifts-5x5', 'gzclp', 'full-body-3x', 'reddit-ppl',
  'upper-lower-4day', 'phul', '531-bbb', 'nsuns-5day',
]

const SCHEMA = 'gymtracker-program/v1'
const LEVELS = ['beginner', 'intermediate', 'advanced']
const MUSCLE_GROUPS = ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'legs', 'glutes', 'core', 'cardio', 'other']
const EQUIPMENTS = ['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'other']
const LANGS = ['en', 'it']

const PRESET_KEYS = new Set(['schema', 'id', 'name', 'description', 'level', 'daysPerWeek', 'cycleWeeks', 'notes', 'templates'])
const TEMPLATE_KEYS = new Set(['name', 'items'])
const ITEM_KEYS = new Set([
  'exercise', 'targetSets', 'targetReps', 'targetRepsMax', 'restSec', 'supersetWithNext', 'scheme', 'sets', 'setsByWeek',
])
const EXERCISE_KEYS = new Set(['name', 'libraryId', 'muscleGroup', 'equipment', 'kind'])

const problems = []
const fail = (where, msg) => problems.push(`${where}: ${msg}`)

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v)
const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max
const isNum = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
const isText = v => typeof v === 'string' && v.trim().length > 0

function unknownKeys(where, o, allowed) {
  for (const k of Object.keys(o)) if (!allowed.has(k)) fail(where, `unknown field "${k}"`)
}

function checkText(where, v) {
  if (!isObj(v)) return fail(where, 'must be { en, it }')
  for (const lang of LANGS) if (!isText(v[lang])) fail(where, `missing "${lang}" text`)
  for (const k of Object.keys(v)) if (!LANGS.includes(k)) fail(where, `unknown language "${k}"`)
}

function checkSetList(where, list, { needPct }) {
  if (!Array.isArray(list) || list.length === 0) return fail(where, 'must be a non-empty array')
  list.forEach((s, i) => {
    const w = `${where}[${i}]`
    if (!isObj(s)) return fail(w, 'must be an object')
    for (const k of Object.keys(s)) if (!['pct', 'reps', 'amrap'].includes(k)) fail(w, `unknown field "${k}"`)
    if (!isInt(s.reps, 1, 100)) fail(w, 'reps must be an integer 1-100')
    if (s.pct !== undefined && !isNum(s.pct, 0.05, 1.2)) fail(w, 'pct must be a fraction of the training max (0.05-1.2)')
    if (needPct && s.pct === undefined) fail(w, 'a percent scheme needs pct on every set')
    if (s.amrap !== undefined && s.amrap !== true) fail(w, 'amrap must be true or absent')
  })
}

function checkScheme(where, s, item) {
  if (!isObj(s)) return fail(where, 'must be an object')
  const keys = {
    double: ['kind'],
    rpe: ['kind'],
    linear: ['kind', 'stepKg', 'failsToDeload', 'deloadPct', 'stages'],
    percent: ['kind', 'basis', 'tmStepKg', 'tmBumpByReps'],
  }[s.kind]
  if (!keys) return fail(where, `unknown kind "${s.kind}"`)
  for (const k of Object.keys(s)) if (!keys.includes(k)) fail(where, `unknown field "${k}" for kind ${s.kind}`)
  if (s.kind === 'rpe') fail(where, "kind 'rpe' is reserved (no engine yet)")
  if (s.kind === 'linear') {
    if (!isNum(s.stepKg, 0.5, 20)) fail(where, 'stepKg must be 0.5-20')
    if (!isInt(s.failsToDeload, 1, 10)) fail(where, 'failsToDeload must be an integer 1-10')
    if (!isNum(s.deloadPct, 0.01, 0.5)) fail(where, 'deloadPct must be a fraction 0.01-0.5')
    if (s.stages !== undefined) {
      if (!Array.isArray(s.stages) || s.stages.length < 2) fail(where, 'stages must list at least two stages')
      else s.stages.forEach((st, i) => {
        const w = `${where}.stages[${i}]`
        if (!isObj(st)) return fail(w, 'must be an object')
        for (const k of Object.keys(st)) if (!['sets', 'reps', 'amrapLast'].includes(k)) fail(w, `unknown field "${k}"`)
        if (!isInt(st.sets, 1, 20)) fail(w, 'sets must be an integer 1-20')
        if (!isInt(st.reps, 1, 50)) fail(w, 'reps must be an integer 1-50')
        if (st.amrapLast !== undefined && st.amrapLast !== true) fail(w, 'amrapLast must be true or absent')
      })
      if (Array.isArray(s.stages) && isObj(s.stages[0])
        && (s.stages[0].sets !== item.targetSets || s.stages[0].reps !== item.targetReps)) {
        fail(where, 'targetSets × targetReps must match the first stage')
      }
    }
  }
  if (s.kind === 'percent') {
    if (s.basis !== 'tm') fail(where, "basis must be 'tm'")
    if (!isNum(s.tmStepKg, 0, 20)) fail(where, 'tmStepKg must be 0-20')
    if (s.tmBumpByReps !== undefined) {
      if (!Array.isArray(s.tmBumpByReps) || s.tmBumpByReps.length === 0) fail(where, 'tmBumpByReps must be a non-empty array')
      else {
        let last = -1
        s.tmBumpByReps.forEach((b, i) => {
          const w = `${where}.tmBumpByReps[${i}]`
          if (!isObj(b) || !isInt(b.minReps, 0, 50) || !isNum(b.kg, -20, 20)) return fail(w, 'must be { minReps: 0-50, kg: -20..20 }')
          if (b.minReps <= last) fail(w, 'minReps must increase')
          last = b.minReps
        })
      }
    }
    if (!item.sets && !item.setsByWeek) fail(where, 'a percent scheme needs sets or setsByWeek')
  }
}

/** The item changes its lift's training max: a percent scheme with a bump table or a fixed step. */
function bumpsTrainingMax(it) {
  const s = it?.scheme
  return isObj(s) && s.kind === 'percent' && ((Array.isArray(s.tmBumpByReps) && s.tmBumpByReps.length > 0) || s.tmStepKg > 0)
}

function checkItem(where, it, ctx) {
  if (!isObj(it)) return fail(where, 'must be an object')
  unknownKeys(where, it, ITEM_KEYS)
  const x = it.exercise
  if (!isObj(x)) fail(`${where}.exercise`, 'missing')
  else {
    unknownKeys(`${where}.exercise`, x, EXERCISE_KEYS)
    if (!isText(x.name)) fail(`${where}.exercise`, 'missing English name')
    if (!isText(x.libraryId)) fail(`${where}.exercise`, 'missing libraryId')
    else if (!ctx.library.has(x.libraryId)) fail(`${where}.exercise`, `libraryId ${x.libraryId} is not in public/exercise-library.json`)
    if (!MUSCLE_GROUPS.includes(x.muscleGroup)) fail(`${where}.exercise`, `bad muscleGroup "${x.muscleGroup}"`)
    if (!EQUIPMENTS.includes(x.equipment)) fail(`${where}.exercise`, `bad equipment "${x.equipment}"`)
    if (x.kind !== undefined && x.kind !== 'strength' && x.kind !== 'cardio') fail(`${where}.exercise`, `bad kind "${x.kind}"`)
    const key = x.libraryId ?? x.name
    if (ctx.seenInTemplate.has(key)) fail(where, `exercise ${x.name} appears twice in one template (sets are logged per exercise)`)
    ctx.seenInTemplate.add(key)
  }
  if (!isInt(it.targetSets, 1, 30)) fail(where, 'targetSets must be an integer 1-30')
  if (!isInt(it.targetReps, 1, 100)) fail(where, 'targetReps must be an integer 1-100')
  if (it.targetRepsMax !== undefined && !(isInt(it.targetRepsMax, 1, 100) && it.targetRepsMax > it.targetReps)) {
    fail(where, 'targetRepsMax must be an integer above targetReps')
  }
  if (it.restSec !== undefined && !isInt(it.restSec, 0, 900)) fail(where, 'restSec must be 0-900')
  if (it.supersetWithNext !== undefined && it.supersetWithNext !== true) fail(where, 'supersetWithNext must be true or absent')
  if (it.scheme !== undefined) checkScheme(`${where}.scheme`, it.scheme, it)
  const percent = it.scheme?.kind === 'percent'
  if (it.sets !== undefined) {
    checkSetList(`${where}.sets`, it.sets, { needPct: percent })
    if (Array.isArray(it.sets) && it.sets.length !== it.targetSets) fail(where, 'targetSets must equal the number of sets')
  }
  if (it.setsByWeek !== undefined) {
    if (!percent) fail(where, 'setsByWeek needs a percent scheme')
    if (!Array.isArray(it.setsByWeek)) fail(`${where}.setsByWeek`, 'must be an array')
    else {
      if (it.setsByWeek.length !== ctx.cycleWeeks) {
        fail(`${where}.setsByWeek`, `has ${it.setsByWeek.length} weeks, the program's cycleWeeks is ${ctx.cycleWeeks ?? 'unset'}`)
      }
      it.setsByWeek.forEach((w, i) => checkSetList(`${where}.setsByWeek[${i}]`, w, { needPct: true }))
      const longest = Math.max(...it.setsByWeek.map(w => (Array.isArray(w) ? w.length : 0)))
      if (it.targetSets !== longest) fail(where, 'targetSets must equal the longest week of setsByWeek')
    }
  }
  if (!percent && it.sets?.some?.(s => s.pct !== undefined)) fail(where, 'pct needs a percent scheme')
}

function checkPreset(file, p, library) {
  const where = basename(file)
  if (!isObj(p)) return fail(where, 'must be an object')
  unknownKeys(where, p, PRESET_KEYS)
  if (p.schema !== SCHEMA) fail(where, `schema must be "${SCHEMA}"`)
  if (p.id !== basename(file, '.json')) fail(where, 'id must equal the file name')
  checkText(`${where} name`, p.name)
  checkText(`${where} description`, p.description)
  if (p.notes !== undefined) fail(where, 'presets carry their text in description, not notes')
  if (!LEVELS.includes(p.level)) fail(where, `level must be one of ${LEVELS.join(', ')}`)
  if (!isInt(p.daysPerWeek, 1, 7)) fail(where, 'daysPerWeek must be an integer 1-7')
  if (p.cycleWeeks !== undefined && !isInt(p.cycleWeeks, 1, 12)) fail(where, 'cycleWeeks must be an integer 1-12')
  if (!Array.isArray(p.templates) || p.templates.length === 0) return fail(where, 'templates must be a non-empty array')
  const names = { en: new Set(), it: new Set() }
  p.templates.forEach((t, ti) => {
    const tw = `${where} templates[${ti}]`
    if (!isObj(t)) return fail(tw, 'must be an object')
    unknownKeys(tw, t, TEMPLATE_KEYS)
    checkText(`${tw} name`, t.name)
    for (const lang of LANGS) {
      const n = t.name?.[lang]
      if (isText(n)) {
        if (names[lang].has(n)) fail(tw, `duplicate ${lang} template name "${n}"`)
        names[lang].add(n)
      }
    }
    if (!Array.isArray(t.items) || t.items.length === 0) return fail(tw, 'items must be a non-empty array')
    const ctx = { library, cycleWeeks: p.cycleWeeks, seenInTemplate: new Set() }
    t.items.forEach((it, ii) => checkItem(`${tw} items[${ii}]`, it, ctx))
    if (t.items[t.items.length - 1]?.supersetWithNext) fail(tw, 'the last item cannot link to a next one')
  })
  // One training-max bump source per lift per program, else the shared TM moves twice a cycle.
  const bumpers = new Map()
  p.templates.forEach((t, ti) => (Array.isArray(t?.items) ? t.items : []).forEach((it, ii) => {
    if (!bumpsTrainingMax(it)) return
    const w = `${where} templates[${ti}] items[${ii}]`
    const s = it.scheme
    if (!(Array.isArray(s.tmBumpByReps) && s.tmBumpByReps.length > 0) && p.cycleWeeks === undefined) {
      fail(w, 'a fixed tmStepKg needs the program\'s cycleWeeks (the bump comes after the last week)')
    }
    const key = it.exercise?.libraryId ?? it.exercise?.name
    if (bumpers.has(key)) fail(w, `${it.exercise?.name} already changes its training max at ${bumpers.get(key)}: give one of them tmStepKg 0 and no tmBumpByReps`)
    else bumpers.set(key, w)
  }))
}

const library = new Set(JSON.parse(readFileSync(LIBRARY, 'utf8')).exercises.map(r => r[0]))

const files = readdirSync(SRC_DIR).filter(f => f.endsWith('.json'))
const rank = id => {
  const i = ORDER.indexOf(id)
  return i < 0 ? ORDER.length : i
}
files.sort((a, b) => rank(basename(a, '.json')) - rank(basename(b, '.json')) || (a < b ? -1 : 1))
for (const id of ORDER) if (!files.includes(`${id}.json`)) fail('scripts/programs', `missing ${id}.json`)

const presets = []
for (const f of files) {
  let p
  try {
    p = JSON.parse(readFileSync(join(SRC_DIR, f), 'utf8'))
  } catch (err) {
    fail(f, `invalid JSON (${err.message})`)
    continue
  }
  checkPreset(f, p, library)
  presets.push(p)
}

if (problems.length) {
  console.error(`build-programs: ${problems.length} problem(s)`)
  for (const p of problems) console.error(`  ${p}`)
  process.exit(1)
}

const out = JSON.stringify({ license: 'MIT', presets }) + '\n'

if (CHECK) {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : ''
  if (current !== out) {
    console.error('build-programs: public/programs.json is stale: run `node scripts/build-programs.mjs`')
    process.exit(1)
  }
  console.log(`build-programs: ${presets.length} presets OK, public/programs.json up to date`)
} else {
  writeFileSync(OUT, out)
  console.log(`build-programs: wrote ${presets.length} presets to public/programs.json (${out.length} bytes)`)
}
