import { useNavigate, Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Play, Pencil, Plus, HistoryIcon, Timer, RotateCcw, ChevronRight } from 'lucide-react'
import { db } from '../../db/db'
import { useAppStore } from '../../store'
import { unlockAudio } from '../../lib/audio'
import { useNow } from '../../lib/hooks'
import { fmtDuration } from '../../lib/dates'
import type { WorkoutTemplate } from '../../types'

export default function WorkoutHome() {
  const navigate = useNavigate()
  const templates = useLiveQuery(() => db.templates.orderBy('position').toArray())
  const settings = useLiveQuery(() => db.settings.get(1))
  const activeSessionId = useAppStore(s => s.activeSessionId)
  const setActiveSessionId = useAppStore(s => s.setActiveSessionId)
  const activeSession = useLiveQuery(
    async () => (activeSessionId ? await db.sessions.get(activeSessionId) : undefined),
    [activeSessionId],
  )

  async function startWorkout(template?: WorkoutTemplate) {
    unlockAudio() // user gesture: unlock iOS audio for the rest timer beep
    const id = await db.sessions.add({
      templateId: template?.id,
      name: template?.name ?? 'Freestyle session',
      startedAt: Date.now(),
      bodyweightKg: settings?.bodyweightKg ?? 75,
      extraExerciseIds: [],
    })
    setActiveSessionId(id)
    navigate('/workout/session')
  }

  async function newTemplate() {
    const id = await db.templates.add({
      name: 'New workout',
      position: templates?.length ?? 0,
      items: [],
      updatedAt: Date.now(),
    })
    navigate(`/workout/template/${id}`)
  }

  return (
    <div className="pt-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-3xl font-bold">Workout</h1>
        <Link
          to="/workout/history"
          className="flex min-h-[44px] items-center gap-1 rounded-lg px-3 text-sm font-medium text-sub active:bg-muted/40"
        >
          <HistoryIcon size={18} /> History
        </Link>
      </div>

      {activeSession && !activeSession.endedAt && (
        <button
          onClick={() => navigate('/workout/session')}
          className="mb-4 flex w-full items-center justify-between rounded-2xl bg-primary px-4 py-4 text-left text-bg active:opacity-90"
        >
          <div>
            <p className="font-display text-lg font-bold">Session in progress</p>
            <p className="text-sm font-medium opacity-80">{activeSession.name} — tap to resume</p>
          </div>
          <ChevronRight size={24} />
        </button>
      )}

      <div className="space-y-3">
        {templates?.map(t => (
          <div key={t.id} className="flex items-center gap-3 rounded-2xl border border-edge bg-card p-4">
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-xl font-semibold">{t.name}</p>
              <p className="text-sm text-sub">
                {t.items.length} exercise{t.items.length === 1 ? '' : 's'}
              </p>
            </div>
            <button
              onClick={() => navigate(`/workout/template/${t.id}`)}
              aria-label={`Edit ${t.name}`}
              className="flex h-11 w-11 items-center justify-center rounded-xl bg-muted/40 text-sub active:bg-muted"
            >
              <Pencil size={18} />
            </button>
            <button
              onClick={() => startWorkout(t)}
              className="flex h-11 items-center gap-1.5 rounded-xl bg-primary px-4 font-display text-lg font-bold text-bg active:opacity-90"
            >
              <Play size={18} fill="currentColor" /> Start
            </button>
          </div>
        ))}

        <button
          onClick={newTemplate}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-edge py-4 font-medium text-sub active:bg-muted/30"
        >
          <Plus size={20} /> New workout
        </button>

        <button
          onClick={() => startWorkout()}
          className="w-full py-2 text-center text-sm font-medium text-sub underline-offset-4 active:underline"
        >
          Start an empty session
        </button>
      </div>

      <StopwatchCard />
    </div>
  )
}

function StopwatchCard() {
  const stopwatch = useAppStore(s => s.stopwatch)
  const toggle = useAppStore(s => s.toggleStopwatch)
  const reset = useAppStore(s => s.resetStopwatch)
  const running = stopwatch.startedAt !== null
  const now = useNow(running ? 250 : 60_000)
  const elapsed = stopwatch.accMs + (running ? now - stopwatch.startedAt! : 0)

  return (
    <div className="mt-6 flex items-center gap-3 rounded-2xl border border-edge bg-card p-4">
      <Timer size={22} className="text-sub" aria-hidden />
      <span className="num flex-1 font-display text-2xl font-bold">{fmtDuration(elapsed)}</span>
      <button
        onClick={reset}
        aria-label="Reset stopwatch"
        className="flex h-11 w-11 items-center justify-center rounded-xl bg-muted/40 text-sub active:bg-muted"
      >
        <RotateCcw size={18} />
      </button>
      <button
        onClick={toggle}
        className={`h-11 rounded-xl px-5 font-display text-lg font-bold active:opacity-90 ${
          running ? 'bg-muted text-ink' : 'bg-accent text-bg'
        }`}
      >
        {running ? 'Pause' : 'Start'}
      </button>
    </div>
  )
}
