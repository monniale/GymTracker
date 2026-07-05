import { useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Check, Plus, X, Flag } from 'lucide-react'
import { db } from '../../db/db'
import { useAppStore } from '../../store'
import { useNow, useWakeLock } from '../../lib/hooks'
import { epley, SCORING } from '../../lib/scoring'
import { finishSession } from '../../lib/finishSession'
import { fmtDuration } from '../../lib/dates'
import NumberStepper from '../../components/NumberStepper'
import ExercisePicker from './ExercisePicker'
import type { Exercise, SetRow, TemplateItem } from '../../types'

export default function ActiveSession() {
  const navigate = useNavigate()
  const activeSessionId = useAppStore(s => s.activeSessionId)
  const setActiveSessionId = useAppStore(s => s.setActiveSessionId)
  const clearRest = useAppStore(s => s.clearRest)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [finishing, setFinishing] = useState(false)

  useWakeLock(true) // keep the screen on so the rest timer stays visible/audible

  const session = useLiveQuery(
    async () => (activeSessionId ? await db.sessions.get(activeSessionId) : undefined),
    [activeSessionId],
  )
  const template = useLiveQuery(
    async () => (session?.templateId ? await db.templates.get(session.templateId) : undefined),
    [session?.templateId],
  )
  const sets = useLiveQuery(
    async () =>
      activeSessionId ? await db.sets.where('sessionId').equals(activeSessionId).toArray() : [],
    [activeSessionId],
  ) ?? []
  const exercises = useLiveQuery(() => db.exercises.toArray()) ?? []
  const settings = useLiveQuery(() => db.settings.get(1))
  const now = useNow(1000)

  const exMap = useMemo(() => new Map(exercises.map(e => [e.id!, e])), [exercises])

  // While finishing, activeSessionId is cleared before the summary navigation
  // lands — don't let the guard redirect to home in that window.
  if (!activeSessionId) return finishing ? null : <Navigate to="/workout" replace />
  if (!session || (session.templateId !== undefined && !template)) return null

  // Template exercises first, then anything added mid-session.
  const items: TemplateItem[] = [...(template?.items ?? [])]
  const itemIds = new Set(items.map(i => i.exerciseId))
  for (const exId of session.extraExerciseIds) {
    if (!itemIds.has(exId)) {
      const ex = exMap.get(exId)
      items.push({ exerciseId: exId, targetSets: 3, targetReps: 8, restSec: ex?.defaultRestSec })
      itemIds.add(exId)
    }
  }

  async function addExercise(e: Exercise) {
    if (!session || itemIds.has(e.id!)) return
    await db.sessions.update(session.id!, {
      extraExerciseIds: [...session.extraExerciseIds, e.id!],
    })
  }

  async function onFinish() {
    if (finishing || !session) return
    if (sets.length === 0) {
      if (!window.confirm('No sets logged — discard this session?')) return
      await db.sessions.delete(session.id!)
      setActiveSessionId(null)
      clearRest()
      navigate('/workout')
      return
    }
    setFinishing(true)
    const sid = session.id!
    await finishSession(sid)
    setActiveSessionId(null)
    clearRest()
    navigate(`/workout/summary/${sid}`, { replace: true })
  }

  return (
    <div className="pt-4">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="truncate font-display text-2xl font-bold">{session.name}</h1>
          <p className="num text-sm text-sub">{fmtDuration(now - session.startedAt)}</p>
        </div>
        <button
          onClick={onFinish}
          disabled={finishing}
          className="flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-accent px-4 font-display text-lg font-bold text-bg active:opacity-90 disabled:opacity-50"
        >
          <Flag size={18} /> {finishing ? 'Scoring…' : 'Finish'}
        </button>
      </div>

      <div className="space-y-4">
        {items.map(item => (
          <ExerciseCard
            key={item.exerciseId}
            item={item}
            exercise={exMap.get(item.exerciseId)}
            sessionId={session.id!}
            sessionSets={sets.filter(s => s.exerciseId === item.exerciseId)}
            bodyweightKg={session.bodyweightKg}
            defaultRestSec={settings?.defaultRestSec ?? 90}
          />
        ))}
      </div>

      <button
        onClick={() => setPickerOpen(true)}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-edge py-4 font-medium text-sub active:bg-muted/30"
      >
        <Plus size={20} /> Add exercise
      </button>

      <ExercisePicker open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={addExercise} />
    </div>
  )
}

interface CardProps {
  item: TemplateItem
  exercise?: Exercise
  sessionId: number
  sessionSets: SetRow[]
  bodyweightKg: number
  defaultRestSec: number
}

function ExerciseCard({ item, exercise, sessionId, sessionSets, bodyweightKg, defaultRestSec }: CardProps) {
  const startRest = useAppStore(s => s.startRest)
  const [extraRows, setExtraRows] = useState(0)

  // Last completed session containing this exercise — the prefill source.
  const prevSets = useLiveQuery(async () => {
    const all = await db.sets
      .where('exerciseId')
      .equals(item.exerciseId)
      .filter(s => s.sessionId !== sessionId && !s.isWarmup)
      .sortBy('completedAt')
    if (all.length === 0) return []
    const lastSession = all[all.length - 1].sessionId
    return all
      .filter(s => s.sessionId === lastSession)
      .sort((a, b) => a.setNumber - b.setNumber)
  }, [item.exerciseId, sessionId]) ?? []

  const logged = [...sessionSets].sort((a, b) => a.setNumber - b.setNumber)
  const rowCount = Math.max(item.targetSets, logged.length) + extraRows
  const nextIndex = logged.length
  const restSec = item.restSec ?? exercise?.defaultRestSec ?? defaultRestSec

  function draftFor(index: number): { weightKg: number; reps: number } {
    const byNumber = prevSets.find(s => s.setNumber === index + 1)
    const lastCurrent = logged[logged.length - 1]
    const lastPrev = prevSets[prevSets.length - 1]
    const source = byNumber ?? lastCurrent ?? lastPrev
    return {
      weightKg: source?.weightKg ?? 0,
      reps: source?.reps ?? item.targetReps,
    }
  }

  async function logSet(weightKg: number, reps: number, isWarmup: boolean) {
    await db.sets.add({
      sessionId,
      exerciseId: item.exerciseId,
      setNumber: logged.length + 1,
      weightKg,
      reps,
      isWarmup,
      completedAt: Date.now(),
      e1rm: epley(weightKg, reps),
    })
    startRest(restSec)
  }

  async function deleteSet(id: number) {
    await db.transaction('rw', db.sets, async () => {
      await db.sets.delete(id)
      const rest = await db.sets
        .where('sessionId').equals(sessionId)
        .filter(s => s.exerciseId === item.exerciseId)
        .sortBy('setNumber')
      for (let i = 0; i < rest.length; i++) {
        if (rest[i].setNumber !== i + 1) await db.sets.update(rest[i].id!, { setNumber: i + 1 })
      }
    })
  }

  return (
    <div className="rounded-2xl border border-edge bg-card p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="font-display text-lg font-semibold">{exercise?.name ?? '…'}</p>
        <span className="num rounded-full bg-muted/40 px-2 py-0.5 text-xs text-sub">
          {item.targetSets}×{item.targetReps} · rest {restSec}s
        </span>
      </div>

      <div className="space-y-1.5">
        {Array.from({ length: rowCount }, (_, i) => {
          if (i < logged.length) {
            const s = logged[i]
            return (
              <div
                key={s.id}
                className={`flex items-center gap-2 rounded-xl px-3 py-2 ${
                  s.isWarmup ? 'bg-muted/20 text-sub' : 'bg-accent/10'
                }`}
              >
                <span className="num w-6 text-sm font-semibold text-sub">{s.setNumber}</span>
                <span className="num flex-1 font-display text-lg font-semibold">
                  {s.weightKg} kg × {s.reps}
                  {s.isWarmup && <span className="ml-2 text-xs font-medium text-sub">warm-up</span>}
                </span>
                <Check size={18} className="text-accent" aria-hidden />
                <button
                  onClick={() => deleteSet(s.id!)}
                  aria-label="Delete set"
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-sub active:bg-muted/40"
                >
                  <X size={16} />
                </button>
              </div>
            )
          }
          if (i === nextIndex) {
            const draft = draftFor(i)
            return (
              <PendingRow
                key={`pending-${item.exerciseId}-${i}-${draft.weightKg}-${draft.reps}`}
                setNumber={i + 1}
                initWeight={draft.weightKg}
                initReps={draft.reps}
                bodyweightKg={bodyweightKg}
                onLog={logSet}
              />
            )
          }
          const ghost = draftFor(i)
          return (
            <div key={`ghost-${i}`} className="flex items-center gap-2 rounded-xl px-3 py-2 opacity-40">
              <span className="num w-6 text-sm font-semibold text-sub">{i + 1}</span>
              <span className="num flex-1 text-base text-sub">
                {ghost.weightKg > 0 ? `${ghost.weightKg} kg × ${ghost.reps}` : `— × ${ghost.reps}`}
              </span>
            </div>
          )
        })}
      </div>

      <button
        onClick={() => setExtraRows(n => n + 1)}
        className="mt-2 flex min-h-[40px] items-center gap-1 px-1 text-sm font-medium text-sub active:text-ink"
      >
        <Plus size={16} /> Add set
      </button>
    </div>
  )
}

interface PendingProps {
  setNumber: number
  initWeight: number
  initReps: number
  bodyweightKg: number
  onLog: (weightKg: number, reps: number, isWarmup: boolean) => void
}

function PendingRow({ setNumber, initWeight, initReps, bodyweightKg, onLog }: PendingProps) {
  const [weight, setWeight] = useState(initWeight)
  const [reps, setReps] = useState(initReps)
  const [expanded, setExpanded] = useState(false)
  const [warmup, setWarmup] = useState(false)
  const [confirmHeavy, setConfirmHeavy] = useState(false)

  const tooHeavy = weight > bodyweightKg * SCORING.maxWeightBwMult

  function submit() {
    if (reps <= 0) return
    if (tooHeavy && !confirmHeavy) {
      setConfirmHeavy(true)
      return
    }
    onLog(weight, reps, warmup)
  }

  return (
    <div className="rounded-xl border border-primary/40 bg-surface px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="num w-6 text-sm font-semibold text-primary">{setNumber}</span>
        <button
          onClick={() => setExpanded(x => !x)}
          className="num flex-1 py-1 text-left font-display text-xl font-bold active:opacity-70"
          aria-label="Adjust weight and reps"
        >
          {weight > 0 ? `${weight} kg` : '— kg'} × {reps}
        </button>
        <button
          onClick={() => setWarmup(w => !w)}
          aria-label="Toggle warm-up"
          aria-pressed={warmup}
          className={`flex h-10 w-10 items-center justify-center rounded-lg text-sm font-bold ${
            warmup ? 'bg-muted text-ink' : 'bg-muted/30 text-sub'
          }`}
        >
          W
        </button>
        <button
          onClick={submit}
          aria-label="Log set"
          className="flex h-12 w-14 items-center justify-center rounded-xl bg-primary text-bg active:opacity-90"
        >
          <Check size={26} strokeWidth={3} />
        </button>
      </div>
      {expanded && (
        <div className="mt-2 flex justify-around border-t border-edge/50 pt-2">
          <NumberStepper label="kg" value={weight} onChange={setWeight} step={2.5} min={0} max={600} />
          <NumberStepper label="reps" value={reps} onChange={setReps} step={1} min={1} max={100} />
        </div>
      )}
      {tooHeavy && (
        <p className="mt-1 text-xs font-medium text-danger">
          Unusually heavy ({'>'}{SCORING.maxWeightBwMult}× bodyweight) — tap ✓ again to confirm.
        </p>
      )}
    </div>
  )
}
