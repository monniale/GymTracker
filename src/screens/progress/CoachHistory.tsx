import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft, ChevronDown, Dumbbell, UtensilsCrossed, CalendarRange, Trash2, ExternalLink, Sparkles } from 'lucide-react'
import { db } from '../../db/db'
import { addDays, fmtDate, fmtDateTime, monthLabel, startOfMonth } from '../../lib/dates'
import { weekRangeLabel } from '../../lib/weekBriefing'
import { deleteJudgement, judgementKey } from '../../lib/coachHistory'
import { t } from '../../i18n'
import type { CoachInsightTone, CoachJudgement } from '../../types'

type Filter = 'all' | 'workout' | 'diet' | 'week'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: t('progress.coach.filterAll') },
  { id: 'workout', label: t('progress.coach.filterWorkouts') },
  { id: 'diet', label: t('progress.coach.filterDiet') },
  { id: 'week', label: t('progress.coach.filterWeeks') },
]

function toneText(t: CoachInsightTone): string {
  switch (t) {
    case 'celebratory': return 'text-primary'
    case 'positive': return 'text-accent'
    case 'warning': return 'text-danger'
    default: return 'text-ink'
  }
}
function toneDot(t: CoachInsightTone): string {
  switch (t) {
    case 'celebratory': return 'bg-primary'
    case 'positive': return 'bg-accent'
    case 'warning': return 'bg-danger'
    default: return 'bg-muted'
  }
}

/** Progress › Coach history: every stored AI verdict (workout notes + diet reports), newest first. */
export default function CoachHistory() {
  const [params, setParams] = useSearchParams()
  const kindParam = params.get('kind')
  const filter: Filter = kindParam === 'workout' || kindParam === 'diet' || kindParam === 'week' ? kindParam : 'all'

  const rows = useLiveQuery(() => db.coachHistory.orderBy('generatedAt').reverse().toArray())
  const sessionIds = useLiveQuery(async () => new Set((await db.sessions.toCollection().primaryKeys()).map(String)))

  // The newest verdict per session/day is current; older ones were replaced by a Regenerate.
  const currentIds = useMemo(() => {
    const seen = new Set<string>()
    const ids = new Set<string>()
    for (const r of rows ?? []) {
      const key = judgementKey(r)
      if (seen.has(key)) continue
      seen.add(key)
      ids.add(String(r.id))
    }
    return ids
  }, [rows])

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: 0, workout: 0, diet: 0, week: 0 }
    for (const r of rows ?? []) {
      c.all++
      // A kind from a newer build counts under All only.
      if (r.kind in c) c[r.kind] = (c[r.kind] ?? 0) + 1
    }
    return c
  }, [rows])

  // Group by the month of the day judged, newest day first.
  const months = useMemo(() => {
    const list = (rows ?? [])
      .filter(r => filter === 'all' || r.kind === filter)
      .sort((a, b) => b.date.localeCompare(a.date) || b.generatedAt - a.generatedAt)
    const out: { month: string; rows: CoachJudgement[] }[] = []
    for (const r of list) {
      const month = startOfMonth(r.date)
      const last = out[out.length - 1]
      if (last && last.month === month) last.rows.push(r)
      else out.push({ month, rows: [r] })
    }
    return out
  }, [rows, filter])

  return (
    <div className="pt-4">
      <div className="mb-4 flex items-center gap-2">
        <Link
          to="/progress"
          aria-label={t('common.back')}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sub active:bg-muted/40"
        >
          <ChevronLeft size={24} />
        </Link>
        <h1 className="min-w-0 truncate font-display text-3xl font-bold">{t('progress.coachTile.title')}</h1>
      </div>

      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label={t('progress.coach.filterAria')}>
        {FILTERS.map(f => (
          <button
            key={f.id}
            role="tab"
            aria-selected={filter === f.id}
            onClick={() => setParams(f.id === 'all' ? {} : { kind: f.id }, { replace: true })}
            className={`min-h-[36px] shrink-0 whitespace-nowrap rounded-full px-3 text-sm font-semibold ${
              filter === f.id ? 'bg-primary/15 text-primary' : 'bg-card text-sub active:bg-muted/40'
            }`}
          >
            {f.label} <span className="num font-normal opacity-70">{counts[f.id]}</span>
          </button>
        ))}
      </div>

      {rows === undefined ? null : months.length === 0 ? (
        <div className="rounded-2xl border border-edge bg-card p-6 text-center">
          <Sparkles size={22} className="mx-auto text-primary" aria-hidden />
          <p className="mt-2 text-sm text-sub">
            {filter === 'diet'
              ? t('progress.coach.emptyDiet')
              : filter === 'week'
                ? t('progress.coach.emptyWeek')
                : t('progress.coach.emptyAll')}
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {months.map(m => (
            <section key={m.month}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-sub">{monthLabel(m.month)}</h2>
              <ul className="space-y-2">
                {m.rows.map(r => (
                  <JudgementCard
                    key={String(r.id)}
                    row={r}
                    current={currentIds.has(String(r.id))}
                    sessionExists={r.sessionId !== undefined && !!sessionIds?.has(String(r.sessionId))}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

function JudgementCard({ row, current, sessionExists }: { row: CoachJudgement; current: boolean; sessionExists: boolean }) {
  const [open, setOpen] = useState(false)
  const KindIcon = row.kind === 'workout' ? Dumbbell : row.kind === 'week' ? CalendarRange : UtensilsCrossed
  const subject = row.kind === 'workout'
    ? row.title || t('progress.coach.workout')
    : row.kind === 'week' ? t('progress.weekTile.title') : t('progress.coach.dietDay')

  async function remove() {
    if (!window.confirm(t('progress.coach.deleteConfirm'))) return
    await deleteJudgement(row)
  }

  return (
    <li className={`rounded-2xl border border-edge bg-card ${current ? '' : 'opacity-75'}`}>
      <button onClick={() => setOpen(o => !o)} aria-expanded={open} className="flex w-full items-start gap-3 p-4 text-left">
        <KindIcon size={18} className="mt-0.5 shrink-0 text-sub" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-sub">
            <span className="whitespace-nowrap">{row.kind === 'week' ? weekRangeLabel(row.date) : fmtDate(row.date)}</span>
            <span className="min-w-0 truncate">{subject}</span>
            {!current && (
              <span className="shrink-0 whitespace-nowrap rounded-full bg-muted/40 px-2 py-0.5 text-[11px] font-semibold">
                {t('progress.coach.earlier')}
              </span>
            )}
          </p>
          <p className={`mt-1 font-display text-lg font-semibold leading-snug ${toneText(row.note.tone)}`}>
            {row.note.headline}
          </p>
        </div>
        <ChevronDown size={18} className={`mt-1 shrink-0 text-sub transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && (
        <div className="px-4 pb-4">
          <ul className="space-y-1.5">
            {row.note.insights.map((ins, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${toneDot(ins.tone)}`} />
                <span>{ins.message}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 truncate text-xs text-sub">
            {fmtDateTime(row.generatedAt)} · {row.model || 'Gemini'}
          </p>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            {row.kind === 'workout' && sessionExists ? (
              <Link
                to={`/workout/summary/${String(row.sessionId)}?report=1`}
                className="flex items-center gap-1.5 whitespace-nowrap text-sm font-semibold text-primary"
              >
                <ExternalLink size={14} aria-hidden /> {t('progress.coach.openWorkout')}
              </Link>
            ) : row.kind === 'week' ? (
              <Link
                to="/progress/week"
                state={{ monday: row.date, sunday: addDays(row.date, 6) }}
                className="flex items-center gap-1.5 whitespace-nowrap text-sm font-semibold text-primary"
              >
                <ExternalLink size={14} aria-hidden /> {t('progress.coach.openWeek')}
              </Link>
            ) : row.kind === 'diet' ? (
              <Link to="/diet" state={{ date: row.date }} className="flex items-center gap-1.5 whitespace-nowrap text-sm font-semibold text-primary">
                <ExternalLink size={14} aria-hidden /> {t('progress.coach.openDay')}
              </Link>
            ) : (
              <span className="text-xs text-sub">{t('progress.coach.workoutDeleted')}</span>
            )}
            <button onClick={() => void remove()} className="flex items-center gap-1.5 whitespace-nowrap text-sm font-semibold text-danger">
              <Trash2 size={14} aria-hidden /> {t('common.delete')}
            </button>
          </div>
        </div>
      )}
    </li>
  )
}
