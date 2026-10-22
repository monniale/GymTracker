import { lazy, Suspense } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Play, Pencil, Plus, HistoryIcon, Timer, RotateCcw, ChevronRight, BookOpen } from 'lucide-react'
import { db } from '../../db/db'
import { useAppStore } from '../../store'
import { unlockAudio } from '../../lib/audio'
import { useNow } from '../../lib/hooks'
import { fmtDuration } from '../../lib/dates'
import { useNotifyStore } from '../../lib/notifyStore'
import { isNative } from '../../native/platform'
import { nextTemplate } from '../../lib/nextTemplate'
import { t, tp } from '../../i18n'
import type { WorkoutTemplate } from '../../types'

// Android only: `isNative` is a build-time false in the Pages build, so Rollup drops the chunk.
const RestoreCard = isNative ? lazy(() => import('../../native/ui/RestoreCard')) : null

export default function WorkoutHome() {
  const navigate = useNavigate()
  const templates = useLiveQuery(() => db.templates.orderBy('position').toArray())
  // Rotation hint (the Android widget shows the same "Next" workout).
  // null = no finished session yet; undefined = still loading (no badge, so it doesn't jump).
  const lastFinished = useLiveQuery(async () =>
    (await db.sessions.orderBy('startedAt').reverse().filter(s => s.endedAt !== undefined).first()) ?? null)
  const upNext = templates && lastFinished !== undefined ? nextTemplate(templates, lastFinished ?? undefined) : null
  const settings = useLiveQuery(() => db.settings.get(1))
  const activeSessionId = useAppStore(s => s.activeSessionId)
  const setActiveSessionId = useAppStore(s => s.setActiveSessionId)
  const activeSession = useLiveQuery(
    async () => (activeSessionId ? await db.sessions.get(activeSessionId) : undefined),
    [activeSessionId],
  )
  // First-run "Restore your data" card (Android): an empty install that hasn't chosen "Start fresh".
  const restoreDismissed = useNotifyStore(s => s.restoreDismissed)
  const emptyInstall = useLiveQuery(
    async () =>
      isNative && !restoreDismissed && (await db.sessions.count()) === 0 && (await db.foodLogs.count()) === 0,
    [restoreDismissed],
  )
  const showRestore = isNative && !restoreDismissed && emptyInstall === true

  async function startWorkout(template?: WorkoutTemplate) {
    unlockAudio() // user gesture: unlock iOS audio for the rest timer beep
    const id = await db.sessions.add({
      templateId: template?.id,
      name: template?.name ?? t('workout.home.freestyleName'),
      startedAt: Date.now(),
      bodyweightKg: settings?.bodyweightKg ?? 75,
      extraExerciseIds: [],
    })
    setActiveSessionId(id)
    navigate('/workout/session')
    // Android: ask for notifications once, on the first workout — not while the restore card is up.
    if (isNative && !showRestore && !useNotifyStore.getState().permissionAsked)
      void import('../../native/notifications').then(m => m.maybeAskOnFirstWorkout()).catch(() => {})
  }

  async function newTemplate() {
    const id = await db.templates.add({
      name: t('workout.home.newTemplateName'),
      position: templates?.length ?? 0,
      items: [],
      updatedAt: Date.now(),
    })
    navigate(`/workout/template/${id}`)
  }

  return (
    <div className="pt-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="min-w-0 truncate font-display text-3xl font-bold">{t('workout.home.title')}</h1>
        <Link
          to="/workout/history"
          className="flex min-h-[44px] shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-3 text-sm font-medium text-sub active:bg-muted/40"
        >
          <HistoryIcon size={18} /> {t('common.history')}
        </Link>
      </div>

      {showRestore && RestoreCard && (
        <Suspense fallback={null}>
          <RestoreCard />
        </Suspense>
      )}

      {activeSession && !activeSession.endedAt && (
        <button
          onClick={() => navigate('/workout/session')}
          className="mb-4 flex w-full items-center justify-between rounded-2xl bg-primary px-4 py-4 text-left text-bg active:opacity-90"
        >
          <div>
            <p className="font-display text-lg font-bold">{t('workout.home.inProgress')}</p>
            <p className="text-sm font-medium opacity-80">{t('workout.home.tapToResume', { name: activeSession.name })}</p>
          </div>
          <ChevronRight size={24} />
        </button>
      )}

      <div className="space-y-3">
        {templates?.map(tpl => (
          <div key={tpl.id} className="flex items-center gap-3 rounded-2xl border border-edge bg-card p-4">
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-xl font-semibold">{tpl.name}</p>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-sub">
                <span className="whitespace-nowrap">{tp('units.exercises', tpl.items.length)}</span>
                {upNext && templates && templates.length > 1 && String(upNext.id) === String(tpl.id) && (
                  <span className="shrink-0 whitespace-nowrap rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-primary">
                    {t('workout.home.nextUp')}
                  </span>
                )}
              </p>
            </div>
            <button
              onClick={() => navigate(`/workout/template/${tpl.id}`)}
              aria-label={t('workout.home.editTemplate', { name: tpl.name })}
              className="flex h-11 w-11 items-center justify-center rounded-xl bg-muted/40 text-sub active:bg-muted"
            >
              <Pencil size={18} />
            </button>
            <button
              onClick={() => startWorkout(tpl)}
              className="flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl bg-primary px-4 font-display text-lg font-bold text-bg active:opacity-90"
            >
              <Play size={18} fill="currentColor" /> {t('workout.home.start')}
            </button>
          </div>
        ))}

        <button
          onClick={newTemplate}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-edge py-4 font-medium text-sub active:bg-muted/30"
        >
          <Plus size={20} /> {t('workout.home.newTemplate')}
        </button>

        <button
          onClick={() => startWorkout()}
          className="w-full py-2 text-center text-sm font-medium text-sub underline-offset-4 active:underline"
        >
          {t('workout.home.startEmpty')}
        </button>
      </div>

      <Link
        to="/workout/exercises"
        className="mt-6 flex items-center gap-3 rounded-2xl border border-edge bg-card p-4 active:bg-muted/30"
      >
        <BookOpen size={22} className="shrink-0 text-sub" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-xl font-semibold">{t('library.screen.open')}</span>
          <span className="block truncate text-sm text-sub">{t('library.screen.hint')}</span>
        </span>
        <ChevronRight size={20} className="shrink-0 text-sub" />
      </Link>

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
        aria-label={t('workout.stopwatch.reset')}
        className="flex h-11 w-11 items-center justify-center rounded-xl bg-muted/40 text-sub active:bg-muted"
      >
        <RotateCcw size={18} />
      </button>
      <button
        onClick={toggle}
        className={`h-11 shrink-0 whitespace-nowrap rounded-xl px-5 font-display text-lg font-bold active:opacity-90 ${
          running ? 'bg-muted text-ink' : 'bg-accent text-bg'
        }`}
      >
        {running ? t('workout.stopwatch.pause') : t('workout.stopwatch.start')}
      </button>
    </div>
  )
}
