import { useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Check, Plus, X, Flag, StickyNote, Zap, Link2, Sparkles, MoreHorizontal, ArrowLeftRight } from 'lucide-react'
import { db } from '../../db/db'
import { useAppStore } from '../../store'
import { useNow, useWakeLock } from '../../lib/hooks'
import { effectiveLoad, fmtSetLoad, setE1rm, usesBodyweightLoad } from '../../lib/load'
import { suggestNext } from '../../lib/progression'
import { platesPerSide, formatPlates, warmupRamp, DEFAULT_BAR_KG, DEFAULT_PLATES } from '../../lib/plates'
import { useWorkoutPlan } from '../../lib/workoutSuggest'
import { finishSession } from '../../lib/finishSession'
import { fmtDuration } from '../../lib/dates'
import { isCardioExercise, isCardioSet, cardioDraft, cardioFields, fmtCardioSet, type CardioDraft } from '../../lib/cardio'
import { EQUIPMENT_LABEL } from '../../lib/equipment'
import { sessionItems, type SessionItem } from '../../lib/sessionItems'
import { haptic } from '../../native/haptics'
import ExercisePicker from './ExercisePicker'
import { NoteSheet } from './NoteSheet'
import { CardMenuSheet, SwapSheet } from './ExerciseCardMenu'
import { PendingRow, CardioPendingRow, NoBreakParts, SetBadges, type LogExtra } from './PendingRow'
import { normalizeRpe } from '../../lib/setTypes'
import { useUiStore } from '../../lib/uiStore'
import { exerciseDisplayName } from '../../lib/exerciseNames'
import { t, tp, fmtNum } from '../../i18n'
import type { Exercise, Id, PlannedSet, Session, SetRow, WorkoutTemplate } from '../../types'

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

  // F2: at the start of a session, AI fills opening weights/reps. The offline
  // progression engine is always the instant baseline; this only upgrades it,
  // and silently no-ops with no key / offline / any error.
  const { planByExercise, generating } = useWorkoutPlan(activeSessionId)

  // While finishing, activeSessionId is cleared before the summary navigation
  // lands — don't let the guard redirect to home in that window.
  if (!activeSessionId) return finishing ? null : <Navigate to="/workout" replace />
  if (!session || (session.templateId !== undefined && !template)) return null

  // Template exercises first (after this session's swaps), then anything added mid-session
  // (cardio adds: one 20-minute set); a swapped-out exercise with logged sets keeps a 0-target card.
  const loggedIds = new Set(sets.map(s => s.exerciseId))
  const items = sessionItems(template, session, exMap, loggedIds)
  const templateLines = template?.items.length ?? 0
  const itemIds = new Set(items.map(i => i.exerciseId))
  /** Not offered as swap targets: swapped-out cards stay pickable, to swap back to them. */
  const swapExclude = new Set(items.filter(i => !i.swappedOut).map(i => i.exerciseId))

  // Work sets done per exercise: drives the rest-timer "what's next" label (Android lock screen).
  const workDone = new Map<Id, number>()
  for (const s of sets) if (!s.isWarmup) workDone.set(s.exerciseId, (workDone.get(s.exerciseId) ?? 0) + 1)
  const hasSetsLeft = (it: SessionItem) => (workDone.get(it.exerciseId) ?? 0) < it.targetSets
  const shownName = (id: Id) => {
    const ex = exMap.get(id)
    return ex ? exerciseDisplayName(ex.name) : '…'
  }

  /** The next exercise (in order, wrapping) that still has sets left, other than items[idx]. */
  function nextExerciseName(idx: number): string | undefined {
    for (let k = 1; k < items.length; k++) {
      const it = items[(idx + k) % items.length]
      if (hasSetsLeft(it)) return shownName(it.exerciseId)
    }
    return undefined
  }

  /** Last exercise of a superset chain: the next set is back at the first chain exercise with sets left. */
  function supersetNextName(idx: number): string | undefined {
    let head = idx
    while (head > 0 && items[head - 1].supersetWithNext) head--
    for (let k = head; k < idx; k++) if (hasSetsLeft(items[k])) return shownName(items[k].exerciseId)
    return undefined
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
      if (!window.confirm(t('workout.session.confirmDiscard'))) return
      await db.sessions.delete(session.id!)
      setActiveSessionId(null)
      clearRest()
      navigate('/workout')
      return
    }
    setFinishing(true)
    const sid = session.id!
    await finishSession(sid)
    haptic('success')
    setActiveSessionId(null)
    clearRest()
    navigate(`/workout/summary/${sid}`, { replace: true })
  }

  return (
    <div className="pt-4">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="truncate font-display text-2xl font-bold">{session.name}</h1>
          <p className="num flex items-center gap-2 text-sm text-sub">
            {fmtDuration(now - session.startedAt)}
            {generating && (
              <span className="flex items-center gap-1 text-primary">
                <Sparkles size={12} className="animate-pulse" /> {t('workout.session.planning')}
              </span>
            )}
          </p>
        </div>
        <button
          onClick={onFinish}
          disabled={finishing}
          className="flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl bg-accent px-4 font-display text-lg font-bold text-bg active:opacity-90 disabled:opacity-50"
        >
          <Flag size={18} /> {finishing ? t('workout.session.scoring') : t('workout.session.finish')}
        </button>
      </div>

      <div className="space-y-4">
        {items.map((item, idx) => (
          <div key={item.exerciseId}>
            <ExerciseCard
              item={item}
              exercise={exMap.get(item.exerciseId)}
              sessionId={session.id!}
              session={session}
              template={template}
              fromTemplate={idx < templateLines}
              inSession={swapExclude}
              swappedFromName={item.swappedFrom !== undefined ? shownName(item.swappedFrom) : undefined}
              sessionSets={sets.filter(s => s.exerciseId === item.exerciseId)}
              defaultRestSec={settings?.defaultRestSec ?? 90}
              barKg={settings?.barWeightKg ?? DEFAULT_BAR_KG}
              plates={settings?.platesAvailable ?? DEFAULT_PLATES}
              aiSets={planByExercise.get(String(item.exerciseId))}
              suppressRest={!!item.supersetWithNext && idx < items.length - 1}
              nextExerciseName={nextExerciseName(idx)}
              supersetNextName={supersetNextName(idx)}
            />
            {item.supersetWithNext && idx < items.length - 1 && (
              <div className="relative z-10 -my-2.5 flex justify-center">
                <span className="flex items-center gap-1 whitespace-nowrap rounded-full border border-primary/40 bg-bg px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
                  <Link2 size={11} /> {t('workout.shared.superset')}
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
        <Plus size={20} /> {t('workout.shared.addExercise')}
      </button>

      <ExercisePicker open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={addExercise} />
    </div>
  )
}

interface CardProps {
  item: SessionItem
  exercise?: Exercise
  sessionId: Id
  /** The active session: its bodyweight and `bwScoring` stamp decide bodyweight-exercise load. */
  session: Session
  /** The session's template (undefined for a freestyle session). */
  template?: WorkoutTemplate
  /** This card is one of the template's lines (swaps can also update the template). */
  fromTemplate: boolean
  /** Exercises with a card in this session (swapped-out cards left out): not offered as swap targets. */
  inSession: ReadonlySet<Id>
  /** Shown name of the exercise this line was written for, when swapped. */
  swappedFromName?: string
  sessionSets: SetRow[]
  defaultRestSec: number
  barKg: number
  plates: number[]
  /** AI-planned opening sets for this exercise (F2). Undefined → offline baseline. */
  aiSets?: PlannedSet[]
  suppressRest: boolean
  /** Next exercise with sets left (rest label once this one is done); undefined → last exercise. */
  nextExerciseName?: string
  /** Set when this card closes a superset whose earlier exercise still has sets left. */
  supersetNextName?: string
}

function ExerciseCard({
  item, exercise, sessionId, session, template, fromTemplate, inSession, swappedFromName, sessionSets, defaultRestSec, barKg, plates, aiSets: aiPlan, suppressRest,
  nextExerciseName, supersetNextName,
}: CardProps) {
  const startRest = useAppStore(s => s.startRest)
  // Cardio: time + distance rows, no weight suggestion, ramp, plates or AI weights.
  const cardio = isCardioExercise(exercise)
  const aiSets = cardio ? undefined : aiPlan
  const [extraRows, setExtraRows] = useState(0)
  const [noteOpen, setNoteOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [swapOpen, setSwapOpen] = useState(false)
  const effortScale = useUiStore(s => s.effortScale)

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
  const isBarbell = !cardio && exercise?.equipment === 'barbell'
  const name = exercise ? exerciseDisplayName(exercise.name) : undefined
  // Bodyweight exercise on a stamped session: weightKg is ADDED kg (negative = assisted).
  const bodyweightLoad = usesBodyweightLoad(exercise, session)
  const bodyweightKg = session.bodyweightKg

  const suggestion = useMemo(
    () => cardio ? null : suggestNext(
      prevSets.map(s => ({ weightKg: s.weightKg, reps: s.reps, rpe: s.rpe, setType: s.setType })),
      item.targetReps,
      exercise?.progressionStepKg ?? 2.5,
      { bodyweight: bodyweightLoad },
    ),
    [cardio, prevSets, item.targetReps, exercise?.progressionStepKg, bodyweightLoad],
  )

  /** A set label: "80 kg × 8", or "BW+10 kg × 8" on a bodyweight exercise. */
  const loadLabel = (s: { weightKg: number; reps: number }) => fmtSetLoad(s, bodyweightLoad)

  // The AI-planned set for this row's work-set position (F2), if any.
  function aiSetFor(index: number): PlannedSet | undefined {
    if (!aiSets) return undefined
    const workIndex = index - warmupCount
    return workIndex >= 0 ? aiSets[workIndex] : undefined
  }

  function draftFor(index: number): { weightKg: number; reps: number } {
    return draftForWork(index - warmupCount, logged.filter(s => !s.isWarmup).slice(-1)[0])
  }

  /** Prefill for the work set at `workIndex` (0-based among work rows), given this session's last work set. */
  function draftForWork(
    workIndex: number,
    lastCurrent: { weightKg: number; reps: number } | undefined,
  ): { weightKg: number; reps: number } {
    // Prefer the AI plan; otherwise fall back to the offline prefill unchanged.
    const ai = workIndex >= 0 ? aiSets?.[workIndex] : undefined
    if (ai) return { weightKg: ai.weightKg, reps: ai.reps }
    // Match previous-session work sets by position among this session's work rows.
    const byPosition = workIndex >= 0 ? prevSets[workIndex] : undefined
    const lastPrev = prevSets[prevSets.length - 1]
    const source = byPosition ?? lastCurrent ?? lastPrev
    return {
      weightKg: source?.weightKg ?? 0,
      reps: source?.reps ?? item.targetReps,
    }
  }

  /** Cardio prefill for the row at `workIndex`: last session's same row, else this session's last, else the target minutes. */
  function cardioDraftForWork(workIndex: number, lastCurrent?: Pick<SetRow, 'durationSec' | 'distanceM'>): CardioDraft {
    const byPosition = workIndex >= 0 ? prevSets[workIndex] : undefined
    return cardioDraft(byPosition ?? lastCurrent ?? prevSets[prevSets.length - 1], item.targetReps)
  }

  function cardioDraftFor(index: number): CardioDraft {
    return cardioDraftForWork(index - warmupCount, logged.filter(s => !s.isWarmup).slice(-1)[0])
  }

  const platesFor = (w: number): string | null => {
    if (!isBarbell) return null
    const r = platesPerSide(w, barKg, plates)
    return r ? formatPlates(r) : null
  }

  /**
   * What comes after the set just logged — the Android lock-screen rest countdown body: this
   * exercise's next set target, else (superset partner or) the next exercise with sets left.
   */
  function restLabel(
    just: { weightKg: number; reps: number; durationSec?: number; distanceM?: number },
    isWarmup: boolean,
  ): string {
    if (!isWarmup && supersetNextName) return t('workout.rest.next', { name: supersetNextName })
    const done = workLogged + (isWarmup ? 0 : 1)
    const planned = item.targetSets + extraRows
    if (done < planned) {
      const lastWork = isWarmup ? logged.filter(s => !s.isWarmup).slice(-1)[0] : just
      let target: string
      if (cardio) {
        target = fmtCardioSet(cardioDraftForWork(done, lastWork))
      } else {
        const next = draftForWork(done, lastWork)
        target = bodyweightLoad
          ? loadLabel(next)
          : next.weightKg > 0 ? `${fmtNum(next.weightKg)} kg × ${next.reps}` : tp('units.reps', next.reps)
      }
      return t('workout.rest.setTarget', {
        name: name ?? t('workout.rest.nextSet'), n: done + 1, total: planned, target,
      })
    }
    return nextExerciseName ? t('workout.rest.next', { name: nextExerciseName }) : t('workout.rest.last')
  }

  async function logSet(weightKg: number, reps: number, isWarmup: boolean, extra: LogExtra = {}) {
    // Optional fields are written only when set: a plain working set stores neither (absent = working).
    const rpe = normalizeRpe(extra.rpe)
    await db.sets.add({
      sessionId,
      exerciseId: item.exerciseId,
      setNumber: logged.length + 1,
      weightKg,
      reps,
      isWarmup,
      completedAt: Date.now(),
      e1rm: setE1rm({ weightKg, reps }, exercise, session),
      ...(rpe !== undefined ? { rpe } : {}),
      ...(extra.setType && !isWarmup ? { setType: extra.setType } : {}),
    })
    if (isWarmup) startRest(WARMUP_REST_SEC, restLabel({ weightKg, reps }, true), { warmup: true })
    else if (!suppressRest) startRest(restSec, restLabel({ weightKg, reps }, false))
    haptic('set')
  }

  async function logCardio(d: CardioDraft) {
    const fields = cardioFields(d)
    await db.sets.add({
      sessionId,
      exerciseId: item.exerciseId,
      setNumber: logged.length + 1,
      completedAt: Date.now(),
      ...fields,
    })
    if (!suppressRest) startRest(restSec, restLabel(fields, false))
    haptic('set')
  }

  const rampWeight = aiSets?.[0]?.weightKg ?? suggestion?.weightKg ?? draftFor(0).weightKg
  const showRamp = isBarbell && logged.length === 0 && rampWeight >= barKg * 1.5

  async function addRamp() {
    const steps = warmupRamp(rampWeight, barKg)
    if (steps.length === 0) return
    const at = Date.now()
    await db.sets.bulkAdd(steps.map((st, i) => ({
      sessionId,
      exerciseId: item.exerciseId,
      setNumber: i + 1,
      weightKg: st.weightKg,
      reps: st.reps,
      isWarmup: true,
      completedAt: at + i,
      e1rm: setE1rm(st, exercise, session),
    })))
  }

  async function deleteSet(id: Id) {
    await db.transaction('rw', db.sets, db.tombstones, async () => {
      await db.sets.delete(id)
      await db.tombstones.add({ table: 'sets', rowId: id, deletedAt: Date.now() })
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
      {/* Name gets its own row: on 360px phones the badges left it ~45px. */}
      <div className="flex items-center gap-1">
        <p className="min-w-0 flex-1 truncate font-display text-lg font-semibold">
          {name ?? '…'}
        </p>
        <button
          onClick={() => setNoteOpen(true)}
          aria-label={t('workout.session.notesFor', { name: name ?? '' })}
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg active:bg-muted ${
            exercise?.notes ? 'text-primary' : 'text-sub'
          }`}
        >
          <StickyNote size={16} />
        </button>
        {exercise && (
          <button
            onClick={() => setMenuOpen(true)}
            aria-label={t('workout.cardMenu.open', { name: name ?? '' })}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sub active:bg-muted"
          >
            <MoreHorizontal size={18} />
          </button>
        )}
      </div>
      {(swappedFromName || item.swappedOut) && (
        <p className="-mt-0.5 mb-1 flex min-w-0 items-center gap-1 text-xs text-sub">
          <ArrowLeftRight size={12} className="shrink-0" aria-hidden />
          <span className="truncate">
            {item.swappedOut ? t('workout.swap.swappedOut') : t('workout.swap.swappedFrom', { name: swappedFromName ?? '' })}
          </span>
        </p>
      )}
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        {exercise?.equipment && (
          <span className="whitespace-nowrap rounded-full bg-muted/40 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sub">
            {EQUIPMENT_LABEL[exercise.equipment]}
          </span>
        )}
        <span className="num whitespace-nowrap rounded-full bg-muted/40 px-2 py-0.5 text-xs text-sub">
          {!item.swappedOut && <>{item.targetSets}×{item.targetReps}{cardio ? ' min' : ''} · </>}{restSec}s
        </span>
        {showRamp && (
          <button
            onClick={addRamp}
            aria-label={t('workout.session.addRamp')}
            className="ml-auto flex h-8 items-center gap-1 whitespace-nowrap rounded-lg bg-muted/40 px-2 text-xs font-semibold text-sub active:bg-muted"
          >
            <Zap size={14} /> {t('workout.session.ramp')}
          </button>
        )}
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
                  {isCardioSet(s) ? fmtCardioSet(s) : <NoBreakParts text={loadLabel(s)} />}
                  {s.isWarmup && <span className="ml-2 whitespace-nowrap text-xs font-medium text-sub">{t('workout.shared.warmup')}</span>}
                  {!isCardioSet(s) && <SetBadges set={s} scale={effortScale} />}
                </span>
                <Check size={18} className="text-accent" aria-hidden />
                <button
                  onClick={() => deleteSet(s.id!)}
                  aria-label={t('workout.shared.deleteSet')}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-sub active:bg-muted/40"
                >
                  <X size={16} />
                </button>
              </div>
            )
          }
          if (i === nextIndex && cardio) {
            return (
              <CardioPendingRow
                key={`pending-${item.exerciseId}-${i}`}
                setNumber={i + 1}
                init={cardioDraftFor(i)}
                onLog={logCardio}
              />
            )
          }
          if (i === nextIndex) {
            const draft = draftFor(i)
            return (
              <PendingRow
                // Stable per row index: async prefill/AI values flow in via effects
                // that only touch fields the user hasn't edited (no remount clobber).
                key={`pending-${item.exerciseId}-${i}`}
                setNumber={i + 1}
                initWeight={draft.weightKg}
                initReps={draft.reps}
                bodyweightKg={bodyweightKg}
                bodyweightLoad={bodyweightLoad}
                loadOf={w => effectiveLoad({ weightKg: w }, exercise, session)}
                suggestion={aiSets ? null : workLogged === 0 ? suggestion : null}
                aiFilled={!!aiSetFor(i)}
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
                {cardio
                  ? fmtCardioSet(cardioDraftFor(i))
                  : bodyweightLoad
                    ? loadLabel(ghost)
                    : ghost.weightKg > 0 ? `${fmtNum(ghost.weightKg)} kg × ${ghost.reps}` : `— × ${ghost.reps}`}
              </span>
              {aiSetFor(i) && <Sparkles size={12} className="shrink-0 text-primary/60" aria-label={t('workout.session.aiSuggestion')} />}
            </div>
          )
        })}
      </div>

      <button
        onClick={() => setExtraRows(n => n + 1)}
        className="mt-2 flex min-h-[40px] items-center gap-1 px-1 text-sm font-medium text-sub active:text-ink"
      >
        <Plus size={16} /> {t('workout.shared.addSet')}
      </button>

      {exercise && (
        <NoteSheet
          open={noteOpen}
          onClose={() => setNoteOpen(false)}
          exercise={exercise}
        />
      )}
      {exercise && menuOpen && (
        <CardMenuSheet
          onClose={() => setMenuOpen(false)}
          exercise={exercise}
          onNotes={() => setNoteOpen(true)}
          onSwap={item.swappedOut ? undefined : () => setSwapOpen(true)}
        />
      )}
      {exercise && swapOpen && (
        <SwapSheet
          onClose={() => setSwapOpen(false)}
          session={session}
          template={template}
          item={item}
          exercise={exercise}
          fromTemplate={fromTemplate}
          hasLogged={logged.length > 0}
          exclude={inSession}
        />
      )}
    </div>
  )
}
