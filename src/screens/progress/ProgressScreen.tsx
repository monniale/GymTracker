import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronDown, Scale, Trophy, Plus } from 'lucide-react'
import { db } from '../../db/db'
import { localDateStr, addDays, mondayOf, parseLocalDate } from '../../lib/dates'
import { LineChart, BarChart, BandBars, Sparkline, type ChartPoint } from '../../components/Charts'
import ExercisePicker from '../workout/ExercisePicker'
import Sheet from '../../components/Sheet'
import NumberStepper from '../../components/NumberStepper'
import type { Exercise, MuscleGroup } from '../../types'

const ORANGE = '#F97316'
const GREEN = '#22C55E'

function shortDate(ms: number): string {
  const d = new Date(ms)
  return `${d.getDate()}/${d.getMonth() + 1}`
}

export default function ProgressScreen() {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [exerciseId, setExerciseId] = useState<number | null>(null)

  const exercises = useLiveQuery(() => db.exercises.toArray()) ?? []
  const exMap = useMemo(() => new Map(exercises.map(e => [e.id!, e])), [exercises])

  // Default to the most recently trained exercise.
  const defaultExId = useLiveQuery(async () => {
    // 'completedAt' alone is not indexed; insertion order (id) tracks recency.
    const last = await db.sets.orderBy('id').last()
    return last?.exerciseId ?? null
  })
  const activeExId = exerciseId ?? defaultExId ?? null
  const activeEx = activeExId ? exMap.get(activeExId) : undefined

  return (
    <div className="pt-4">
      <h1 className="mb-4 font-display text-3xl font-bold">Progress</h1>

      <BodyweightTile />

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
          <ExerciseTrend exerciseId={activeExId} />
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

function ExerciseTrend({ exerciseId }: { exerciseId: number }) {
  const data = useLiveQuery(async () => {
    const sets = await db.sets
      .where('exerciseId').equals(exerciseId)
      .filter(s => !s.isWarmup)
      .toArray()
    if (sets.length === 0) return { e1rm: [], volume: [] }
    const bySession = new Map<number, { best: number; volume: number; t: number }>()
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

function WeeklyMuscleVolume({ exMap }: { exMap: Map<number, Exercise> }) {
  const rows = useLiveQuery(async () => {
    const thisMonday = mondayOf(localDateStr())
    const start8w = parseLocalDate(addDays(thisMonday, -49)).getTime()
    const weekStart = parseLocalDate(thisMonday).getTime()
    const sets = await db.sets
      .filter(s => !s.isWarmup && s.completedAt >= start8w)
      .toArray()
    const thisWeek = new Map<MuscleGroup, number>()
    const past = new Map<MuscleGroup, number>()
    for (const s of sets) {
      const mg = exMap.get(s.exerciseId)?.muscleGroup
      if (!mg || mg === 'cardio') continue
      if (s.completedAt >= weekStart) thisWeek.set(mg, (thisWeek.get(mg) ?? 0) + 1)
      else past.set(mg, (past.get(mg) ?? 0) + 1)
    }
    const groups = new Set([...thisWeek.keys(), ...past.keys()])
    return [...groups]
      .map(g => ({
        label: g,
        value: thisWeek.get(g) ?? 0,
        marker: Math.round(((past.get(g) ?? 0) / 7) * 10) / 10,
      }))
      .sort((a, b) => b.value - a.value)
  }, [exMap])

  if (!rows || rows.length === 0) return null
  return (
    <section className="mt-4 rounded-2xl border border-edge bg-card p-4">
      <h2 className="font-display text-xl font-semibold">Weekly sets per muscle</h2>
      <p className="mb-3 text-xs text-sub">
        This week's hard sets. Shaded band = the evidence-backed 10–20 range; tick = your 8-week average.
      </p>
      <BandBars rows={rows} band={[10, 20]} color={ORANGE} />
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
    const w = draft ?? current ?? 75
    await db.bodyLog.put({ date: localDateStr(), weightKg: w })
    await db.settings.update(1, { bodyweightKg: w })
    setLogOpen(false)
  }

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-edge bg-card p-4">
      <Scale size={20} className="shrink-0 text-sub" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="num font-display text-2xl font-bold">
          {current !== undefined ? `${current} kg` : '—'}
          {delta !== null && (
            <span className={`ml-2 text-sm font-semibold ${delta <= 0 ? 'text-accent' : 'text-sub'}`}>
              {delta > 0 ? '+' : ''}{delta} / 30d
            </span>
          )}
        </p>
        <p className="text-xs text-sub">Bodyweight (feeds your rank score)</p>
      </div>
      <Sparkline values={log.slice(-30).map(l => l.weightKg)} color={GREEN} />
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

function PrWall({ exMap }: { exMap: Map<number, Exercise> }) {
  const prs = useLiveQuery(async () => {
    const sets = await db.sets.filter(s => !s.isWarmup && s.weightKg > 0).toArray()
    const byEx = new Map<number, { e1rm: number; weight: number; reps: number; date: number }>()
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
        {prs.map(([exId, pr]) => (
          <div key={exId} className="rounded-xl border border-edge bg-card p-3">
            <p className="truncate text-sm font-medium">{exMap.get(exId)?.name ?? '…'}</p>
            <p className="num font-display text-2xl font-bold text-primary">
              {Math.round(pr.e1rm * 10) / 10}
              <span className="text-sm font-medium text-sub"> e1RM</span>
            </p>
            <p className="num text-xs text-sub">
              {pr.weight} kg × {pr.reps} · {shortDate(pr.date)}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}
