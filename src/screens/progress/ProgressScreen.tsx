import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronDown, ChevronRight, Scale, Trophy, Plus, Sparkles, CalendarDays, CalendarRange } from 'lucide-react'
import { db } from '../../db/db'
import { useAiStore } from '../../lib/aiStore'
import { localDateStr, addDays, MONTH_NAMES } from '../../lib/dates'
import { gatherRepMaxes, REP_BUCKETS, type RepMax } from '../../lib/repMax'
import { useLocalToday } from '../../lib/hooks'
import { trainingHeatmap } from '../../lib/heatmap'
import Heatmap from '../../components/Heatmap'
import { LineChart, BarChart, BandBars, Sparkline, type ChartPoint } from '../../components/Charts'
import { standardFor, levelFor } from '../../lib/standards'
import { gatherWeeklyMuscleVolume, HYPERTROPHY_SET_BAND } from '../../lib/muscleVolume'
import ExercisePicker from '../workout/ExercisePicker'
import Sheet from '../../components/Sheet'
import NumberStepper from '../../components/NumberStepper'
import type { Exercise, Id } from '../../types'

const ORANGE = '#F97316'
const GREEN = '#22C55E'

function shortDate(ms: number): string {
  const d = new Date(ms)
  return `${d.getDate()}/${d.getMonth() + 1}`
}

export default function ProgressScreen() {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [exerciseId, setExerciseId] = useState<Id | null>(null)

  const exercises = useLiveQuery(() => db.exercises.toArray()) ?? []
  const exMap = useMemo(() => new Map(exercises.map(e => [e.id!, e])), [exercises])

  // Default to the most recently trained exercise.
  const defaultExId = useLiveQuery(async () => {
    // Last set of the newest session that has one (invariant 10: UUID set ids don't sort by time).
    for (const session of await db.sessions.orderBy('startedAt').reverse().limit(5).toArray()) {
      const sets = await db.sets.where('sessionId').equals(session.id!).toArray()
      if (sets.length > 0) return sets.reduce((a, b) => (b.completedAt > a.completedAt ? b : a)).exerciseId
    }
    return null
  })
  const activeExId = exerciseId ?? defaultExId ?? null
  const activeEx = activeExId ? exMap.get(activeExId) : undefined

  return (
    <div className="pt-4">
      <h1 className="mb-4 font-display text-3xl font-bold">Progress</h1>

      <BodyweightTile />
      <CoachHistoryTile />
      <WeekReviewTile />
      <TrainingHeatmapTile />

      <section className="mt-4 rounded-2xl border border-edge bg-card p-4">
        <button
          onClick={() => setPickerOpen(true)}
          className="mb-2 flex w-full items-center justify-between"
          aria-label="Choose exercise"
        >
          <h2 className="font-display text-xl font-semibold">{activeEx?.name ?? 'Pick an exercise'}</h2>
          <ChevronDown size={18} className="text-sub" />
        </button>
        {activeExId ? (
          <>
            <ExerciseTrend exerciseId={activeExId} />
            {activeEx?.muscleGroup !== 'cardio' && <RepMaxTable exerciseId={activeExId} />}
          </>
        ) : (
          <p className="py-6 text-center text-sm text-sub">Log a workout to see trends.</p>
        )}
      </section>

      <WeeklyMuscleVolume exMap={exMap} />
      <PrWall exMap={exMap} />

      <ExercisePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(e: Exercise) => setExerciseId(e.id!)}
      />
    </div>
  )
}

function ExerciseTrend({ exerciseId }: { exerciseId: Id }) {
  const data = useLiveQuery(async () => {
    const sets = await db.sets
      .where('exerciseId').equals(exerciseId)
      .filter(s => !s.isWarmup)
      .toArray()
    if (sets.length === 0) return { e1rm: [], volume: [] }
    const bySession = new Map<Id, { best: number; volume: number; t: number }>()
    for (const s of sets) {
      const cur = bySession.get(s.sessionId) ?? { best: 0, volume: 0, t: s.completedAt }
      cur.best = Math.max(cur.best, s.e1rm)
      cur.volume += s.weightKg * s.reps
      cur.t = Math.min(cur.t, s.completedAt)
      bySession.set(s.sessionId, cur)
    }
    const rows = [...bySession.values()].sort((a, b) => a.t - b.t).slice(-20)
    return {
      e1rm: rows.map(r => ({ x: r.t, y: r.best, label: shortDate(r.t) })) as ChartPoint[],
      volume: rows.map(r => ({ x: r.t, y: r.volume, label: shortDate(r.t) })) as ChartPoint[],
    }
  }, [exerciseId])

  if (!data) return null
  if (data.e1rm.length === 0) {
    return <p className="py-6 text-center text-sm text-sub">No sets logged for this exercise yet.</p>
  }
  return (
    <>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-sub">Estimated 1RM (kg)</p>
      <LineChart points={data.e1rm} color={ORANGE} />
      <p className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-sub">Session volume (kg)</p>
      <BarChart points={data.volume} color={ORANGE} yFmt={v => `${Math.round(v)} kg`} />
    </>
  )
}

function dayMonth(ms: number): string {
  const d = new Date(ms)
  return `${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`
}

function RepMaxCell({ rec, highlight }: { rec?: RepMax; highlight?: boolean }) {
  if (!rec) return <span className="num min-w-0 flex-1 text-sm text-sub">—</span>
  return (
    <span className="num min-w-0 flex-1 leading-tight">
      <span className={`block truncate text-sm font-semibold ${highlight ? 'text-primary' : ''}`}>
        {rec.weightKg} kg ×{rec.reps}
      </span>
      <span className="block truncate text-[11px] text-sub">{dayMonth(rec.completedAt)}</span>
    </span>
  )
}

/** Heaviest working set for at least N reps, all-time and this season. */
function RepMaxTable({ exerciseId }: { exerciseId: Id }) {
  const maxes = useLiveQuery(() => gatherRepMaxes(exerciseId), [exerciseId])
  if (!maxes || maxes.allTime.size === 0) return null
  const rows = REP_BUCKETS.filter(n => maxes.allTime.has(n))
  return (
    <div className="mt-3">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-sub">Rep maxes</p>
      <div className="flex items-center gap-2 border-b border-edge pb-1 text-[11px] font-semibold uppercase tracking-wide text-sub">
        <span className="w-9 shrink-0">RM</span>
        <span className="min-w-0 flex-1 truncate">All-time</span>
        <span className="min-w-0 flex-1 truncate">This season</span>
      </div>
      {rows.map(n => {
        const best = maxes.allTime.get(n)!
        const season = maxes.season.get(n)
        const same = season !== undefined && season.weightKg === best.weightKg && season.reps === best.reps && season.completedAt === best.completedAt
        return (
          <div key={n} className="flex items-center gap-2 border-b border-edge/60 py-1.5 last:border-b-0">
            <span className="num w-9 shrink-0 font-display text-base font-bold">{n}RM</span>
            <RepMaxCell rec={best} />
            <RepMaxCell rec={season} highlight={same} />
          </div>
        )
      })}
      <p className="mt-1 text-[11px] text-sub">Best weight for at least N reps. Orange = the all-time best was set this season.</p>
    </div>
  )
}

function WeeklyMuscleVolume({ exMap }: { exMap: Map<Id, Exercise> }) {
  const rows = useLiveQuery(() => gatherWeeklyMuscleVolume(exMap), [exMap])

  if (!rows || rows.length === 0) return null
  return (
    <section className="mt-4 rounded-2xl border border-edge bg-card p-4">
      <h2 className="font-display text-xl font-semibold">Weekly sets per muscle</h2>
      <p className="mb-3 text-xs text-sub">
        This week's hard sets. Shaded band = the evidence-backed 10–20 range; tick = your 8-week average.
      </p>
      <BandBars
        rows={rows.map(r => ({ label: r.group, value: r.sets, marker: r.weeklyAvg }))}
        band={HYPERTROPHY_SET_BAND}
        color={ORANGE}
      />
    </section>
  )
}

function BodyweightTile() {
  const [logOpen, setLogOpen] = useState(false)
  const settings = useLiveQuery(() => db.settings.get(1))
  const log = useLiveQuery(() => db.bodyLog.orderBy('date').toArray()) ?? []
  const [draft, setDraft] = useState<number | null>(null)

  const current = log.length > 0 ? log[log.length - 1].weightKg : settings?.bodyweightKg
  const monthAgo = addDays(localDateStr(), -30)
  const past = log.filter(l => l.date <= monthAgo)
  const delta = past.length > 0 && current !== undefined
    ? Math.round((current - past[past.length - 1].weightKg) * 10) / 10
    : null

  async function save() {
    const w = Math.round((draft ?? current ?? 75) * 10) / 10
    await db.bodyLog.put({ date: localDateStr(), weightKg: w })
    await db.settings.update(1, { bodyweightKg: w })
    setLogOpen(false)
  }

  return (
    <div className="rounded-2xl border border-edge bg-card p-4">
      {/* Caption on its own row, so the value, sparkline and + share the full width. */}
      <Link to="/progress/bodyweight" className="mb-1 flex items-center gap-1.5 text-xs text-sub">
        <Scale size={14} className="shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate">Bodyweight (feeds your rank score)</span>
        <span className="flex shrink-0 items-center whitespace-nowrap font-semibold text-primary">
          History <ChevronRight size={14} aria-hidden />
        </span>
      </Link>
      <div className="flex items-center gap-3">
        <Link to="/progress/bodyweight" aria-label="Bodyweight history" className="flex min-w-0 flex-1 items-center gap-3">
          <p className="num flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 font-display text-2xl font-bold">
            <span className="whitespace-nowrap">{current !== undefined ? `${current} kg` : '—'}</span>
            {delta !== null && (
              <span className={`whitespace-nowrap text-sm font-semibold ${delta <= 0 ? 'text-accent' : 'text-sub'}`}>
                {delta > 0 ? '+' : ''}{delta} / 30d
              </span>
            )}
          </p>
          <Sparkline values={log.slice(-30).map(l => l.weightKg)} color={GREEN} />
        </Link>
        <button
          onClick={() => {
            setDraft(current ?? 75)
            setLogOpen(true)
          }}
          aria-label="Log bodyweight"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary active:bg-primary/30"
        >
          <Plus size={18} />
        </button>
      </div>

      <Sheet open={logOpen} onClose={() => setLogOpen(false)} title="Log bodyweight">
        <div className="flex justify-center">
          <NumberStepper
            label="Today"
            value={draft ?? current ?? 75}
            onChange={setDraft}
            step={0.1}
            min={30}
            max={300}
            unit="kg"
          />
        </div>
        <button
          onClick={save}
          className="mt-4 w-full rounded-2xl bg-primary py-3.5 font-display text-lg font-bold text-bg active:opacity-90"
        >
          Save
        </button>
      </Sheet>
    </div>
  )
}

/** Entry to the stored AI coach verdicts; hidden until there is one or a key to make one. */
function CoachHistoryTile() {
  const apiKey = useAiStore(s => s.apiKey)
  const stats = useLiveQuery(async () => ({
    count: await db.coachHistory.count(),
    last: await db.coachHistory.orderBy('generatedAt').last(),
  }))
  if (!stats || (stats.count === 0 && !apiKey)) return null
  return (
    <Link
      to="/progress/coach"
      className="mt-4 flex items-center gap-3 rounded-2xl border border-edge bg-card p-4 active:bg-muted/30"
    >
      <Sparkles size={18} className="shrink-0 text-primary" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-display text-lg font-semibold">Coach history</p>
        <p className="truncate text-xs text-sub">
          {stats.count === 0
            ? 'Every coach’s note and diet report is kept here'
            : `${stats.count} verdict${stats.count === 1 ? '' : 's'} · ${stats.last?.note.headline ?? ''}`}
        </p>
      </div>
      <ChevronRight size={18} className="shrink-0 text-sub" aria-hidden />
    </Link>
  )
}

/** Entry to the weekly review; hidden until there is a stored review or a key to make one. */
function WeekReviewTile() {
  const apiKey = useAiStore(s => s.apiKey)
  const latest = useLiveQuery(async () => {
    const weeks = await db.coachHistory.where('date').above('').filter(j => j.kind === 'week').toArray()
    return weeks.reduce<(typeof weeks)[number] | null>((a, j) => (!a || j.date > a.date || (j.date === a.date && j.generatedAt > a.generatedAt) ? j : a), null)
  })
  if (latest === undefined || (!latest && !apiKey)) return null
  return (
    <Link
      to="/progress/week"
      className="mt-4 flex items-center gap-3 rounded-2xl border border-edge bg-card p-4 active:bg-muted/30"
    >
      <CalendarRange size={18} className="shrink-0 text-primary" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-display text-lg font-semibold">Week review</p>
        <p className="truncate text-xs text-sub">{latest ? latest.note.headline : 'Review last week with the coach'}</p>
      </div>
      <ChevronRight size={18} className="shrink-0 text-sub" aria-hidden />
    </Link>
  )
}

const HEATMAP_WEEKS = 26

/** Consistency grid of the last 26 weeks (finished workouts per day). */
function TrainingHeatmapTile() {
  const today = useLocalToday()
  const sessions = useLiveQuery(() => db.sessions.orderBy('startedAt').toArray())
  const heat = useMemo(
    () => (sessions ? trainingHeatmap(sessions, today, { weeks: HEATMAP_WEEKS }) : null),
    [sessions, today],
  )
  if (!heat) return null
  return (
    <section className="mt-4 rounded-2xl border border-edge bg-card p-4">
      <Link to="/workout/history" className="mb-2 flex items-center gap-1.5 text-xs text-sub">
        <CalendarDays size={14} className="shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate">Consistency · last {HEATMAP_WEEKS} weeks</span>
        <span className="flex shrink-0 items-center whitespace-nowrap font-semibold text-primary">
          History <ChevronRight size={14} aria-hidden />
        </span>
      </Link>
      <Heatmap data={heat} today={today} />
      <p className="num mt-2 flex flex-wrap gap-x-1.5 text-xs text-sub">
        <span className="whitespace-nowrap">
          <span className="font-semibold text-ink">{heat.daysThisYear}</span> day{heat.daysThisYear === 1 ? '' : 's'} this year
        </span>
        <span aria-hidden>·</span>
        <span className="whitespace-nowrap">
          longest run <span className="font-semibold text-ink">{heat.longestRunWeeks}</span> week{heat.longestRunWeeks === 1 ? '' : 's'}
        </span>
      </p>
    </section>
  )
}

function PrWall({ exMap }: { exMap: Map<Id, Exercise> }) {
  const settings = useLiveQuery(() => db.settings.get(1))
  const prs = useLiveQuery(async () => {
    const sets = await db.sets.filter(s => !s.isWarmup && s.weightKg > 0).toArray()
    const byEx = new Map<Id, { e1rm: number; weight: number; reps: number; date: number }>()
    for (const s of sets) {
      const cur = byEx.get(s.exerciseId)
      if (!cur || s.e1rm > cur.e1rm) {
        byEx.set(s.exerciseId, { e1rm: s.e1rm, weight: s.weightKg, reps: s.reps, date: s.completedAt })
      }
    }
    return [...byEx.entries()]
      .sort((a, b) => b[1].e1rm - a[1].e1rm)
      .slice(0, 12)
  }, [])

  if (!prs || prs.length === 0) return null
  return (
    <section className="mt-4 pb-4">
      <h2 className="mb-2 flex items-center gap-2 font-display text-xl font-semibold">
        <Trophy size={18} className="text-primary" /> PR wall
      </h2>
      <div className="grid grid-cols-2 gap-2">
        {prs.map(([exId, pr]) => {
          const ex = exMap.get(exId)
          const std = ex ? standardFor(ex.nameLower) : null
          const level = std && settings ? levelFor(pr.e1rm, settings.bodyweightKg, std) : null
          return (
            <div key={exId} className="rounded-xl border border-edge bg-card p-3">
              <p className="truncate text-sm font-medium">{ex?.name ?? '…'}</p>
              <p className="num font-display text-2xl font-bold text-primary">
                {Math.round(pr.e1rm * 10) / 10}
                <span className="text-sm font-medium text-sub"> e1RM</span>
              </p>
              <p className="num text-xs text-sub">
                {pr.weight} kg × {pr.reps} · {shortDate(pr.date)}
              </p>
              {level && (
                <div className="mt-1.5">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                      level.index >= 4
                        ? 'bg-primary/20 text-primary'
                        : level.index >= 2
                          ? 'bg-accent/15 text-accent'
                          : 'bg-muted/40 text-sub'
                    }`}
                  >
                    {level.level}
                  </span>
                  {level.next && (
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted/30">
                      <div
                        className="h-full rounded-full bg-sub/60"
                        style={{ width: `${level.progress * 100}%` }}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
