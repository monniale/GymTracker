import { useMemo } from 'react'
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft, ChevronRight, LineChart, Star } from 'lucide-react'
import { parseRouteId } from '../../lib/ids'
import { gatherExerciseHistory, heldRepMaxes, type HistorySession, type StatSet } from '../../lib/exerciseHistory'
import { fmtSetLoad, usesBodyweightLoad } from '../../lib/load'
import { fmtCardioSet, fmtDistance, isCardioSet } from '../../lib/cardio'
import { fmtDate, fmtDuration, fmtLongDate, localDateStr } from '../../lib/dates'
import { EQUIPMENT_LABEL, muscleGroupLabel } from '../../lib/equipment'
import { exerciseDisplayName } from '../../lib/exerciseNames'
import { libraryIdOf, useExerciseLibrary } from '../../lib/exerciseLibrary'
import { hasInvolvement, involvement } from '../../lib/muscleMap'
import { useUiStore } from '../../lib/uiStore'
import { InvolvementFigure } from '../../components/library/BodyFigure'
import { NoBreakParts, SetBadges } from '../workout/PendingRow'
import { t, tp, fmtNum } from '../../i18n'
import type { Exercise, Id, Session } from '../../types'

/** "Today" / "Thu 15 Oct", with the year when it is not this year's. */
function dayLabel(ms: number): string {
  const d = new Date(ms)
  const date = localDateStr(d)
  return d.getFullYear() === new Date().getFullYear() ? fmtDate(date) : fmtLongDate(date)
}

/** Progress › one exercise: stats and every finished workout with it, newest first. */
export default function ExerciseHistory() {
  const id = parseRouteId(useParams().id)
  const navigate = useNavigate()
  const location = useLocation()
  const scale = useUiStore(s => s.effortScale)
  const { library } = useExerciseLibrary()
  const data = useLiveQuery(() => (id === '' ? Promise.resolve(null) : gatherExerciseHistory(id)), [id])
  const sessionsById = useMemo(
    () => new Map<Id, Session>((data?.sessions ?? []).map(g => [g.session.id!, g.session])),
    [data],
  )

  if (data === undefined) return null
  if (data === null) return <Navigate to="/progress" replace />

  const { exercise, sessions, stats, repMaxes } = data
  const libId = libraryIdOf(exercise)
  const lib = libId ? library?.byId.get(libId) : undefined
  const inv = lib ? involvement(lib, exercise.muscleGroup) : null
  const bwOf = (s: StatSet) => usesBodyweightLoad(exercise, sessionsById.get(s.set.sessionId))

  function back() {
    // Return where the user came from (Progress, the library, a workout); a cold deep link goes to Progress.
    if (location.key !== 'default') navigate(-1)
    else navigate('/progress')
  }

  return (
    <div className="pt-4">
      <div className="mb-3 flex items-center gap-2">
        <button
          onClick={back}
          aria-label={t('common.back')}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sub active:bg-muted/40"
        >
          <ChevronLeft size={24} />
        </button>
        <h1 className="min-w-0 flex-1 truncate font-display text-2xl font-bold">{exerciseDisplayName(exercise.name)}</h1>
        <button
          onClick={() => navigate('/progress', { state: { exerciseId: exercise.id } })}
          className="flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl bg-primary/15 px-3 text-sm font-semibold text-primary active:bg-primary/30"
        >
          <LineChart size={16} aria-hidden /> {t('progress.exercise.chart')}
        </button>
      </div>

      <div className="mb-4 flex items-center gap-3">
        {inv && hasInvolvement(inv) && (
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-muted/30 p-0.5" aria-hidden>
            <InvolvementFigure inv={inv} mini className="h-full w-full" />
          </span>
        )}
        <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
          <span className="whitespace-nowrap rounded-full bg-muted/40 px-2.5 py-1 text-xs text-sub">{muscleGroupLabel(exercise.muscleGroup)}</span>
          {exercise.equipment && (
            <span className="whitespace-nowrap rounded-full bg-muted/40 px-2.5 py-1 text-xs text-sub">{EQUIPMENT_LABEL[exercise.equipment]}</span>
          )}
        </div>
      </div>

      {sessions.length === 0 ? (
        <p className="rounded-2xl border border-edge bg-card px-4 py-10 text-center text-sm text-sub">{t('progress.exercise.empty')}</p>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2">
            {stats.bestE1rm && (
              <StatCell
                label={t('progress.exercise.bestE1rm')}
                value={`${fmtNum(stats.bestE1rm.e1rm, { maximumFractionDigits: 1 })} kg`}
                sub={fmtSetLoad(stats.bestE1rm.set, bwOf(stats.bestE1rm))}
                sub2={dayLabel(stats.bestE1rm.set.completedAt)}
              />
            )}
            {stats.heaviest && (
              <StatCell
                label={t('progress.exercise.heaviest')}
                value={fmtSetLoad(stats.heaviest.set, bwOf(stats.heaviest))}
                sub={dayLabel(stats.heaviest.set.completedAt)}
              />
            )}
            {stats.cardio && (
              <StatCell label={t('progress.exercise.totalTime')} value={fmtDuration(stats.cardio.totalSec * 1000)} />
            )}
            {stats.cardio && stats.cardio.totalM > 0 && (
              <StatCell label={t('progress.exercise.totalDistance')} value={fmtDistance(stats.cardio.totalM)} />
            )}
            <StatCell label={t('progress.exercise.workingSets')} value={fmtNum(stats.workingSets)} />
            <StatCell label={t('progress.exercise.sessions')} value={fmtNum(stats.sessionCount)} />
            {stats.lastDone !== undefined && (
              <StatCell label={t('progress.exercise.lastDone')} value={dayLabel(stats.lastDone)} />
            )}
          </div>

          <div className="space-y-2">
            {sessions.map(g => (
              <SessionCard
                key={g.session.id}
                group={g}
                exercise={exercise}
                allTime={repMaxes.allTime}
                scale={scale}
                onOpen={() => navigate(`/workout/past/${g.session.id}`)}
              />
            ))}
          </div>
          {repMaxes.allTime.size > 0 && <p className="mt-2 text-[11px] text-sub">{t('progress.exercise.prNote')}</p>}
        </>
      )}
    </div>
  )
}

/** `sub2` is a second small line (a date), so a long `sub` never truncates it away at 320 px. */
function StatCell({ label, value, sub, sub2 }: { label: string; value: string; sub?: string; sub2?: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-edge bg-card p-3">
      <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-sub">{label}</p>
      <p className="num truncate font-display text-lg font-bold">{value}</p>
      {sub && <p className="num truncate text-[11px] text-sub">{sub}</p>}
      {sub2 && <p className="num truncate text-[11px] text-sub">{sub2}</p>}
    </div>
  )
}

/** One finished workout's sets of this exercise; the whole card opens the workout. */
function SessionCard({
  group, exercise, allTime, scale, onOpen,
}: {
  group: HistorySession
  exercise: Exercise
  allTime: Parameters<typeof heldRepMaxes>[1]
  scale: 'rpe' | 'rir'
  onOpen: () => void
}) {
  const { session, sets } = group
  const bw = usesBodyweightLoad(exercise, session)
  const date = dayLabel(session.startedAt)
  return (
    <button
      onClick={onOpen}
      className="block w-full rounded-2xl border border-edge bg-card p-4 text-left active:bg-muted/30"
    >
      <span className="mb-1 flex items-center gap-2">
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-base font-semibold">{session.name}</span>
          <span className="block truncate text-xs text-sub">
            {date} · {tp('progress.exercise.sets', sets.length)}
          </span>
        </span>
        <ChevronRight size={18} className="shrink-0 text-sub" aria-hidden />
      </span>
      {sets.map(s => {
        // The buckets a set holds are contiguous (records never get lighter from 1RM to 12RM).
        const held = isCardioSet(s) ? [] : heldRepMaxes(s, allTime)
        return (
          <span key={s.id} className="flex items-center gap-2 py-0.5">
            <span className="num w-6 shrink-0 text-sm font-semibold text-sub">{s.setNumber}</span>
            <span className="num min-w-0 flex-1 font-semibold">
              {isCardioSet(s) ? fmtCardioSet(s) : <NoBreakParts text={fmtSetLoad(s, bw)} />}
              {s.isWarmup && <span className="ml-2 whitespace-nowrap text-xs font-medium text-sub">{t('workout.shared.warmup')}</span>}
              {!isCardioSet(s) && <SetBadges set={s} scale={scale} />}
            </span>
            {held.length > 0 && (
              <span title={t('progress.exercise.pr')} className="flex shrink-0 items-center gap-0.5 whitespace-nowrap text-xs font-bold text-primary">
                <Star size={14} fill="currentColor" aria-hidden />
                <span aria-hidden>{held.length === 1 ? `${held[0]}RM` : `${held[0]}–${held[held.length - 1]}RM`}</span>
                <span className="sr-only">{t('progress.exercise.pr')}</span>
              </span>
            )}
          </span>
        )
      })}
    </button>
  )
}
