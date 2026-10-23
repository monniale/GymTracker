import { useEffect, useMemo, useRef, useState } from 'react'
import { muscleGroupLabel } from '../../lib/equipment'
import { Link, useLocation } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronDown, ChevronRight, Scale, Trophy, Plus, Sparkles, CalendarDays, CalendarRange } from 'lucide-react'
import { db } from '../../db/db'
import { useAiStore } from '../../lib/aiStore'
import { localDateStr, addDays, MONTH_NAMES, fmtDuration } from '../../lib/dates'
import { gatherRepMaxes, REP_BUCKETS, type RepMax } from '../../lib/repMax'
import { isCardioExercise, isCardioSet, paceSecPerKm } from '../../lib/cardio'
import { useLocalToday } from '../../lib/hooks'
import { trainingHeatmap } from '../../lib/heatmap'
import Heatmap from '../../components/Heatmap'
import MuscleHeatmap from '../../components/MuscleHeatmap'
import { computeMuscleHeat, gatherMuscleHeatSets, MUSCLE_HEAT_WEEKS } from '../../lib/muscleHeat'
import { useExerciseLibrary } from '../../lib/exerciseLibrary'
import { LineChart, BarChart, BandBars, Sparkline, type ChartPoint } from '../../components/Charts'
import { standardFor, levelFor, levelLabel } from '../../lib/standards'
import { gatherWeeklyMuscleVolume, HYPERTROPHY_SET_BAND } from '../../lib/muscleVolume'
import ExercisePicker from '../workout/ExercisePicker'
import Sheet from '../../components/Sheet'
import NumberStepper from '../../components/NumberStepper'
import { exerciseDisplayName } from '../../lib/exerciseNames'
import { fmtSetLoad, usesBodyweightLoad, withLoads } from '../../lib/load'
import { t, tp, fmtNum, type PluralMessageKey } from '../../i18n'
import type { Exercise, Id, Session } from '../../types'

const ORANGE = '#F97316'
const GREEN = '#22C55E'

function shortDate(ms: number): string {
  const d = new Date(ms)
  return `${d.getDate()}/${d.getMonth() + 1}`
}

/** A counted message with its number emphasized ("**12** days this year"). */
function CountText({ msgKey, n }: { msgKey: PluralMessageKey; n: number }) {
  const [before, after = ''] = tp(msgKey, n, { n: '{n}' }).split('{n}')
  return (
    <>
      {before}
      <span className="font-semibold text-ink">{fmtNum(n)}</span>
      {after}
    </>
  )
}

/** The exercise a link opened the screen on (Exercise history › Chart), if it is a valid id. */
function seededExerciseId(state: unknown): Id | null {
  const id = (state as { exerciseId?: unknown } | null)?.exerciseId
  return (typeof id === 'number' && Number.isFinite(id)) || (typeof id === 'string' && id.length > 0) ? id : null
}

export default function ProgressScreen() {
  const [pickerOpen, setPickerOpen] = useState(false)
  const seeded = seededExerciseId(useLocation().state)
  const [exerciseId, setExerciseId] = useState<Id | null>(seeded)
  const screen = useRef<HTMLDivElement>(null)
  const exerciseSection = useRef<HTMLElement>(null)
  // Opened on an exercise: bring its charts into view instead of the tiles at the top. The tiles
  // above it load one by one and push it down, so keep it aligned for a moment, until the user scrolls.
  const seededOnMount = useRef(seeded)
  useEffect(() => {
    const el = exerciseSection.current
    if (seededOnMount.current === null || !el) return
    const align = () => el.scrollIntoView({ block: 'start' })
    align()
    if (typeof ResizeObserver === 'undefined' || !screen.current) return
    const ro = new ResizeObserver(align)
    ro.observe(screen.current)
    const stop = () => ro.disconnect()
    const timer = setTimeout(stop, 1500)
    window.addEventListener('touchstart', stop, { once: true, passive: true })
    window.addEventListener('wheel', stop, { once: true, passive: true })
    return () => {
      stop()
      clearTimeout(timer)
      window.removeEventListener('touchstart', stop)
      window.removeEventListener('wheel', stop)
    }
  }, [])

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
    <div ref={screen} className="pt-4">
      <h1 className="mb-4 font-display text-3xl font-bold">{t('progress.screen.title')}</h1>

      <BodyweightTile />
      <CoachHistoryTile />
      <WeekReviewTile />
      <TrainingHeatmapTile />
      <MuscleHeatTile exMap={exMap} />

      <section ref={exerciseSection} className="mt-4 scroll-mt-4 rounded-2xl border border-edge bg-card p-4">
        <div className="mb-2 flex items-center gap-2">
          <button
            onClick={() => setPickerOpen(true)}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
            aria-label={t('progress.screen.chooseExercise')}
          >
            <h2 className="min-w-0 truncate font-display text-xl font-semibold">{activeEx ? exerciseDisplayName(activeEx.name) : t('progress.screen.pickExercise')}</h2>
            <ChevronDown size={18} className="shrink-0 text-sub" />
          </button>
          {activeExId && (
            <Link
              to={`/progress/exercise/${activeExId}`}
              aria-label={t('progress.exercise.historyLink')}
              className="flex min-h-[44px] shrink-0 items-center whitespace-nowrap px-1 text-sm font-semibold text-primary"
            >
              {t('common.history')} <ChevronRight size={16} aria-hidden />
            </Link>
          )}
        </div>
        {activeExId ? (
          <>
            {isCardioExercise(activeEx)
              ? <CardioTrend exerciseId={activeExId} />
              : <ExerciseTrend exerciseId={activeExId} />}
            {!isCardioExercise(activeEx) && <RepMaxTable exerciseId={activeExId} />}
          </>
        ) : (
          <p className="py-6 text-center text-sm text-sub">{t('progress.screen.noTrends')}</p>
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
      .filter(s => !s.isWarmup && !isCardioSet(s))
      .toArray()
    if (sets.length === 0) return { e1rm: [], volume: [] }
    // Effective load (bodyweight sets of stamped sessions count the bodyweight moved).
    const ex = await db.exercises.get(exerciseId)
    const sessionIds = [...new Set(sets.map(s => s.sessionId))]
    const sessions = await db.sessions.bulkGet(sessionIds)
    const sessionsById = new Map<Id, Session>()
    sessions.forEach((row, i) => { if (row) sessionsById.set(sessionIds[i], row) })
    const loaded = withLoads(sets, new Map<Id, Exercise>(ex ? [[exerciseId, ex]] : []), sessionsById)
    const bySession = new Map<Id, { best: number; volume: number; t: number }>()
    for (const s of loaded) {
      const cur = bySession.get(s.sessionId) ?? { best: 0, volume: 0, t: s.completedAt }
      cur.best = Math.max(cur.best, s.e1rm)
      cur.volume += s.loadKg * s.reps
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
    return <p className="py-6 text-center text-sm text-sub">{t('progress.trend.noSets')}</p>
  }
  return (
    <>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-sub">{t('progress.trend.e1rm')}</p>
      <LineChart points={data.e1rm} color={ORANGE} />
      <p className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-sub">{t('progress.trend.volume')}</p>
      <BarChart points={data.volume} color={ORANGE} yFmt={v => `${Math.round(v)} kg`} />
    </>
  )
}

/** Cardio exercise: time and distance per session, and the pace when a distance was logged. */
function CardioTrend({ exerciseId }: { exerciseId: Id }) {
  const data = useLiveQuery(async () => {
    const sets = await db.sets.where('exerciseId').equals(exerciseId).filter(isCardioSet).toArray()
    const bySession = new Map<Id, { sec: number; m: number; t: number }>()
    for (const s of sets) {
      const cur = bySession.get(s.sessionId) ?? { sec: 0, m: 0, t: s.completedAt }
      cur.sec += s.durationSec ?? 0
      cur.m += s.distanceM ?? 0
      cur.t = Math.min(cur.t, s.completedAt)
      bySession.set(s.sessionId, cur)
    }
    const rows = [...bySession.values()].sort((a, b) => a.t - b.t).slice(-20)
    return {
      minutes: rows.map(r => ({ x: r.t, y: r.sec / 60, label: shortDate(r.t) })) as ChartPoint[],
      km: rows.filter(r => r.m > 0).map(r => ({ x: r.t, y: r.m / 1000, label: shortDate(r.t) })) as ChartPoint[],
      pace: rows
        .map(r => ({ r, pace: paceSecPerKm(r.sec, r.m) }))
        .filter((p): p is { r: typeof p.r; pace: number } => p.pace !== null)
        .map(({ r, pace }) => ({ x: r.t, y: pace, label: shortDate(r.t) })) as ChartPoint[],
    }
  }, [exerciseId])

  if (!data) return null
  if (data.minutes.length === 0) {
    return <p className="py-6 text-center text-sm text-sub">{t('progress.cardio.noData')}</p>
  }
  return (
    <>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-sub">{t('progress.cardio.duration')}</p>
      <LineChart points={data.minutes} color={GREEN} yFmt={v => `${Math.round(v)} min`} />
      {data.km.length > 0 && (
        <>
          <p className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-sub">{t('progress.cardio.distance')}</p>
          <BarChart points={data.km} color={GREEN} yFmt={v => `${fmtNum(v, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`} />
        </>
      )}
      {data.pace.length > 1 && (
        <>
          <p className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-sub">{t('progress.cardio.pace')}</p>
          <LineChart points={data.pace} color={ORANGE} yFmt={v => fmtDuration(Math.round(v) * 1000)} />
        </>
      )}
      <p className="mt-2 text-[11px] text-sub">{t('progress.cardio.note')}</p>
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
        {fmtSetLoad(rec, rec.bodyweightLoad)}
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
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-sub">{t('progress.repMax.title')}</p>
      <div className="flex items-center gap-2 border-b border-edge pb-1 text-[11px] font-semibold uppercase tracking-wide text-sub">
        <span className="w-9 shrink-0">RM</span>
        <span className="min-w-0 flex-1 truncate">{t('progress.repMax.allTime')}</span>
        <span className="min-w-0 flex-1 truncate">{t('progress.repMax.thisSeason')}</span>
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
      <p className="mt-1 text-[11px] text-sub">{t('progress.repMax.note')}</p>
    </div>
  )
}

function WeeklyMuscleVolume({ exMap }: { exMap: Map<Id, Exercise> }) {
  const rows = useLiveQuery(() => gatherWeeklyMuscleVolume(exMap), [exMap])

  if (!rows || rows.length === 0) return null
  return (
    <section className="mt-4 rounded-2xl border border-edge bg-card p-4">
      <h2 className="font-display text-xl font-semibold">{t('progress.muscleVolume.title')}</h2>
      <p className="mb-3 text-xs text-sub">
        {t('progress.muscleVolume.note', { min: HYPERTROPHY_SET_BAND[0], max: HYPERTROPHY_SET_BAND[1] })}
      </p>
      <BandBars
        rows={rows.map(r => ({ label: muscleGroupLabel(r.group), value: r.sets, marker: r.weeklyAvg }))}
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
        <span className="min-w-0 flex-1 truncate">{t('progress.bodyweightTile.caption')}</span>
        <span className="flex shrink-0 items-center whitespace-nowrap font-semibold text-primary">
          {t('common.history')} <ChevronRight size={14} aria-hidden />
        </span>
      </Link>
      <div className="flex items-center gap-3">
        <Link to="/progress/bodyweight" aria-label={t('progress.bodyweightTile.historyAria')} className="flex min-w-0 flex-1 items-center gap-3">
          <p className="num flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 font-display text-2xl font-bold">
            <span className="whitespace-nowrap">{current !== undefined ? `${fmtNum(current)} kg` : '—'}</span>
            {delta !== null && (
              <span className={`whitespace-nowrap text-sm font-semibold ${delta <= 0 ? 'text-accent' : 'text-sub'}`}>
                {t('progress.bodyweightTile.delta30', { delta: `${delta > 0 ? '+' : ''}${fmtNum(delta)}` })}
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
          aria-label={t('progress.bodyweightTile.log')}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary active:bg-primary/30"
        >
          <Plus size={18} />
        </button>
      </div>

      <Sheet open={logOpen} onClose={() => setLogOpen(false)} title={t('progress.bodyweightTile.log')}>
        <div className="flex justify-center">
          <NumberStepper
            label={t('common.today')}
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
          {t('common.save')}
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
        <p className="font-display text-lg font-semibold">{t('progress.coachTile.title')}</p>
        <p className="truncate text-xs text-sub">
          {stats.count === 0
            ? t('progress.coachTile.empty')
            : tp('progress.coachTile.summary', stats.count, { headline: stats.last?.note.headline ?? '' })}
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
        <p className="font-display text-lg font-semibold">{t('progress.weekTile.title')}</p>
        <p className="truncate text-xs text-sub">{latest ? latest.note.headline : t('progress.weekTile.empty')}</p>
      </div>
      <ChevronRight size={18} className="shrink-0 text-sub" aria-hidden />
    </Link>
  )
}

const HEATMAP_WEEKS = 26

/** Consistency grid of the last 26 weeks (finished workouts per day). */
function MuscleHeatTile({ exMap }: { exMap: Map<Id, Exercise> }) {
  const today = useLocalToday()
  const { library } = useExerciseLibrary()
  const sets = useLiveQuery(() => gatherMuscleHeatSets(today), [today])
  const weeks = useMemo(
    () => (sets ? computeMuscleHeat(sets, exMap, library, today) : null),
    [sets, exMap, library, today],
  )
  if (!weeks || weeks.every(w => w.sets === 0)) return null
  return (
    <section className="mt-4 rounded-2xl border border-edge bg-card p-4">
      <h2 className="font-display text-xl font-semibold">{t('progress.muscleHeat.title')}</h2>
      <p className="mb-2 text-xs text-sub">{t('progress.muscleHeat.caption', { weeks: MUSCLE_HEAT_WEEKS })}</p>
      <MuscleHeatmap weeks={weeks} />
    </section>
  )
}

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
        <span className="min-w-0 flex-1 truncate">{t('progress.heatmap.caption', { weeks: HEATMAP_WEEKS })}</span>
        <span className="flex shrink-0 items-center whitespace-nowrap font-semibold text-primary">
          {t('common.history')} <ChevronRight size={14} aria-hidden />
        </span>
      </Link>
      <Heatmap data={heat} today={today} />
      <p className="num mt-2 flex flex-wrap gap-x-1.5 text-xs text-sub">
        <span className="whitespace-nowrap">
          <CountText msgKey="progress.heatmap.daysThisYear" n={heat.daysThisYear} />
        </span>
        <span aria-hidden>·</span>
        <span className="whitespace-nowrap">
          <CountText msgKey="progress.heatmap.longestRun" n={heat.longestRunWeeks} />
        </span>
      </p>
    </section>
  )
}

function PrWall({ exMap }: { exMap: Map<Id, Exercise> }) {
  const settings = useLiveQuery(() => db.settings.get(1))
  const prs = useLiveQuery(async () => {
    // e1RM > 0, not weight > 0: a plain bodyweight set of a stamped session logs 0 kg but has a load.
    const sets = await db.sets.filter(s => !s.isWarmup && s.e1rm > 0).toArray()
    const byEx = new Map<Id, { e1rm: number; weight: number; reps: number; date: number; sessionId: Id }>()
    for (const s of sets) {
      const cur = byEx.get(s.exerciseId)
      if (!cur || s.e1rm > cur.e1rm) {
        byEx.set(s.exerciseId, { e1rm: s.e1rm, weight: s.weightKg, reps: s.reps, date: s.completedAt, sessionId: s.sessionId })
      }
    }
    const top = [...byEx.entries()].sort((a, b) => b[1].e1rm - a[1].e1rm).slice(0, 12)
    // Only the shown records' sessions, to tell added kg on bodyweight from a plain weight.
    const sessions = await db.sessions.bulkGet(top.map(([, pr]) => pr.sessionId))
    return top.map(([exId, pr], i) => [exId, { ...pr, session: sessions[i] }] as const)
  }, [])

  if (!prs || prs.length === 0) return null
  return (
    <section className="mt-4 pb-4">
      <h2 className="mb-2 flex items-center gap-2 font-display text-xl font-semibold">
        <Trophy size={18} className="text-primary" /> {t('progress.prWall.title')}
      </h2>
      <div className="grid grid-cols-2 gap-2">
        {prs.map(([exId, pr]) => {
          const ex = exMap.get(exId)
          const std = ex ? standardFor(ex.nameLower) : null
          // The pull-up standard rates the bodyweight load: not an unstamped row's added kg.
          const rated = std && (std.key !== 'pullup' || usesBodyweightLoad(ex, pr.session))
          const level = std && rated && settings ? levelFor(pr.e1rm, settings.bodyweightKg, std) : null
          return (
            <div key={exId} className="rounded-xl border border-edge bg-card p-3">
              <p className="truncate text-sm font-medium">{ex ? exerciseDisplayName(ex.name) : '…'}</p>
              <p className="num font-display text-2xl font-bold text-primary">
                {fmtNum(pr.e1rm, { maximumFractionDigits: 1 })}
                <span className="text-sm font-medium text-sub"> e1RM</span>
              </p>
              <p className="num text-xs text-sub">
                {fmtSetLoad({ weightKg: pr.weight, reps: pr.reps }, usesBodyweightLoad(ex, pr.session))} · {shortDate(pr.date)}
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
                    {levelLabel(level.level)}
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
