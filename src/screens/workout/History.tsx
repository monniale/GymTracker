import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft, ChevronDown, ChevronUp, Trash2, Sparkles } from 'lucide-react'
import { db, tombstoneKeys } from '../../db/db'
import { fmtDateTime, fmtDuration } from '../../lib/dates'
import type { Session } from '../../types'

export default function History() {
  const sessions = useLiveQuery(async () => {
    const all = await db.sessions.orderBy('startedAt').reverse().toArray()
    return all.filter(s => s.endedAt !== undefined)
  })

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
        <h1 className="font-display text-3xl font-bold">History</h1>
      </div>

      {sessions?.length === 0 && (
        <p className="py-10 text-center text-sub">No finished sessions yet. Go lift something!</p>
      )}

      <div className="space-y-2">
        {sessions?.map(s => <SessionRow key={s.id} session={s} />)}
      </div>
    </div>
  )
}

function SessionRow({ session }: { session: Session }) {
  const [open, setOpen] = useState(false)
  const detail = useLiveQuery(async () => {
    if (!open) return null
    const sets = await db.sets.where('sessionId').equals(session.id!).toArray()
    const exIds = [...new Set(sets.map(s => s.exerciseId))]
    const exercises = await db.exercises.bulkGet(exIds)
    const names = new Map(exIds.map((id, i) => [id, exercises[i]?.name ?? 'Exercise']))
    return exIds.map(id => ({
      name: names.get(id)!,
      sets: sets.filter(s => s.exerciseId === id).sort((a, b) => a.setNumber - b.setNumber),
    }))
  }, [open, session.id])

  async function remove() {
    if (!window.confirm('Delete this session? Its sets are removed too (earned points are kept).')) return
    await db.transaction('rw', db.sets, db.sessions, db.scoreEvents, db.tombstones, async () => {
      const setKeys = await db.sets.where('sessionId').equals(session.id!).primaryKeys()
      const eventKeys = await db.scoreEvents.where('sessionId').equals(session.id!).primaryKeys()
      await db.sets.where('sessionId').equals(session.id!).delete()
      await db.scoreEvents.where('sessionId').equals(session.id!).delete()
      await db.sessions.delete(session.id!)
      await tombstoneKeys('sets', setKeys)
      await tombstoneKeys('scoreEvents', eventKeys)
      await tombstoneKeys('sessions', [session.id!])
    })
  }

  return (
    <div className="rounded-2xl border border-edge bg-card">
      <div className="flex items-center">
        <button
          onClick={() => setOpen(o => !o)}
          className="flex min-w-0 flex-1 items-center gap-3 p-4 text-left"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-lg font-semibold">{session.name}</p>
            <p className="text-sm text-sub">
              {fmtDateTime(session.startedAt)}
              {session.endedAt && ` · ${fmtDuration(session.endedAt - session.startedAt)}`}
            </p>
          </div>
          {session.points !== undefined && (
            <span className="num rounded-full bg-primary/15 px-2.5 py-1 text-sm font-bold text-primary">
              +{session.points}
            </span>
          )}
          {open ? <ChevronUp size={18} className="text-sub" /> : <ChevronDown size={18} className="text-sub" />}
        </button>
        <Link
          to={`/workout/summary/${session.id}?report=1`}
          aria-label="View AI report"
          className="mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-primary active:bg-muted/40"
        >
          <Sparkles size={18} />
        </Link>
      </div>

      {open && detail && (
        <div className="border-t border-edge/60 px-4 py-3">
          {detail.map(d => (
            <div key={d.name} className="mb-2">
              <p className="text-sm font-semibold">{d.name}</p>
              <p className="num text-sm text-sub">
                {d.sets.map(s => `${s.weightKg}×${s.reps}${s.isWarmup ? 'w' : ''}`).join('  ·  ')}
              </p>
            </div>
          ))}
          <button
            onClick={remove}
            className="mt-1 flex items-center gap-1.5 py-2 text-sm font-medium text-danger"
          >
            <Trash2 size={16} /> Delete session
          </button>
        </div>
      )}
    </div>
  )
}
