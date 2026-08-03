import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft, ChevronRight, Sparkles, ChevronRight as Caret } from 'lucide-react'
import { db } from '../../db/db'
import {
  localDateStr, monthGrid, monthLabel, addMonths, sameMonth, startOfMonth,
  fmtDate, fmtDateTime, fmtDuration, parseLocalDate, WEEKDAY_LABELS,
} from '../../lib/dates'
import type { Session } from '../../types'

export default function History() {
  const navigate = useNavigate()
  const today = localDateStr()
  const [month, setMonth] = useState(() => startOfMonth(today))
  const [selected, setSelected] = useState<string | null>(null)

  const sessions = useLiveQuery(async () => {
    const all = await db.sessions.orderBy('startedAt').reverse().toArray()
    return all.filter(s => s.endedAt !== undefined)
  })

  // Bucket finished sessions by their local date.
  const byDay = useMemo(() => {
    const map = new Map<string, Session[]>()
    for (const s of sessions ?? []) {
      const key = localDateStr(new Date(s.startedAt))
      const list = map.get(key) ?? []
      list.push(s)
      map.set(key, list)
    }
    return map
  }, [sessions])

  const grid = useMemo(() => monthGrid(month), [month])
  const listed = selected ? (byDay.get(selected) ?? []) : (sessions ?? [])

  return (
    <div className="pt-4">
      <div className="mb-4 flex items-center gap-2">
        <Link
          to="/workout"
          aria-label="Back"
          className="flex h-11 w-11 items-center justify-center rounded-xl text-sub active:bg-muted/40"
        >
          <ChevronLeft size={24} />
        </Link>
        <h1 className="font-display text-3xl font-bold">Past workouts</h1>
      </div>

      {/* Month calendar */}
      <div className="mb-4 rounded-2xl border border-edge bg-card p-3">
        <div className="mb-2 flex items-center justify-between">
          <button
            onClick={() => setMonth(m => addMonths(m, -1))}
            aria-label="Previous month"
            className="flex h-10 w-10 items-center justify-center rounded-xl text-sub active:bg-muted/40"
          >
            <ChevronLeft size={22} />
          </button>
          <button
            onClick={() => setMonth(startOfMonth(today))}
            className="font-display text-lg font-semibold active:opacity-70"
          >
            {monthLabel(month)}
          </button>
          <button
            onClick={() => setMonth(m => addMonths(m, 1))}
            aria-label="Next month"
            className="flex h-10 w-10 items-center justify-center rounded-xl text-sub active:bg-muted/40"
          >
            <ChevronRight size={22} />
          </button>
        </div>

        <div className="mb-1 grid grid-cols-7 text-center text-[11px] font-semibold uppercase tracking-wide text-sub">
          {WEEKDAY_LABELS.map(d => <span key={d}>{d}</span>)}
        </div>

        <div className="grid grid-cols-7 gap-0.5">
          {grid.map(day => {
            const inMonth = sameMonth(day, month)
            const has = byDay.has(day)
            const isToday = day === today
            const isSelected = day === selected
            return (
              <button
                key={day}
                onClick={() => has && setSelected(isSelected ? null : day)}
                disabled={!has}
                aria-label={has ? `${fmtDate(day)}, ${byDay.get(day)!.length} workout(s)` : undefined}
                aria-pressed={isSelected}
                className={`num relative flex h-11 flex-col items-center justify-center rounded-lg text-sm ${
                  isSelected ? 'bg-primary text-bg font-bold'
                    : has ? 'bg-primary/15 font-semibold text-primary active:bg-primary/30'
                      : inMonth ? 'text-ink' : 'text-sub/40'
                } ${isToday && !isSelected ? 'ring-1 ring-inset ring-primary/60' : ''}`}
              >
                {parseLocalDate(day).getDate()}
                {has && !isSelected && (
                  <span className="absolute bottom-1 h-1 w-1 rounded-full bg-primary" aria-hidden />
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Selected-day header / clear */}
      {selected && (
        <div className="mb-2 flex items-center justify-between">
          <p className="font-display text-lg font-semibold">{fmtDate(selected)}</p>
          <button onClick={() => setSelected(null)} className="text-sm font-medium text-sub active:text-ink">
            Show all
          </button>
        </div>
      )}

      {sessions !== undefined && listed.length === 0 && (
        <p className="py-10 text-center text-sub">
          {selected ? 'No workout on this day.' : 'No finished sessions yet. Go lift something!'}
        </p>
      )}

      <div className="space-y-2">
        {listed.map(s => (
          <div key={s.id} className="flex items-center rounded-2xl border border-edge bg-card">
            <button
              onClick={() => navigate(`/workout/past/${s.id}`)}
              className="flex min-w-0 flex-1 items-center gap-3 p-4 text-left"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-lg font-semibold">{s.name}</p>
                <p className="text-sm text-sub">
                  {fmtDateTime(s.startedAt)}
                  {s.endedAt && ` · ${fmtDuration(s.endedAt - s.startedAt)}`}
                </p>
              </div>
              {s.points !== undefined && (
                <span className="num rounded-full bg-primary/15 px-2.5 py-1 text-sm font-bold text-primary">
                  +{s.points}
                </span>
              )}
              <Caret size={18} className="shrink-0 text-sub" />
            </button>
            <Link
              to={`/workout/summary/${s.id}?report=1`}
              aria-label="View AI report"
              className="mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-primary active:bg-muted/40"
            >
              <Sparkles size={18} />
            </Link>
          </div>
        ))}
      </div>
    </div>
  )
}
