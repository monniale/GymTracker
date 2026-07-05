import { useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Check, Plus, X, Flag, StickyNote, Zap, Link2 } from 'lucide-react'
import { db } from '../../db/db'
import { useAppStore } from '../../store'
import { useNow, useWakeLock } from '../../lib/hooks'
import { epley, SCORING } from '../../lib/scoring'
import { suggestNext, type ProgressionSuggestion } from '../../lib/progression'
import { platesPerSide, formatPlates, warmupRamp, DEFAULT_BAR_KG, DEFAULT_PLATES } from '../../lib/plates'
import { finishSession } from '../../lib/finishSession'
import { fmtDuration } from '../../lib/dates'
import NumberStepper from '../../components/NumberStepper'
import Sheet from '../../components/Sheet'
import ExercisePicker from './ExercisePicker'
import type { Exercise, SetRow, TemplateItem } from '../../types'

const WARMUP_REST_SEC = 30

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
        {items.map((item, idx) => (
          <div key={item.exerciseId}>
            <ExerciseCard
              item={item}
              exercise={exMap.get(item.exerciseId)}
              sessionId={session.id!}
              sessionSets={sets.filter(s => s.exerciseId === item.exerciseId)}
              bodyweightKg={session.bodyweightKg}
              defaultRestSec={settings?.defaultRestSec ?? 90}
              barKg={settings?.barWeightKg ?? DEFAULT_BAR_KG}
              plates={settings?.platesAvailable ?? DEFAULT_PLATES}
              suppressRest={!!item.supersetWithNext && idx < items.length - 1}
            />
            {item.supersetWithNext && idx < items.length - 1 && (
              <div className="relative z-10 -my-2.5 flex justify-center">
                <span className="flex items-center gap-1 rounded-full border border-primary/40 bg-bg px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
                  <Link2 size={11} /> Superset
                </span>
              </div>
            )}
          </div>
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
  barKg: number
  plates: number[]
  suppressRest: boolean
}

function ExerciseCard({
  item, exercise, sessionId, sessionSets, bodyweightKg, defaultRestSec, barKg, plates, suppressRest,
}: CardProps) {
  const startRest = useAppStore(s => s.startRest)
  const [extraRows, setExtraRows] = useState(0)
  const [noteOpen, setNoteOpen] = useState(false)

  // Last completed session containing this exercise — prefill + progression source.
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
  const warmupCount = logged.filter(s => s.isWarmup).length
  const workLogged = logged.length - warmupCount
  const rowCount = warmupCount + Math.max(item.targetSets, workLogged) + extraRows
  const nextIndex = logged.length
  const restSec = item.restSec ?? exercise?.defaultRestSec ?? defaultRestSec
  const isBarbell = exercise?.equipment === 'barbell'

  const suggestion = useMemo(
    () => suggestNext(
      prevSets.map(s => ({ weightKg: s.weightKg, reps: s.reps })),
      item.targetReps,
      exercise?.progressionStepKg ?? 2.5,
    ),
    [prevSets, item.targetReps, exercise?.progressionStepKg],
  )

  function draftFor(index: number): { weightKg: number; reps: number } {
    // Match previous-session work sets by position among this session's work rows.
    const workIndex = index - warmupCount
    const byPosition = workIndex >= 0 ? prevSets[workIndex] : undefined
    const lastCurrent = logged.filter(s => !s.isWarmup).slice(-1)[0]
    const lastPrev = prevSets[prevSets.length - 1]
    const source = byPosition ?? lastCurrent ?? lastPrev
    return {
      weightKg: source?.weightKg ?? 0,
      reps: source?.reps ?? item.targetReps,
    }
  }

  const platesFor = (w: number): string | null => {
    if (!isBarbell) return null
    const r = platesPerSide(w, barKg, plates)
    return r ? formatPlates(r) : null
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
    if (isWarmup) startRest(WARMUP_REST_SEC)
    else if (!suppressRest) startRest(restSec)
  }

  const rampWeight = suggestion?.weightKg ?? draftFor(0).weightKg
  const showRamp = isBarbell && logged.length === 0 && rampWeight >= barKg * 1.5

  async function addRamp() {
    const steps = warmupRamp(rampWeight, barKg)
    if (steps.length === 0) return
    const t = Date.now()
    await db.sets.bulkAdd(steps.map((st, i) => ({
      sessionId,
      exerciseId: item.exerciseId,
      setNumber: i + 1,
      weightKg: st.weightKg,
      reps: st.reps,
      isWarmup: true,
      completedAt: t + i,
      e1rm: epley(st.weightKg, st.reps),
    })))
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
      <div className="mb-1 flex items-center justify-between gap-1">
        <p className="min-w-0 flex-1 truncate font-display text-lg font-semibold">
          {exercise?.name ?? '…'}
        </p>
        {showRamp && (
          <button
            onClick={addRamp}
            aria-label="Add warm-up ramp"
            className="flex h-9 items-center gap-1 rounded-lg bg-muted/40 px-2 text-xs font-semibold text-sub active:bg-muted"
          >
            <Zap size={14} /> Ramp
          </button>
        )}
        <button
          onClick={() => setNoteOpen(true)}
          aria-label={`Notes for ${exercise?.name}`}
          className={`flex h-9 w-9 items-center justify-center rounded-lg active:bg-muted ${
            exercise?.notes ? 'text-primary' : 'text-sub'
          }`}
        >
          <StickyNote size={16} />
        </button>
        <span className="num shrink-0 rounded-full bg-muted/40 px-2 py-0.5 text-xs text-sub">
          {item.targetSets}×{item.targetReps} · {restSec}s
        </span>
      </div>
      {exercise?.notes && (
        <button
          onClick={() => setNoteOpen(true)}
          className="mb-1.5 block w-full truncate text-left text-xs text-sub"
        >
          {exercise.notes}
        </button>
      )}

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
                suggestion={workLogged === 0 ? suggestion : null}
                platesFor={platesFor}
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

      {exercise && (
        <NoteSheet open={noteOpen} onClose={() => setNoteOpen(false)} exercise={exercise} />
      )}
    </div>
  )
}

function NoteSheet({ open, onClose, exercise }: {
  open: boolean
  onClose: () => void
  exercise: Exercise
}) {
  const [text, setText] = useState(exercise.notes ?? '')
  const [step, setStep] = useState(exercise.progressionStepKg ?? 2.5)

  async function save() {
    await db.exercises.update(exercise.id!, {
      notes: text.trim() || undefined,
      progressionStepKg: step,
    })
    onClose()
  }

  return (
    <Sheet open={open} onClose={onClose} title={exercise.name}>
      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-sub">
        Notes (seat settings, cues…)
      </label>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        rows={3}
        className="w-full rounded-xl bg-card p-3 text-base"
        placeholder="e.g. seat 4, grip at rings, elbows tucked"
      />
      <div className="mt-3 flex items-center justify-between">
        <NumberStepper
          label="Progression step"
          value={step}
          onChange={setStep}
          step={1.25}
          min={1.25}
          max={10}
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
  )
}

interface PendingProps {
  setNumber: number
  initWeight: number
  initReps: number
  bodyweightKg: number
  suggestion: ProgressionSuggestion | null
  platesFor: (w: number) => string | null
  onLog: (weightKg: number, reps: number, isWarmup: boolean) => void
}

function PendingRow({ setNumber, initWeight, initReps, bodyweightKg, suggestion, platesFor, onLog }: PendingProps) {
  const [weight, setWeight] = useState(initWeight)
  const [reps, setReps] = useState(initReps)
  const [expanded, setExpanded] = useState(false)
  const [warmup, setWarmup] = useState(false)
  const [confirmHeavy, setConfirmHeavy] = useState(false)

  const tooHeavy = weight > bodyweightKg * SCORING.maxWeightBwMult
  const showSuggestion =
    suggestion !== null && (suggestion.weightKg !== weight || suggestion.reps !== reps)
  const plateHint = expanded ? platesFor(weight) : null

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
      {showSuggestion && (
        <button
          onClick={() => {
            setWeight(suggestion.weightKg)
            setReps(suggestion.reps)
          }}
          className="num mb-1.5 flex items-center gap-1 rounded-full bg-primary/15 px-2.5 py-1 text-xs font-bold text-primary active:bg-primary/30"
        >
          ↑ {suggestion.weightKg} kg × {suggestion.reps}
          <span className="font-medium opacity-70">
            {suggestion.reason === 'weight-up' ? 'new weight' : 'one more rep'}
          </span>
        </button>
      )}
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
        <div className="mt-2 border-t border-edge/50 pt-2">
          <div className="flex justify-around">
            <NumberStepper label="kg" value={weight} onChange={setWeight} step={2.5} min={0} max={600} />
            <NumberStepper label="reps" value={reps} onChange={setReps} step={1} min={1} max={100} />
          </div>
          {plateHint && (
            <p className="num mt-1.5 text-center text-xs text-sub">Plates/side: {plateHint}</p>
          )}
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
