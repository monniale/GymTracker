import { lazy, Suspense, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Play, Pencil, Plus, HistoryIcon, Timer, RotateCcw, ChevronRight, BookOpen, FlaskConical, Loader2, CalendarRange } from 'lucide-react'
import { db } from '../../db/db'
import { useAppStore } from '../../store'
import { unlockAudio } from '../../lib/audio'
import { useLocalToday, useNow } from '../../lib/hooks'
import { fmtDuration, parseLocalDate } from '../../lib/dates'
import { useNotifyStore } from '../../lib/notifyStore'
import { isNative } from '../../native/platform'
import { templatesDoneOn } from '../../lib/nextTemplate'
import { pickNextWorkout } from '../../lib/widgetData'
import { activeProgram, lastProgramSession, nextProgramTemplate } from '../../lib/programs'
import { currentWeek } from '../../lib/prescription'
import { useUiStore } from '../../lib/uiStore'
import { canOfferDemo, hasUserData, loadDemoData } from '../../lib/demoData'
import { useSyncStore } from '../../lib/sync'
import DemoBanner from '../../components/DemoBanner'
import { t, tp } from '../../i18n'
import type { WorkoutTemplate } from '../../types'

// Android only: `isNative` is a build-time false in the Pages build, so Rollup drops the chunk.
const RestoreCard = isNative ? lazy(() => import('../../native/ui/RestoreCard')) : null

export default function WorkoutHome() {
  const navigate = useNavigate()
  const templates = useLiveQuery(() => db.templates.orderBy('position').toArray())
  // "Today" (scheduled for today's weekday) or rotation "Next up" hint; the Android widget shows
  // the same workout. null = no finished session yet; undefined = still loading (no badge, so it
  // doesn't jump).
  const lastFinished = useLiveQuery(async () =>
    (await db.sessions.orderBy('startedAt').reverse().filter(s => s.endedAt !== undefined).first()) ?? null)
  const today = useLocalToday()
  // Templates already done today: a scheduled one stops being "Today" even if another workout followed.
  const doneToday = useLiveQuery(
    async () => templatesDoneOn(await db.sessions.where('startedAt').aboveOrEqual(parseLocalDate(today).getTime()).toArray(), today),
    [today],
  )
  // The running program (null = none): its rotation fills "Next up" on days without a scheduled
  // template (schedule wins over the program, `pickNextWorkout`); the widget follows the same rule.
  const running = useLiveQuery(async () => {
    const program = await activeProgram()
    return program ? { program, lastSession: await lastProgramSession(program) } : null
  })
  const upNext = templates && lastFinished !== undefined && doneToday && running !== undefined
    ? pickNextWorkout(templates, lastFinished ?? undefined, today, doneToday, running ?? undefined)
    : null
  // The program's own next day, for its card (also on a scheduled day, when "Next up" is the schedule).
  const programNext = running && templates
    ? nextProgramTemplate(running.program, templates, running.lastSession, today, doneToday)
    : null
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
  // Web first run: offer the demo backup on a truly empty device that is not connected to sync
  // (loading it replaces every table; lib/demoData.ts canOfferDemo). Android keeps its RestoreCard.
  const demoLoaded = useUiStore(s => s.demoLoaded)
  const syncConnected = useSyncStore(s => !!(s.token && s.owner && s.repo))
  const userData = useLiveQuery(async () => (isNative ? true : await hasUserData()))
  const showDemo = userData !== undefined
    && canOfferDemo({ isNative, demoLoaded, connected: syncConnected, hasUserData: userData })
  const [demoBusy, setDemoBusy] = useState(false)
  const [demoError, setDemoError] = useState<string | null>(null)

  async function tryDemo() {
    setDemoBusy(true)
    setDemoError(null)
    try {
      await loadDemoData()
    } catch (e) {
      setDemoError(t('components.demo.error', { error: (e as Error).message }))
    } finally {
      setDemoBusy(false)
    }
  }

  async function startWorkout(template?: WorkoutTemplate) {
    unlockAudio() // user gesture: unlock iOS audio for the rest timer beep
    const id = await db.sessions.add({
      templateId: template?.id,
      name: template?.name ?? t('workout.home.freestyleName'),
      startedAt: Date.now(),
      bodyweightKg: settings?.bodyweightKg ?? 75,
      extraExerciseIds: [],
      // Bodyweight exercises score with bodyweight × factor + added kg (lib/load.ts).
      // Forward-only: sessions created before this stamp keep load = weightKg.
      bwScoring: true,
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

      <DemoBanner />

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
                {/* A rotation hint needs 2+ templates; a scheduled one shows even when it is the only one. */}
                {upNext && templates && (upNext.reason === 'today' || templates.length > 1)
                  && String(upNext.template.id) === String(tpl.id) && (
                  <span className="shrink-0 whitespace-nowrap rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-primary">
                    {upNext.reason === 'today' ? t('workout.home.today') : t('workout.home.nextUp')}
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

        {showDemo && (
          <div className="pt-1">
            <button
              onClick={() => void tryDemo()}
              disabled={demoBusy}
              className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-muted/40 px-3 text-center font-semibold active:bg-muted disabled:opacity-60"
            >
              {demoBusy
                ? <Loader2 size={18} className="shrink-0 animate-spin" />
                : <FlaskConical size={18} className="shrink-0" aria-hidden />}
              {demoBusy ? t('workout.home.tryDemoLoading') : t('workout.home.tryDemo')}
            </button>
            <p className="mt-1.5 text-center text-xs text-sub">{t('workout.home.tryDemoHint')}</p>
            {demoError && <p className="mt-1.5 text-center text-xs text-danger">{demoError}</p>}
          </div>
        )}
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

      <Link
        to="/workout/programs"
        className="mt-3 flex items-center gap-3 rounded-2xl border border-edge bg-card p-4 active:bg-muted/30"
      >
        <CalendarRange size={22} className="shrink-0 text-sub" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-xl font-semibold">{t('programs.screen.open')}</span>
          <span className="block truncate text-sm text-sub">{t('programs.screen.hint')}</span>
        </span>
        <ChevronRight size={20} className="shrink-0 text-sub" />
      </Link>

      {running && (
        <Link
          to="/workout/programs"
          state={{ programId: running.program.id }}
          className="mt-3 flex items-center gap-3 rounded-2xl border border-primary/40 bg-primary/10 p-4 active:bg-primary/20"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate font-display text-lg font-semibold">{running.program.name}</span>
            <span className="block text-sm text-sub">
              {programLine(running.program.cycleWeeks, currentWeek(running.program, today), programNext?.template.name)}
            </span>
          </span>
          <ChevronRight size={20} className="shrink-0 text-sub" />
        </Link>
      )}

      <StopwatchCard />
    </div>
  )
}

/** "Week 2 of 4 · Day B next", without the week part when the program has no week cycle. */
function programLine(cycleWeeks: number | undefined, week: number, day: string | undefined): string {
  if (cycleWeeks && day) return t('programs.home.weekNext', { n: week, total: cycleWeeks, day })
  if (cycleWeeks) return t('programs.home.week', { n: week, total: cycleWeeks })
  return day ? t('programs.home.next', { day }) : ''
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
