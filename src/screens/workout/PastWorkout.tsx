import { useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft, Plus, Pencil, Trash2 } from 'lucide-react'
import { db, tombstoneKeys } from '../../db/db'
import { parseRouteId } from '../../lib/ids'
import { epley } from '../../lib/scoring'
import { rescoreSession } from '../../lib/finishSession'
import { fmtDate, fmtDateTime, localDateStr, parseLocalDate } from '../../lib/dates'
import Sheet from '../../components/Sheet'
import NumberStepper from '../../components/NumberStepper'
import { EQUIPMENT_LABEL } from '../../lib/equipment'
import type { Equipment, Exercise, SetRow } from '../../types'

/** View & edit a finished workout: per-set weight/reps, add/remove sets, and
 * session details. Every change re-scores the session (points/PRs + rank delta). */
export default function PastWorkout() {
  const { id } = useParams()
  const navigate = useNavigate()
  const sid = parseRouteId(id)

  const session = useLiveQuery(async () => (sid != null ? await db.sessions.get(sid) : undefined), [id])
  const sets = useLiveQuery(
    async () => (sid != null ? await db.sets.where('sessionId').equals(sid).toArray() : []),
    [id],
  ) ?? []
  const exercises = useLiveQuery(() => db.exercises.toArray()) ?? []
  const exMap = useMemo(() => new Map(exercises.map(e => [e.id!, e])), [exercises])

  const [editSet, setEditSet] = useState<SetRow | null>(null)
  const [editDetails, setEditDetails] = useState(false)
  const [busy, setBusy] = useState(false)

  // Group by exercise in first-logged order; sets sorted by setNumber.
  const groups = useMemo(() => {
    const order: unknown[] = []
    const seen = new Set<string>()
    for (const s of [...sets].sort((a, b) => a.completedAt - b.completedAt)) {
      if (!seen.has(String(s.exerciseId))) { seen.add(String(s.exerciseId)); order.push(s.exerciseId) }
    }
    return order.map(exId => ({
      exercise: exMap.get(exId as never),
      exId,
      rows: sets.filter(s => s.exerciseId === exId).sort((a, b) => a.setNumber - b.setNumber),
    }))
  }, [sets, exMap])

  if (session === undefined) return null
  if (session === null || sid == null) return <Navigate to="/workout/history" replace />

  async function addSet(exId: SetRow['exerciseId'], rows: SetRow[]) {
    if (busy) return // guard against a double-tap adding two sets / double-rescoring
    setBusy(true)
    try {
      const last = rows[rows.length - 1]
      const weightKg = last?.weightKg ?? 0
      const reps = last?.reps ?? 8
      await db.sets.add({
        sessionId: sid!,
        exerciseId: exId,
        setNumber: rows.length + 1,
        weightKg,
        reps,
        isWarmup: false,
        completedAt: (last?.completedAt ?? Date.now()) + 1,
        e1rm: epley(weightKg, reps),
      })
      await rescoreSession(sid!)
    } finally {
      setBusy(false)
    }
  }

  async function deleteWorkout() {
    if (!window.confirm('Delete this whole workout? Its sets are removed (earned points are kept).')) return
    await db.transaction('rw', db.sets, db.sessions, db.scoreEvents, db.tombstones, async () => {
      const setKeys = await db.sets.where('sessionId').equals(sid!).primaryKeys()
      const eventKeys = await db.scoreEvents.where('sessionId').equals(sid!).primaryKeys()
      await db.sets.where('sessionId').equals(sid!).delete()
      await db.scoreEvents.where('sessionId').equals(sid!).delete()
      await db.sessions.delete(sid!)
      await tombstoneKeys('sets', setKeys)
      await tombstoneKeys('scoreEvents', eventKeys)
      await tombstoneKeys('sessions', [sid!])
    })
    navigate('/workout/history', { replace: true })
  }

  return (
    <div className="pt-4">
      <div className="mb-4 flex items-center gap-2">
        <Link
          to="/workout/history"
          aria-label="Back to past workouts"
          className="flex h-11 w-11 items-center justify-center rounded-xl text-sub active:bg-muted/40"
        >
          <ChevronLeft size={24} />
        </Link>
        <h1 className="min-w-0 flex-1 truncate font-display text-2xl font-bold">{session.name}</h1>
        {session.points !== undefined && (
          <span className="num rounded-full bg-primary/15 px-2.5 py-1 text-sm font-bold text-primary">
            +{session.points}
          </span>
        )}
      </div>

      {/* Details */}
      <button
        onClick={() => setEditDetails(true)}
        className="mb-4 flex w-full items-center gap-2 rounded-2xl border border-edge bg-card p-4 text-left active:bg-muted/20"
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm text-sub">{fmtDateTime(session.startedAt)}</p>
          <p className="num text-sm text-sub">Bodyweight {session.bodyweightKg} kg</p>
        </div>
        <Pencil size={16} className="shrink-0 text-sub" />
      </button>

      {/* Exercises */}
      <div className="space-y-4">
        {groups.map(({ exercise, exId, rows }) => (
          <div key={String(exId)} className="rounded-2xl border border-edge bg-card p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="min-w-0 flex-1 truncate font-display text-lg font-semibold">
                {exercise?.name ?? 'Exercise'}
              </p>
              {exercise?.equipment && <EquipmentBadge equipment={exercise.equipment} />}
            </div>
            <div className="space-y-1.5">
              {rows.map(s => (
                <button
                  key={s.id}
                  onClick={() => setEditSet(s)}
                  className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left active:bg-muted/30 ${
                    s.isWarmup ? 'bg-muted/20 text-sub' : 'bg-accent/10'
                  }`}
                >
                  <span className="num w-6 text-sm font-semibold text-sub">{s.setNumber}</span>
                  <span className="num flex-1 font-display text-lg font-semibold">
                    {s.weightKg} kg × {s.reps}
                    {s.isWarmup && <span className="ml-2 text-xs font-medium text-sub">warm-up</span>}
                  </span>
                  <Pencil size={15} className="shrink-0 text-sub" />
                </button>
              ))}
            </div>
            <button
              onClick={() => void addSet(exId as SetRow['exerciseId'], rows)}
              disabled={busy}
              className="mt-2 flex min-h-[40px] items-center gap-1 px-1 text-sm font-medium text-sub active:text-ink disabled:opacity-50"
            >
              <Plus size={16} /> Add set
            </button>
          </div>
        ))}
        {groups.length === 0 && (
          <p className="py-8 text-center text-sm text-sub">No sets in this workout.</p>
        )}
      </div>

      <button
        onClick={() => void deleteWorkout()}
        className="mt-6 flex items-center gap-1.5 py-2 text-sm font-medium text-danger"
      >
        <Trash2 size={16} /> Delete workout
      </button>

      {editSet && (
        <SetSheet
          key={String(editSet.id)}
          set={editSet}
          exercise={exMap.get(editSet.exerciseId)}
          onClose={() => setEditSet(null)}
          onRescore={() => rescoreSession(sid!)}
        />
      )}
      {editDetails && (
        <DetailsSheet
          session={session}
          onClose={() => setEditDetails(false)}
          onRescore={() => rescoreSession(sid!)}
        />
      )}
    </div>
  )
}

function EquipmentBadge({ equipment }: { equipment: Equipment }) {
  return (
    <span className="shrink-0 rounded-full bg-muted/40 px-2 py-0.5 text-xs font-medium text-sub">
      {EQUIPMENT_LABEL[equipment]}
    </span>
  )
}

function SetSheet({
  set, exercise, onClose, onRescore,
}: {
  set: SetRow
  exercise?: Exercise
  onClose: () => void
  onRescore: () => Promise<unknown>
}) {
  const [weight, setWeight] = useState(set.weightKg)
  const [reps, setReps] = useState(set.reps)
  const [warmup, setWarmup] = useState(set.isWarmup)
  const [busy, setBusy] = useState(false)

  async function save() {
    if (busy) return
    setBusy(true)
    try {
      await db.sets.update(set.id!, { weightKg: weight, reps, isWarmup: warmup, e1rm: epley(weight, reps) })
      await onRescore()
      onClose()
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (busy) return
    setBusy(true)
    try {
      await db.transaction('rw', db.sets, db.tombstones, async () => {
        await db.sets.delete(set.id!)
        await db.tombstones.add({ table: 'sets', rowId: set.id!, deletedAt: Date.now() })
        // Renumber remaining sets of this exercise so setNumbers stay 1..n.
        const rest = await db.sets
          .where('sessionId').equals(set.sessionId)
          .filter(s => s.exerciseId === set.exerciseId)
          .sortBy('setNumber')
        for (let i = 0; i < rest.length; i++) {
          if (rest[i].setNumber !== i + 1) await db.sets.update(rest[i].id!, { setNumber: i + 1 })
        }
      })
      await onRescore()
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open onClose={onClose} title={`${exercise?.name ?? 'Set'} · set ${set.setNumber}`}>
      <div className="space-y-4">
        <div className="flex justify-around">
          <NumberStepper label="kg" value={weight} onChange={setWeight} step={2.5} min={0} max={600} />
          <NumberStepper label="reps" value={reps} onChange={setReps} step={1} min={0} max={100} />
        </div>
        <button
          onClick={() => setWarmup(w => !w)}
          aria-pressed={warmup}
          className={`flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-xl text-sm font-semibold ${
            warmup ? 'bg-muted text-ink' : 'bg-muted/30 text-sub'
          }`}
        >
          {warmup ? 'Warm-up set' : 'Working set'}
        </button>
        <button
          onClick={() => void save()}
          disabled={busy}
          className="w-full rounded-2xl bg-primary py-3.5 font-display text-lg font-bold text-bg active:opacity-90 disabled:opacity-50"
        >
          Save
        </button>
        <button
          onClick={() => void remove()}
          disabled={busy}
          className="flex w-full items-center justify-center gap-1.5 py-2 text-sm font-medium text-danger disabled:opacity-50"
        >
          <Trash2 size={16} /> Delete set
        </button>
      </div>
    </Sheet>
  )
}

function DetailsSheet({
  session, onClose, onRescore,
}: {
  session: { id?: SetRow['sessionId']; name: string; startedAt: number; endedAt?: number; bodyweightKg: number }
  onClose: () => void
  onRescore: () => Promise<unknown>
}) {
  const [name, setName] = useState(session.name)
  const [dateStr, setDateStr] = useState(localDateStr(new Date(session.startedAt)))
  const [bw, setBw] = useState(session.bodyweightKg)

  const [busy, setBusy] = useState(false)

  async function save() {
    if (busy) return
    setBusy(true)
    try {
      // Move the workout to the chosen date, preserving time-of-day and duration.
      const orig = new Date(session.startedAt)
      const target = parseLocalDate(dateStr)
      target.setHours(orig.getHours(), orig.getMinutes(), orig.getSeconds(), 0)
      const newStart = target.getTime()
      const delta = newStart - session.startedAt
      await db.transaction('rw', db.sessions, db.sets, async () => {
        await db.sessions.update(session.id!, {
          name: name.trim() || session.name,
          bodyweightKg: bw,
          startedAt: newStart,
          ...(session.endedAt !== undefined ? { endedAt: session.endedAt + delta } : {}),
        })
        // Keep each set's completedAt aligned with the new date, so muscle-volume,
        // progress charts and season PR queries (all keyed on completedAt) move too.
        if (delta !== 0) {
          const rows = await db.sets.where('sessionId').equals(session.id!).toArray()
          for (const r of rows) await db.sets.update(r.id!, { completedAt: r.completedAt + delta })
        }
      })
      await onRescore()
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open onClose={onClose} title="Workout details">
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-sub">Name</span>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            className="min-h-[48px] w-full rounded-xl bg-card px-3 text-base"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-sub">Date</span>
          <input
            type="date"
            value={dateStr}
            onChange={e => e.target.value && setDateStr(e.target.value)}
            className="num min-h-[48px] w-full rounded-xl bg-card px-3 text-base"
          />
          <span className="mt-1 block text-xs text-sub">Was {fmtDate(localDateStr(new Date(session.startedAt)))}</span>
        </label>
        <div className="flex justify-center">
          <NumberStepper label="bodyweight" value={bw} onChange={setBw} step={0.5} min={30} max={300} unit="kg" />
        </div>
        <button
          onClick={() => void save()}
          disabled={busy}
          className="w-full rounded-2xl bg-primary py-3.5 font-display text-lg font-bold text-bg active:opacity-90 disabled:opacity-50"
        >
          Save
        </button>
      </div>
    </Sheet>
  )
}
