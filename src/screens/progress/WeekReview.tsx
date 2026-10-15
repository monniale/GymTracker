import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft, ChevronRight, ChevronRight as Caret, Check, Target } from 'lucide-react'
import { addDays, fmtDate, mondayOf } from '../../lib/dates'
import { useLocalToday } from '../../lib/hooks'
import { gatherWeekBriefing, lastFinishedMonday, weekRangeLabel, weekStats } from '../../lib/weekBriefing'
import WeekCoachCard from '../../components/WeekCoachCard'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Progress › Week review: one Monday–Sunday week's numbers and the AI coach's weekly verdict. */
export default function WeekReview() {
  const today = useLocalToday()
  const thisMonday = mondayOf(today)
  const lastDone = lastFinishedMonday(today)
  // Opened on a given week (Coach history › Open week, the weekly recap), else the last finished week.
  const opened = (useLocation().state as { monday?: string } | null)?.monday
  const [monday, setMonday] = useState(() =>
    opened && DATE_RE.test(opened) && mondayOf(opened) <= thisMonday ? mondayOf(opened) : lastDone)
  // Never sit on a week that hasn't started (a day rollover can't move us forward, only make "next" valid).
  useEffect(() => {
    if (monday > thisMonday) setMonday(thisMonday)
  }, [monday, thisMonday])

  const loaded = useLiveQuery(() => gatherWeekBriefing(monday, today), [monday, today])
  // Right after ‹/› the query still holds the previous week: never show (or auto-review) that one.
  const briefing = loaded?.monday === monday ? loaded : undefined
  const stats = briefing ? weekStats(briefing) : null
  const tag = monday === thisMonday ? 'This week · in progress' : monday === lastDone ? 'Last week' : null

  return (
    <div className="pt-4">
      <div className="mb-4 flex items-center gap-2">
        <Link
          to="/progress"
          aria-label="Back"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sub active:bg-muted/40"
        >
          <ChevronLeft size={24} />
        </Link>
        <h1 className="min-w-0 truncate font-display text-3xl font-bold">Week review</h1>
      </div>

      <div className="mb-4 flex items-center justify-between rounded-2xl border border-edge bg-card p-2">
        <button
          onClick={() => setMonday(m => addDays(m, -7))}
          aria-label="Previous week"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sub active:bg-muted/40"
        >
          <ChevronLeft size={22} />
        </button>
        <div className="min-w-0 text-center">
          <p className="num truncate font-display text-xl font-bold">{weekRangeLabel(monday)}</p>
          <p className="truncate text-xs text-sub">{tag ?? 'Monday to Sunday'}</p>
        </div>
        <button
          onClick={() => setMonday(m => addDays(m, 7))}
          disabled={monday >= thisMonday}
          aria-label="Next week"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sub active:bg-muted/40 disabled:opacity-30"
        >
          <ChevronRight size={22} />
        </button>
      </div>

      {briefing && stats && (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Sessions" value={`${stats.sessions}`} sub={`/ ${briefing.weeklyTarget}`} good={stats.sessions >= briefing.weeklyTarget} />
            <Stat label="Points" value={`+${stats.points}`} />
            <Stat label="PRs" value={`${stats.prs}`} good={stats.prs > 0} />
            <Stat label="Protein" value={stats.proteinPerKg !== null ? `${stats.proteinPerKg}` : '—'} sub={stats.proteinPerKg !== null ? 'g/kg' : undefined} />
            <Stat label="Food days" value={`${stats.loggedDays}`} sub="/ 7" />
            <Stat
              label="Bodyweight"
              value={stats.bwRate !== null ? `${stats.bwRate > 0 ? '+' : ''}${stats.bwRate}` : '—'}
              sub={stats.bwRate !== null ? 'kg/wk' : undefined}
            />
          </div>

          <WeekCoachCard key={briefing.monday} briefing={briefing} autoEligible={briefing.monday === lastDone} />

          {briefing.sessions.length > 0 && (
            <section className="mt-4 rounded-2xl border border-edge bg-card p-2">
              <h2 className="px-2 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-sub">Workouts</h2>
              {briefing.sessions.map(s => (
                <Link
                  key={String(s.id)}
                  to={`/workout/summary/${String(s.id)}?report=1`}
                  className="flex items-center gap-2 rounded-xl px-2 py-2.5 active:bg-muted/30"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{s.name}</p>
                    <p className="num truncate text-xs text-sub">
                      {fmtDate(s.date)} · {s.workingSets} sets · {s.volumeKg.toLocaleString('en-US')} kg
                    </p>
                  </div>
                  <span className="num shrink-0 text-sm font-semibold text-primary">+{s.points}</span>
                  <Caret size={16} className="shrink-0 text-sub" aria-hidden />
                </Link>
              ))}
            </section>
          )}

          {briefing.quests.length > 0 && (
            <section className="mt-4 rounded-2xl border border-edge bg-card p-4">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-sub">Weekly quests</h2>
              <ul className="space-y-1.5">
                {briefing.quests.map(q => (
                  <li key={q.label} className="flex items-center gap-2 text-sm">
                    {q.done
                      ? <Check size={16} className="shrink-0 text-accent" aria-label="Done" />
                      : <Target size={16} className="shrink-0 text-sub" aria-label="Not done" />}
                    <span className={`min-w-0 flex-1 ${q.done ? '' : 'text-sub'}`}>{q.label}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <div className="pb-4" />
        </>
      )}
    </div>
  )
}

function Stat({ label, value, sub, good }: { label: string; value: string; sub?: string; good?: boolean }) {
  return (
    <div className="min-w-0 rounded-xl border border-edge bg-card px-2.5 py-2">
      <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-sub">{label}</p>
      <p className="num flex flex-wrap items-baseline gap-x-1">
        <span className={`font-display text-xl font-bold ${good ? 'text-accent' : ''}`}>{value}</span>
        {sub && <span className="whitespace-nowrap text-[11px] text-sub">{sub}</span>}
      </p>
    </div>
  )
}
