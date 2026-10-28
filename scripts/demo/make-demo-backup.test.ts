/**
 * Demo-data generator (Feature 3, docs/FEATURE_PLAN.md). Not a real test: it only runs when
 * DEMO_OUT is set (`npm run demo:build`), so a plain `npm test` skips it.
 *
 * It replays 16 weeks of a plausible user through the app's own write paths (session add +
 * set add as WorkoutHome/ActiveSession do, finishSession, the launch-time daily checks,
 * achievements and quests, logFood, planFood, saveJudgement) under a faked clock, then writes
 * the export in the exact BackupFile shape of src/db/backup.ts. Every random choice comes from
 * a seeded PRNG and every UUID from a seeded generator, so the output is byte-for-byte stable.
 *
 * Anchor: exportedAt = Monday 2026-10-19 12:00 Europe/Rome (TZ pinned by the npm script). The
 * app shifts the data by whole weeks on load (src/lib/demoData.ts rebaseDemoTables).
 * All stored names are English (ROUTEMAP invariant 19).
 */
import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { it, expect, vi } from 'vitest'
import { db } from '../../src/db/db'
import { ensureSeeded } from '../../src/db/seed'
import { TABLES, collectTables, type BackupFile } from '../../src/db/backup'
import { finishSession } from '../../src/lib/finishSession'
import { runDailyChecksOnce } from '../../src/lib/season'
import { checkAchievements } from '../../src/lib/achievements'
import { evaluateQuests } from '../../src/lib/quests'
import { logFood, totalsForLogs, dayTargets } from '../../src/lib/nutrition'
import { planFood } from '../../src/lib/mealPlan'
import { saveJudgement } from '../../src/lib/coachHistory'
import { setE1rm } from '../../src/lib/load'
import { warmupRamp } from '../../src/lib/plates'
import { cardioFields } from '../../src/lib/cardio'
import { localDateStr, addDays, parseLocalDate } from '../../src/lib/dates'
import { rankForPoints, rankLabelEn, SEASON_CARRYOVER } from '../../src/lib/ranks'
import type { CoachNote, Exercise, Id, MealType, Session, TemplateItem, WorkoutTemplate } from '../../src/types'

/* ---------- determinism ---------- */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rnd = mulberry32(20261019)
const uuidRnd = mulberry32(0x9e3779b9)
const chance = (p: number) => rnd() < p
const between = (lo: number, hi: number) => lo + rnd() * (hi - lo)
const int = (lo: number, hi: number) => Math.floor(between(lo, hi + 1))
/** Grams with ±pct noise, rounded to 5 g (what people type). */
const grams = (g: number, pct = 0.1) => Math.max(5, Math.round((g * between(1 - pct, 1 + pct)) / 5) * 5)

function seededUuid(): `${string}-${string}-${string}-${string}-${string}` {
  const b = Array.from({ length: 16 }, () => Math.floor(uuidRnd() * 256))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = b.map(x => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

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

/* ---------- clock ---------- */

const MIN = 60_000
const at = (ms: number) => vi.setSystemTime(ms)
/** Local time on a YYYY-MM-DD day (Europe/Rome, pinned by the npm script). */
const on = (date: string, h: number, m = 0, s = 0) => {
  const d = parseLocalDate(date)
  d.setHours(h, m, s, 0)
  return d.getTime()
}

const FIRST_DAY = '2026-06-29' // Monday, 16 weeks before the anchor
const ANCHOR_DAY = '2026-10-19' // Monday
const ANCHOR = on(ANCHOR_DAY, 12)
const WEEKS = 16

/* ---------- catalog exercises (src/db/seed.ts deterministic ids) ---------- */

const EX = {
  bench: 1, inclineDbPress: 4, deadlift: 11, pullUp: 12, latPulldown: 14, cableRow: 17,
  ohp: 21, lateralRaise: 24, facePull: 28, pushdown: 39,
  squat: 42, legPress: 45, rdl: 47, legCurl: 50, rowingMachine: 65,
} as const

interface Prog { w: number; reps: number[]; lo: number; hi: number; step: number }

/** Double progression per exercise: add reps up to `hi` on every set, then add `step` kg. */
const prog = new Map<Id, Prog>([
  [EX.bench, { w: 80, reps: [6, 6, 6], lo: 6, hi: 8, step: 2.5 }],
  [EX.ohp, { w: 47.5, reps: [6, 6, 6], lo: 6, hi: 8, step: 2.5 }],
  [EX.inclineDbPress, { w: 26, reps: [8, 8, 8], lo: 8, hi: 10, step: 2 }],
  [EX.lateralRaise, { w: 10, reps: [12, 12, 12], lo: 12, hi: 15, step: 2 }],
  [EX.pushdown, { w: 25, reps: [10, 10, 10], lo: 10, hi: 12, step: 2.5 }],
  [EX.deadlift, { w: 130, reps: [5, 5, 4], lo: 4, hi: 6, step: 5 }],
  // Bodyweight: w is the ADDED kg (0 = bodyweight only), scored as bodyweight + w (src/lib/load.ts).
  [EX.pullUp, { w: 0, reps: [6, 6, 6], lo: 6, hi: 8, step: 1.25 }],
  [EX.latPulldown, { w: 60, reps: [8, 8, 8], lo: 8, hi: 10, step: 2.5 }],
  [EX.cableRow, { w: 57.5, reps: [8, 8, 8], lo: 8, hi: 10, step: 2.5 }],
  [EX.facePull, { w: 20, reps: [12, 12, 12], lo: 12, hi: 15, step: 2.5 }],
  [EX.squat, { w: 100, reps: [5, 5, 5], lo: 5, hi: 7, step: 2.5 }],
  [EX.rdl, { w: 90, reps: [8, 8, 8], lo: 8, hi: 10, step: 2.5 }],
  [EX.legPress, { w: 160, reps: [10, 10, 10], lo: 10, hi: 12, step: 10 }],
  [EX.legCurl, { w: 42.5, reps: [10, 10, 10], lo: 10, hi: 12, step: 2.5 }],
])

const item = (exerciseId: Id, targetSets: number, targetReps: number, extra: Partial<TemplateItem> = {}): TemplateItem =>
  ({ exerciseId, targetSets, targetReps, ...extra })

const TEMPLATE_DEFS: Omit<WorkoutTemplate, 'id' | 'updatedAt'>[] = [
  {
    name: 'Push', position: 0, items: [
      item(EX.bench, 3, 8, { restSec: 150 }),
      item(EX.ohp, 3, 8),
      item(EX.inclineDbPress, 3, 10),
      item(EX.lateralRaise, 3, 15, { supersetWithNext: true }),
      item(EX.pushdown, 3, 12),
    ],
  },
  {
    name: 'Pull', position: 1, items: [
      item(EX.deadlift, 3, 6, { restSec: 180 }),
      item(EX.pullUp, 3, 8),
      item(EX.latPulldown, 3, 10),
      item(EX.cableRow, 3, 10),
      item(EX.facePull, 3, 15),
      item(EX.rowingMachine, 1, 10), // cardio: target minutes
    ],
  },
  {
    name: 'Legs', position: 2, items: [
      item(EX.squat, 3, 7, { restSec: 180 }),
      item(EX.rdl, 3, 10),
      item(EX.legPress, 3, 12),
      item(EX.legCurl, 3, 12),
    ],
  },
]

/** Training days per week (0 = Monday). Week 6 is a holiday, week 10 a sick week, week 9 has 4 sessions.
 * Both breaks fall in the first season (it rolls over on 2026-09-21, week 12), so the current season
 * has no idle decay and its points equal carry-over + its score events (what merge.ts recomputes).
 * The last week ends with a Sunday session, the day before the export: the app shifts the demo by
 * whole weeks, so a visitor loads it up to 6 days after the shifted export day, and the last session
 * must stay within the 7-day idle grace (DECAY_GRACE_DAYS) for every weekday. */
const SCHEDULE: number[][] = [
  [0, 2, 4], [0, 2, 4], [1, 3, 5], [0, 2, 4], [0, 2, 5], [0, 2, 4], [], [0, 2, 4],
  [1, 3, 5], [0, 1, 3, 5], [], [0, 2, 4], [0, 2, 4], [1, 3, 5], [0, 2, 4], [0, 2, 4, 6],
]
const HOLIDAY_WEEK = 6
const SICK_WEEK = 10

/* ---------- foods (custom, macros per 100 g) ---------- */

interface FoodDef { key: string; name: string; kcal100: number; protein100: number; carbs100: number; fat100: number; servingG?: number }
const FOODS: FoodDef[] = [
  { key: 'oats', name: 'Rolled Oats', kcal100: 372, protein100: 13.5, carbs100: 58.7, fat100: 7 },
  { key: 'yogurt', name: 'Greek Yogurt 0%', kcal100: 57, protein100: 10.3, carbs100: 3.6, fat100: 0.2, servingG: 170 },
  { key: 'banana', name: 'Banana', kcal100: 89, protein100: 1.1, carbs100: 22.8, fat100: 0.3, servingG: 120 },
  { key: 'eggs', name: 'Eggs', kcal100: 143, protein100: 12.6, carbs100: 0.7, fat100: 9.5, servingG: 60 },
  { key: 'bread', name: 'Whole Grain Bread', kcal100: 247, protein100: 13, carbs100: 41, fat100: 3.4 },
  { key: 'chicken', name: 'Chicken Breast', kcal100: 110, protein100: 23.1, carbs100: 0, fat100: 1.2 },
  { key: 'rice', name: 'Basmati Rice (dry)', kcal100: 356, protein100: 8.1, carbs100: 78, fat100: 0.9 },
  { key: 'pasta', name: 'Whole Wheat Pasta (dry)', kcal100: 348, protein100: 13, carbs100: 64, fat100: 2.5 },
  { key: 'oil', name: 'Extra Virgin Olive Oil', kcal100: 884, protein100: 0, carbs100: 0, fat100: 100 },
  { key: 'salmon', name: 'Salmon Fillet', kcal100: 208, protein100: 20.4, carbs100: 0, fat100: 13.4 },
  { key: 'whey', name: 'Whey Protein', kcal100: 380, protein100: 78, carbs100: 7, fat100: 5.5, servingG: 30 },
  { key: 'pizza', name: 'Margherita Pizza', kcal100: 250, protein100: 10.5, carbs100: 33, fat100: 8.5, servingG: 330 },
]
const foodIds = new Map<string, Id>()

/** AddFoodSheet "Custom food" save: the food row, then the first log of it. */
async function foodId(key: string): Promise<Id> {
  const known = foodIds.get(key)
  if (known !== undefined) return known
  const f = FOODS.find(x => x.key === key)!
  const id = await db.foods.add({
    source: 'custom',
    name: f.name,
    nameLower: f.name.toLowerCase(),
    kcal100: f.kcal100,
    protein100: f.protein100,
    carbs100: f.carbs100,
    fat100: f.fat100,
    servingG: f.servingG,
    userOverridden: false,
    lastUsedAt: Date.now(),
    useCount: 0,
  })
  foodIds.set(key, id)
  return id
}

type Plate = [key: string, g: number][]

function menu(training: boolean, weekend: boolean): Record<MealType, Plate> {
  const breakfast: Plate = chance(0.65)
    ? [['oats', grams(85)], ['yogurt', grams(300)]]
    : [['eggs', grams(200, 0.15)], ['bread', grams(90)]]
  if (chance(0.4)) breakfast.push(['banana', grams(120, 0.15)])
  const carbLunch: [string, number] = chance(0.55) ? ['rice', grams(training ? 110 : 80)] : ['pasta', grams(training ? 115 : 85)]
  const lunch: Plate = [['chicken', grams(240)], carbLunch]
  if (chance(0.5)) lunch.push(['oil', grams(15, 0.2)])
  const snack: Plate = chance(0.7) ? [['whey', 30]] : [['yogurt', grams(300)]]
  const dinner: Plate = weekend && chance(0.35)
    ? [['pizza', 330]]
    : chance(0.5)
      ? [['salmon', grams(210)], ['rice', grams(training ? 85 : 60)]]
      : [['chicken', grams(240)], ['bread', grams(90)]]
  return { breakfast, lunch, snack, dinner }
}

const MEAL_TIME: Record<MealType, [number, number]> = {
  breakfast: [7, 40], lunch: [13, 10], snack: [16, 40], dinner: [20, 45],
}

async function logMeal(date: string, meal: MealType, plate: Plate): Promise<void> {
  const [h, m] = MEAL_TIME[meal]
  let t = on(date, h, m + int(-10, 15), int(0, 59))
  for (const [key, g] of plate) {
    at(t)
    await logFood(await foodId(key), g, date, meal)
    t += int(15, 50) * 1000
  }
}

/* ---------- workouts ---------- */

/** The session being logged: its row (bodyweight + `bwScoring` stamp) and its exercises, for `setE1rm`. */
interface LogCtx { session: Session; exercises: Map<Id, Exercise> }

async function logSet(ctx: LogCtx, exerciseId: Id, setNumber: number, weightKg: number, reps: number, isWarmup: boolean, t: number) {
  at(t)
  const e1rm = setE1rm({ weightKg, reps }, ctx.exercises.get(exerciseId), ctx.session)
  await db.sets.add({ sessionId: ctx.session.id!, exerciseId, setNumber, weightKg, reps, isWarmup, completedAt: Date.now(), e1rm })
}

/** Reps actually done this session: the planned reps, the last set sometimes one short. */
function repsToday(p: Prog): number[] {
  return p.reps.map((r, i) => (i === p.reps.length - 1 && chance(0.25) ? Math.max(p.lo - 1, r - 1) : r))
}

/** Double progression after a session: reps creep up; every set at the top of the range → add weight. */
function progress(p: Prog, done: number[], weekIdx: number) {
  if (done.every(r => r >= p.hi)) {
    p.w = Math.round((p.w + p.step) * 10) / 10
    p.reps = p.reps.map(() => p.lo)
    return
  }
  // Progress slows as the cut goes on.
  const pInc = weekIdx < 8 ? 0.55 : 0.4
  p.reps = p.reps.map((r, i) => (r < p.hi && done[i] >= r && chance(pInc) ? r + 1 : r))
}

/** After a missed week: a rep lost on every set. */
function detrain() {
  for (const p of prog.values()) p.reps = p.reps.map(r => Math.max(p.lo, r - 1))
}

let rowingSessions = 0

/** One workout as the app records it: WorkoutHome startWorkout, ActiveSession set logging, finishSession,
 * then the SessionSummary unlock checks. Returns the session id. */
async function runWorkout(tpl: WorkoutTemplate, startMs: number, weekIdx: number): Promise<Id> {
  at(startMs)
  const settings = await db.settings.get(1)
  const sessionId = await db.sessions.add({
    templateId: tpl.id,
    name: tpl.name,
    startedAt: Date.now(),
    bodyweightKg: settings?.bodyweightKg ?? 75,
    extraExerciseIds: [],
    // WorkoutHome startWorkout stamps every new session (bodyweight load, src/lib/load.ts).
    bwScoring: true,
  })
  const session = (await db.sessions.get(sessionId))!
  const barKg = settings?.barWeightKg ?? 20
  let clock = startMs + int(3, 7) * MIN

  const exercises = new Map((await db.exercises.bulkGet(tpl.items.map(i => i.exerciseId))).map((e, i) => [tpl.items[i].exerciseId, e!]))
  const done = new Map<Id, number[]>()
  const ctx: LogCtx = { session, exercises }

  for (let i = 0; i < tpl.items.length; i++) {
    const it = tpl.items[i]
    const ex = exercises.get(it.exerciseId)!
    const rest = (it.restSec ?? ex.defaultRestSec) * 1000

    if (ex.muscleGroup === 'cardio') {
      // Cardio row (CardioPendingRow): time + distance, weight/reps/e1rm 0.
      rowingSessions++
      const durationSec = 600
      const distanceM = Math.round(2250 + rowingSessions * 6 + between(-40, 40))
      clock += 2 * MIN
      at(clock + durationSec * 1000)
      await db.sets.add({ sessionId, exerciseId: it.exerciseId, setNumber: 1, completedAt: Date.now(), ...cardioFields({ durationSec, distanceM }) })
      clock += durationSec * 1000
      continue
    }

    if (it.supersetWithNext && i + 1 < tpl.items.length) {
      // Superset: A1, B1, A2, B2… rest only after the second member.
      const other = tpl.items[i + 1]
      const pa = prog.get(it.exerciseId)!
      const pb = prog.get(other.exerciseId)!
      const ra = repsToday(pa)
      const rb = repsToday(pb)
      for (let s = 0; s < ra.length; s++) {
        clock += 45_000
        await logSet(ctx, it.exerciseId, s + 1, pa.w, ra[s], false, clock)
        clock += 50_000
        await logSet(ctx, other.exerciseId, s + 1, pb.w, rb[s], false, clock)
        clock += 90_000 + int(-10, 25) * 1000
      }
      done.set(it.exerciseId, ra)
      done.set(other.exerciseId, rb)
      i++
      continue
    }

    const p = prog.get(it.exerciseId)!
    let setNumber = 0
    if (i === 0 && ex.equipment === 'barbell' && p.w >= barKg * 1.5) {
      // "Add warm-up ramp" (ActiveSession addRamp): one bulkAdd, completedAt at + i.
      const steps = warmupRamp(p.w, barKg)
      at(clock)
      const t0 = Date.now()
      await db.sets.bulkAdd(steps.map((st, k) => ({
        sessionId, exerciseId: it.exerciseId, setNumber: k + 1, weightKg: st.weightKg, reps: st.reps,
        isWarmup: true, completedAt: t0 + k, e1rm: setE1rm(st, ex, session),
      })))
      setNumber = steps.length
      clock += steps.length * 100_000
    }
    const reps = repsToday(p)
    for (let s = 0; s < reps.length; s++) {
      clock += 40_000
      setNumber++
      await logSet(ctx, it.exerciseId, setNumber, p.w, reps[s], false, clock)
      if (s < reps.length - 1) clock += rest + int(-15, 35) * 1000
    }
    done.set(it.exerciseId, reps)
    clock += int(90, 150) * 1000 // walk to the next station
  }

  at(clock + int(2, 5) * MIN)
  await finishSession(sessionId)
  // SessionSummary: unlocks and quest awards right after the finish.
  await checkAchievements()
  await evaluateQuests()

  for (const [exId, reps] of done) progress(prog.get(exId)!, reps, weekIdx)
  return sessionId
}

/* ---------- body weight ---------- */

/** 84 kg → ~79 kg over 16 weeks, a little rebound around the holiday, daily noise. */
function weightOn(dayIdx: number): number {
  const x = dayIdx / (WEEKS * 7)
  let w = 84 - 5.1 * Math.pow(x, 0.92)
  const sinceHoliday = dayIdx - HOLIDAY_WEEK * 7
  if (sinceHoliday >= 0) w += 0.7 * Math.exp(-Math.max(0, sinceHoliday - 7) / 10)
  return Math.round((w + between(-0.35, 0.35)) * 10) / 10
}

/** ProgressScreen "Log weight": bodyLog row + settings bodyweight. */
async function weighIn(date: string, dayIdx: number) {
  at(on(date, 7, int(5, 20), int(0, 59)))
  const w = weightOn(dayIdx)
  await db.bodyLog.put({ date: localDateStr(), weightKg: w })
  await db.settings.update(1, { bodyweightKg: w })
}

/* ---------- coach verdicts (hand-written, built on the real numbers) ---------- */

const r1 = (n: number) => Math.round(n * 10) / 10
const kg = (n: number) => `${r1(n)} kg`

async function workoutVerdict(sessionId: Id): Promise<CoachNote> {
  const event = (await db.scoreEvents.where('sessionId').equals(sessionId).first())!
  const sets = await db.sets.where('sessionId').equals(sessionId).toArray()
  const work = sets.filter(s => !s.isWarmup && s.weightKg > 0)
  const best = (exId: Id) => work.filter(s => s.exerciseId === exId).sort((a, b) => b.e1rm - a.e1rm)[0]
  const bench = best(EX.bench)
  const ohp = best(EX.ohp)
  const prs = event.breakdown.filter(b => b.e1rmPr)
  const rank = (await db.rankState.get(1))!
  const insights: CoachNote['insights'] = [
    {
      category: 'verdict', tone: 'positive',
      message: `${work.length} working sets at ${Math.round(event.basePoints)} base points, every lift inside its rep range.`,
    },
    prs.length > 0
      ? {
        category: 'pr', tone: 'celebratory',
        message: `New season best on ${prs.map(p => p.exerciseName).join(' and ')}: ${prs.map(p => `${kg(p.bestE1rm)} estimated 1RM`).join(', ')}.`,
      }
      : {
        category: 'progression', tone: 'neutral',
        message: `Bench held at ${kg(bench.weightKg)}; one more rep on the last set and the double progression moves you up.`,
      },
    {
      category: 'progression', tone: 'positive',
      message: `Overhead press ${kg(ohp.weightKg)} × ${ohp.reps} while cutting is a good sign: strength is holding as the weight comes down.`,
    },
    {
      category: 'consistency', tone: 'celebratory',
      message: `${rank.streakWeeks} weeks in a row at your 3-session target. Keep Monday's Pull session and the streak keeps growing.`,
    },
  ]
  return {
    headline: `Strong push day: bench ${kg(bench.weightKg)} × ${bench.reps}`,
    tone: prs.length > 0 ? 'celebratory' : 'positive',
    insights,
  }
}

async function dietReport(date: string): Promise<CoachNote> {
  const logs = await db.foodLogs.where('date').equals(date).toArray()
  const foods = new Map((await db.foods.toArray()).map(f => [f.id!, f]))
  const tot = totalsForLogs(logs, foods)
  const settings = (await db.settings.get(1))!
  const dayStart = on(date, 0)
  const trained = (await db.sessions.where('startedAt').between(dayStart, dayStart + 86_400_000).count()) > 0
  const tg = dayTargets(settings, trained)
  const water = (await db.waterLogs.where('date').equals(date).toArray()).reduce((a, w) => a + w.ml, 0)
  const proteinOk = tot.protein >= tg.protein * 0.95
  const meals = new Set(logs.map(l => l.meal)).size
  return {
    headline: proteinOk ? 'Protein on point, calories close to target' : 'Good calories, protein a little short',
    tone: proteinOk ? 'positive' : 'neutral',
    insights: [
      {
        category: 'calories', tone: Math.abs(tot.kcal - tg.kcal) < 200 ? 'positive' : 'neutral',
        message: tot.kcal > tg.kcal
          ? `${Math.round(tot.kcal)} kcal against a ${tg.kcal} kcal ${trained ? 'training' : 'rest'}-day target: a little over, which the lighter days this week make up for.`
          : `${Math.round(tot.kcal)} kcal against a ${tg.kcal} kcal ${trained ? 'training' : 'rest'}-day target: a steady deficit without going too low.`,
      },
      {
        category: 'protein', tone: proteinOk ? 'positive' : 'warning',
        message: `${Math.round(tot.protein)} g protein of ${tg.protein} g, spread over ${meals} meals. Protein at every meal is what keeps the muscle while the weight drops.`,
      },
      {
        category: 'macros', tone: 'neutral',
        message: `Carbs ${Math.round(tot.carbs)} g and fat ${Math.round(tot.fat)} g. Put most of the rice and pasta around training to fuel the sessions.`,
      },
      {
        category: 'hydration', tone: water >= (settings.waterTargetMl ?? 2500) ? 'positive' : 'neutral',
        message: `${(water / 1000).toFixed(2)} L of water logged. Aim for the full ${((settings.waterTargetMl ?? 2500) / 1000).toFixed(1)} L, more on training days.`,
      },
    ],
  }
}

async function weekReview(monday: string): Promise<CoachNote> {
  const start = on(monday, 0)
  const end = start + 7 * 86_400_000
  const sessions = await db.sessions.where('startedAt').between(start, end).filter(s => s.endedAt !== undefined).toArray()
  const ids = new Set(sessions.map(s => s.id!))
  const sets = (await db.sets.toArray()).filter(s => ids.has(s.sessionId) && !s.isWarmup)
  const volume = Math.round(sets.reduce((a, s) => a + s.weightKg * s.reps, 0))
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i))
  const weights = (await db.bodyLog.where('date').anyOf(days).sortBy('date')).map(b => b.weightKg)
  const loggedDays = new Set((await db.foodLogs.where('date').anyOf(days).toArray()).map(l => l.date)).size
  const delta = weights.length > 1 ? r1(weights[weights.length - 1] - weights[0]) : 0
  return {
    headline: delta <= -0.4
      ? `${sessions.length} of 3 sessions done and ${Math.abs(delta)} kg down: a textbook cut week`
      : `${sessions.length} of 3 sessions done; the scale barely moved, the trend is still down`,
    tone: 'positive',
    insights: [
      {
        category: 'consistency', tone: 'celebratory',
        message: `${sessions.map(s => s.name).join(', ')}: all three sessions of the split, on schedule.`,
      },
      {
        category: 'intensity', tone: 'positive',
        message: `${volume.toLocaleString('en-US')} kg of working volume. Loads held or went up while you are eating under maintenance.`,
      },
      {
        category: 'calories', tone: 'positive',
        message: delta <= -0.4
          ? `Body weight from ${weights[0]} to ${weights[weights.length - 1]} kg (${delta} kg). Around 0.4–0.6 kg a week keeps the strength you have built.`
          : `Body weight from ${weights[0]} to ${weights[weights.length - 1]} kg (${delta} kg). One flat week is water and salt; judge the cut on the 4-week trend.`,
      },
      {
        category: 'macros', tone: 'neutral',
        message: loggedDays >= 7
          ? 'Food logged every day: the review has the full picture.'
          : `Food logged on ${loggedDays} of 7 days. Logging the missing days too gives next week's review a complete picture.`,
      },
    ],
  }
}

/* ---------- the run ---------- */

it.runIf(!!process.env.DEMO_OUT)('builds the demo backup', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.stubGlobal('localStorage', memoryStorage())
  vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(seededUuid)
  db.close()
  await Dexie.delete('gymtracker')
  await db.open()

  // Install: first launch on Monday morning, then the profile and the split.
  at(on(FIRST_DAY, 6, 55))
  await ensureSeeded()
  await runDailyChecksOnce()
  at(on(FIRST_DAY, 6, 58))
  await db.settings.update(1, {
    bodyweightKg: 84,
    kcalTarget: 2200, proteinTarget: 170, carbsTarget: 225, fatTarget: 65,
    restKcalTarget: 1900, restProteinTarget: 170, restCarbsTarget: 155, restFatTarget: 65,
    weeklySessionTarget: 3,
    waterTargetMl: 3000,
  })
  const templates: WorkoutTemplate[] = []
  for (const def of TEMPLATE_DEFS) {
    at(Date.now() + int(40, 120) * 1000)
    const id = await db.templates.add({ ...def, updatedAt: Date.now() })
    templates.push((await db.templates.get(id))!)
  }

  let sessionCount = 0
  let lastSessionId: Id | undefined
  const totalDays = WEEKS * 7
  const dietDays = new Set<string>()

  for (let d = 0; d <= totalDays; d++) {
    const date = addDays(FIRST_DAY, d)
    const week = Math.floor(d / 7)
    const wd = d % 7 // 0 = Monday
    const isAnchorDay = date === ANCHOR_DAY
    const onHoliday = week === HOLIDAY_WEEK
    const training = !isAnchorDay && (SCHEDULE[week] ?? []).includes(wd)
    const weekend = wd >= 5

    // Food tracking starts in week 3; skipped on the holiday and on some days (weekends more).
    const logsFood = isAnchorDay || date === '2026-10-15'
      || (week >= 3 && !onHoliday && !chance(weekend ? 0.4 : 0.07))
    const weighs = !onHoliday && (wd === 0 || wd === 3 || wd === 5 || (wd === 1 && chance(0.45)))
    if (d > 0 && !training && !logsFood && !weighs) continue

    // Morning launch (App.tsx): daily checks, then unlocks and quests.
    if (d > 0) {
      at(on(date, 7, int(0, 4)))
      await runDailyChecksOnce()
      await checkAchievements()
      await evaluateQuests()
    }
    if (week === HOLIDAY_WEEK + 1 && wd === 0) detrain()
    if (week === SICK_WEEK + 1 && wd === 0) detrain() // back from the sick week
    if (weighs || d === 0) await weighIn(date, d)

    if (logsFood) {
      dietDays.add(date)
      const plates = menu(training, weekend)
      await logMeal(date, 'breakfast', plates.breakfast)
      if (!isAnchorDay) {
        await logMeal(date, 'lunch', plates.lunch)
        if (chance(0.85)) await logMeal(date, 'snack', plates.snack)
      }
    }

    if (training) {
      const tpl = templates[sessionCount % templates.length]
      const start = weekend ? on(date, 10, int(0, 30)) : on(date, 18, int(15, 50))
      lastSessionId = await runWorkout(tpl, start, week)
      sessionCount++
    }

    if (logsFood && !isAnchorDay) {
      const plates = menu(training, weekend)
      await logMeal(date, 'dinner', plates.dinner)
    }

    // DietDay water button: +250 ml per tap through the day.
    if (logsFood && !isAnchorDay && (chance(0.4) || date === '2026-10-15')) {
      const taps = int(training ? 5 : 4, training ? 8 : 6)
      for (let k = 0; k < taps; k++) {
        at(on(date, 9 + Math.floor((k * 12) / taps), int(0, 59)))
        await db.waterLogs.add({ date, ml: 250 })
      }
    }

    // Evening look at the Rank screen: quest progress for the day's food.
    if (logsFood && !isAnchorDay) {
      at(on(date, 21, int(30, 59)))
      await evaluateQuests()
    }

    if (date === '2026-10-15') {
      at(on(date, 21, 50))
      await saveJudgement({ kind: 'diet', date, note: await dietReport(date), model: 'demo' })
    }
    if (training && date === '2026-10-16') {
      // Coach verdict on the session summary, a minute after the finish.
      const s = (await db.sessions.get(lastSessionId!))!
      at(s.endedAt! + 70_000)
      await saveJudgement({ kind: 'workout', sessionId: lastSessionId!, note: await workoutVerdict(lastSessionId!), model: 'demo' })
    }
    if (isAnchorDay) {
      // Weekly review of last week, then tomorrow's lunch on the meal plan.
      at(on(date, 8, 5))
      await saveJudgement({ kind: 'week', date: '2026-10-12', note: await weekReview('2026-10-12'), model: 'demo' })
      at(on(date, 11, 30))
      await planFood(await foodId('chicken'), 200, '2026-10-20', 'lunch')
      at(on(date, 11, 31))
      await planFood(await foodId('rice'), 90, '2026-10-20', 'lunch')
    }
  }

  // Export: the same shape and table list as exportBackup (backup.ts), stamped at the anchor.
  at(ANCHOR)
  const payload: BackupFile = { app: 'gymtracker', version: 2, exportedAt: ANCHOR, tables: await collectTables() }
  const json = JSON.stringify(payload)
  const out = resolve(process.cwd(), process.env.DEMO_OUT!)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, json + '\n')

  // Sanity checks on what was written.
  const tables = payload.tables
  expect(Object.keys(tables).sort()).toEqual([...TABLES].sort())
  expect(json.length).toBeLessThan(400 * 1024)
  const rank = (await db.rankState.get(1))!
  const events = tables.scoreEvents as { total: number; date: string }[]
  const inSeason = events.filter(e => e.date >= rank.seasonStart).reduce((a, e) => a + e.total, 0)
  const counts = Object.fromEntries(TABLES.map(t => [t, tables[t]!.length]))
  console.log(JSON.stringify({
    out, bytes: json.length, sessions: sessionCount, foodLogDays: dietDays.size, counts,
    rank: { ...rank, tier: rankLabelEn(rankForPoints(rank.points).tier), inSeasonEventPoints: inSeason },
    achievements: (tables.achievements as { id: string }[]).map(a => a.id),
    seasons: tables.seasons,
  }, null, 2))
  expect(sessionCount).toBeGreaterThanOrEqual(40)
  // What merge.ts mergeRankState recomputes the points to: carry-over + this season's events − current decay.
  const prev = (tables.seasons as { seasonId: number; finalPoints: number }[]).find(x => x.seasonId === rank.seasonId - 1)
  const carry = prev ? Math.round(prev.finalPoints * SEASON_CARRYOVER) : 0
  expect(rank.points).toBe(Math.max(0, Math.round(carry + inSeason - rank.idleDecayTaken)))

  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
}, 600_000)
