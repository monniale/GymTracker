import { db } from '../db/db'
import { addDays, mondayOf, parseLocalDate, localDateStr, MONTH_NAMES } from './dates'
import { computeWeeklyMuscleVolume, type MuscleVolumeRow } from './muscleVolume'
import { gatherWeekNutrition, type WeekNutrition } from './dietReport'
import { weeklyRate } from './bodyweight'
import { questsForWeek } from './quests'
import { isCardioSet, cardioSessionTotals, fmtCardioSet } from './cardio'
import { effectiveLoad, usesBodyweightLoad } from './load'
import { isAdjustment } from './pointsAdjust'
import type { BodyLogEntry, Id } from '../types'

/**
 * Weekly AI coach review: one Monday–Sunday week of training, eating and
 * bodyweight, summarised for the Progress › Week screen and the Gemini prompt.
 * Weeks are wall-clock (local midnight to local midnight), so a DST week is
 * 167 or 169 hours long — never `monday + 7 × 24 h`.
 */

/** Monday of the most recent week that is over (the week before `today`'s). */
export function lastFinishedMonday(today: string): string {
  return addDays(mondayOf(today), -7)
}

/** A week is over once its Sunday has passed. */
export function isWeekFinished(monday: string, today: string): boolean {
  return today >= addDays(monday, 7)
}

/** Local-midnight bounds of a week: [startMs, endMs), plus its Sunday. */
export function weekBounds(monday: string): { startMs: number; endMs: number; sunday: string } {
  return {
    startMs: parseLocalDate(monday).getTime(),
    endMs: parseLocalDate(addDays(monday, 7)).getTime(),
    sunday: addDays(monday, 6),
  }
}

/** "12–18 Oct", "28 Sep – 4 Oct", "29 Dec 2025 – 4 Jan 2026" (the year only when it changes or isn't `thisYear`). */
export function weekRangeLabel(monday: string, thisYear: string = localDateStr().slice(0, 4)): string {
  const a = parseLocalDate(monday)
  const b = parseLocalDate(addDays(monday, 6))
  const sameYear = a.getFullYear() === b.getFullYear()
  const showYear = !sameYear || String(b.getFullYear()) !== thisYear
  const yA = !sameYear ? ` ${a.getFullYear()}` : ''
  const yB = showYear ? ` ${b.getFullYear()}` : ''
  if (sameYear && a.getMonth() === b.getMonth()) return `${a.getDate()}–${b.getDate()} ${MONTH_NAMES[b.getMonth()]}${yB}`
  return `${a.getDate()} ${MONTH_NAMES[a.getMonth()]}${yA} – ${b.getDate()} ${MONTH_NAMES[b.getMonth()]}${yB}`
}

export interface WeekSessionSummary {
  id: Id
  name: string
  date: string
  durationMin: number
  points: number
  workingSets: number
  volumeKg: number
  exercises: { name: string; sets: number; best: string }[]
}

export interface WeekBriefing {
  monday: string
  sunday: string
  finished: boolean
  bodyweightKg: number
  weeklyTarget: number
  sessions: WeekSessionSummary[]
  /** Every score event dated in the week, quest bonuses included. */
  points: number
  questBonus: number
  prs: { exercise: string; kind: 'e1RM' | 'volume' }[]
  muscles: MuscleVolumeRow[]
  nutrition: WeekNutrition | null
  bodyweight: { weekMean: number | null; prevMean: number | null; ratePerWeek: number | null }
  /** `label` in the UI language (screen), `labelEn` for the English briefing sent to Gemini. */
  quests: { label: string; labelEn: string; done: boolean }[]
  /** Headlines of that week's stored workout/diet verdicts. */
  verdicts: { kind: 'workout' | 'diet'; date: string; headline: string }[]
}

const r1 = (v: number) => Math.round(v * 10) / 10

/**
 * A set for the English AI briefing: "80 kg × 8"; on a bodyweight exercise of a
 * stamped session the weight is added kg: "BW × 12", "BW+10 kg × 8", "BW-20 kg × 6".
 */
function briefingSet(s: { weightKg: number; reps: number }, bodyweightLoad: boolean): string {
  if (!bodyweightLoad) return `${s.weightKg} kg × ${s.reps}`
  if (s.weightKg === 0) return `BW × ${s.reps}`
  return `BW${s.weightKg > 0 ? '+' : '-'}${Math.abs(s.weightKg)} kg × ${s.reps}`
}

function mean(xs: number[]): number | null {
  return xs.length ? r1(xs.reduce((a, b) => a + b, 0) / xs.length) : null
}

/** Mean, week-over-week and 4-week trend of the weigh-ins, as of the week's Sunday. */
export function weekBodyweight(log: BodyLogEntry[], monday: string): WeekBriefing['bodyweight'] {
  const sunday = addDays(monday, 6)
  const prevMonday = addDays(monday, -7)
  return {
    weekMean: mean(log.filter(e => e.date >= monday && e.date <= sunday).map(e => e.weightKg)),
    prevMean: mean(log.filter(e => e.date >= prevMonday && e.date < monday).map(e => e.weightKg)),
    ratePerWeek: weeklyRate(log, sunday),
  }
}

/** Reads everything about one week in a few queries. Never evaluates quests (no awards from a read). */
export async function gatherWeekBriefing(monday: string, today: string = localDateStr()): Promise<WeekBriefing> {
  const { startMs, endMs, sunday } = weekBounds(monday)
  const start8w = parseLocalDate(addDays(monday, -49)).getTime()

  const [settings, sessionsRaw, events, exercises, bodyLog, questState, verdictRows] = await Promise.all([
    db.settings.get(1),
    db.sessions.where('startedAt').between(startMs, endMs, true, false).toArray(),
    db.scoreEvents.where('date').between(monday, sunday, true, true).toArray(),
    db.exercises.toArray(),
    db.bodyLog.orderBy('date').toArray(),
    db.quests.get(monday),
    db.coachHistory.where('date').between(monday, sunday, true, true).toArray(),
  ])
  const sessions = sessionsRaw.filter(s => s.endedAt !== undefined).sort((a, b) => a.startedAt - b.startedAt)
  const exMap = new Map(exercises.map(e => [e.id!, e]))
  const ids = sessions.map(s => s.id!)
  const sets = ids.length ? await db.sets.where('sessionId').anyOf(ids).toArray() : []
  // Muscle volume as of the week's end: the 8 weeks up to it, nothing after.
  const volumeSets = await db.sets
    .filter(s => !s.isWarmup && s.completedAt >= start8w && s.completedAt < endMs)
    .toArray()
  const eventBySession = new Map<string, (typeof events)[number]>()
  for (const e of events) if (e.sessionId !== undefined) eventBySession.set(String(e.sessionId), e)

  const summaries: WeekSessionSummary[] = sessions.map(s => {
    const mine = sets.filter(x => String(x.sessionId) === String(s.id) && !x.isWarmup)
    const byEx = new Map<Id, typeof mine>()
    for (const x of mine) byEx.set(x.exerciseId, [...(byEx.get(x.exerciseId) ?? []), x])
    const exList = [...byEx.entries()].map(([exId, xs]) => {
      const name = exMap.get(exId)?.name ?? 'Exercise'
      if (xs.every(isCardioSet)) return { name, sets: xs.length, best: `${fmtCardioSet(cardioSessionTotals(xs))} cardio` }
      const top = xs.filter(x => !isCardioSet(x)).reduce((a, b) => (b.e1rm > a.e1rm ? b : a))
      return { name, sets: xs.length, best: briefingSet(top, usesBodyweightLoad(exMap.get(exId), s)) }
    })
    return {
      id: s.id!,
      name: s.name,
      date: localDateStr(new Date(s.startedAt)),
      durationMin: Math.round(((s.endedAt ?? s.startedAt) - s.startedAt) / 60_000),
      points: eventBySession.get(String(s.id))?.total ?? 0,
      workingSets: mine.filter(x => !isCardioSet(x)).length,
      volumeKg: Math.round(mine.reduce((a, x) => a + effectiveLoad(x, exMap.get(x.exerciseId), s) * x.reps, 0)),
      exercises: exList,
    }
  })

  const prs: WeekBriefing['prs'] = []
  for (const s of sessions) {
    for (const b of eventBySession.get(String(s.id))?.breakdown ?? []) {
      if (b.e1rmPr) prs.push({ exercise: b.exerciseName, kind: 'e1RM' })
      if (b.volumePr) prs.push({ exercise: b.exerciseName, kind: 'volume' })
    }
  }

  const done = new Map((questState?.quests ?? []).map(q => [q.id, q.done]))
  return {
    monday,
    sunday,
    finished: isWeekFinished(monday, today),
    bodyweightKg: settings?.bodyweightKg ?? 0,
    weeklyTarget: settings?.weeklySessionTarget ?? 3,
    sessions: summaries,
    points: Math.round(events.filter(e => !isAdjustment(e)).reduce((a, e) => a + e.total, 0)),
    questBonus: Math.round(events.filter(e => e.sessionId === undefined && !isAdjustment(e)).reduce((a, e) => a + e.total, 0)),
    prs,
    muscles: computeWeeklyMuscleVolume(volumeSets, exMap, sunday),
    nutrition: await gatherWeekNutrition(sunday),
    bodyweight: weekBodyweight(bodyLog, monday),
    quests: questsForWeek(monday).map(d => ({ label: d.label, labelEn: d.labelEn, done: done.get(d.id) ?? false })),
    verdicts: verdictRows
      .filter((v): v is typeof v & { kind: 'workout' | 'diet' } => v.kind === 'workout' || v.kind === 'diet')
      .sort((a, b) => a.date.localeCompare(b.date) || a.generatedAt - b.generatedAt)
      .map(v => ({ kind: v.kind, date: v.date, headline: v.note.headline })),
  }
}

const CAP = { sessions: 10, exercises: 8, prs: 8, muscles: 12, verdicts: 8 }
export const WEEK_BRIEFING_MAX_CHARS = 4000

/**
 * Plain-text prompt for the weekly coach, under 4 000 characters. A long week
 * lists fewer exercises per session first, so nutrition and bodyweight always
 * make it in.
 */
export function formatWeekBriefing(b: WeekBriefing): string {
  let text = ''
  for (const exCap of [CAP.exercises, 4, 2, 0]) {
    text = renderWeekBriefing(b, exCap)
    if (text.length <= WEEK_BRIEFING_MAX_CHARS) return text
  }
  // Still too long (very long names): cut the training detail, never the closing instruction.
  const lines = text.split('\n')
  const tail = lines.slice(-2).join('\n')
  return `${text.slice(0, WEEK_BRIEFING_MAX_CHARS - tail.length - 4).trimEnd()}\n…\n${tail}`
}

function renderWeekBriefing(b: WeekBriefing, exCap: number): string {
  const lines: string[] = []
  lines.push(`Week: Monday ${b.monday} to Sunday ${b.sunday}${b.finished ? '' : ' (still in progress)'}`)
  lines.push(`Bodyweight: ${b.bodyweightKg} kg. Weekly session target: ${b.weeklyTarget}.`)
  lines.push('')
  lines.push(`Training: ${b.sessions.length} session${b.sessions.length === 1 ? '' : 's'}, ${b.points} rank points (${b.questBonus} from quests)`)
  for (const s of b.sessions.slice(0, CAP.sessions)) {
    lines.push(`- ${s.date} ${s.name}: ${s.durationMin} min, ${s.workingSets} working sets, ${s.volumeKg} kg volume, +${s.points} pts`)
    for (const e of s.exercises.slice(0, exCap)) lines.push(`  · ${e.name}: ${e.sets} sets, best ${e.best}`)
    if (s.exercises.length > exCap) lines.push(`  · …and ${s.exercises.length - exCap} more exercises`)
  }
  if (b.sessions.length > CAP.sessions) lines.push(`- …and ${b.sessions.length - CAP.sessions} more sessions`)
  lines.push(`PRs: ${b.prs.length === 0 ? 'none' : b.prs.slice(0, CAP.prs).map(p => `${p.exercise} (${p.kind})`).join(', ')}`)
  if (b.muscles.length > 0) {
    lines.push('Hard sets per muscle this week (8-week average in brackets; 10–20 is the hypertrophy range):')
    lines.push(b.muscles.slice(0, CAP.muscles).map(m => `${m.group} ${m.sets} (${m.weeklyAvg})`).join(', '))
  }
  lines.push('')
  const n = b.nutrition
  if (n && n.loggedDays > 0) {
    lines.push(`Nutrition: logged ${n.loggedDays}/7 days, ${n.trainingDays} training days`)
    lines.push(`- Averages: ${n.avgKcal} kcal, ${n.avgProtein} g protein (${n.proteinPerKg} g/kg), ${n.avgCarbs} g carbs, ${n.avgFat} g fat`)
    lines.push(`- On-target days (±10% kcal): ${n.adherent}/${n.loggedDays}`)
  } else {
    lines.push('Nutrition: no food logged this week')
  }
  const bw = b.bodyweight
  const bwParts = [
    bw.weekMean !== null ? `mean ${bw.weekMean} kg` : 'no weigh-ins',
    bw.prevMean !== null ? `previous week ${bw.prevMean} kg` : null,
    bw.ratePerWeek !== null ? `4-week trend ${bw.ratePerWeek > 0 ? '+' : ''}${bw.ratePerWeek} kg/week` : null,
  ].filter(Boolean)
  lines.push(`Bodyweight: ${bwParts.join(', ')}`)
  if (b.quests.length > 0) lines.push(`Weekly quests: ${b.quests.map(q => `${q.labelEn} (${q.done ? 'done' : 'not done'})`).join('; ')}`)
  if (b.verdicts.length > 0) {
    lines.push('Earlier coach verdicts this week:')
    for (const v of b.verdicts.slice(0, CAP.verdicts)) lines.push(`- ${v.date} ${v.kind}: ${v.headline}`)
  }
  lines.push('')
  lines.push("Review THIS WEEK as a whole, then give NEXT WEEK's focus (2–3 concrete actions).")
  return lines.join('\n')
}

/** Headline numbers for the Week screen's stats grid. */
export function weekStats(b: WeekBriefing) {
  const n = b.nutrition
  return {
    sessions: b.sessions.length,
    points: b.points,
    prs: b.prs.length,
    proteinPerKg: n && n.loggedDays > 0 ? n.proteinPerKg : null,
    loggedDays: n?.loggedDays ?? 0,
    bwRate: b.bodyweight.ratePerWeek,
  }
}
