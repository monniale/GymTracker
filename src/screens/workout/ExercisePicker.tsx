import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Search, Plus } from 'lucide-react'
import { db } from '../../db/db'
import Sheet from '../../components/Sheet'
import type { Exercise, MuscleGroup } from '../../types'

const MUSCLES: MuscleGroup[] = [
  'chest', 'back', 'shoulders', 'biceps', 'triceps', 'legs', 'glutes', 'core', 'cardio', 'other',
]

interface Props {
  open: boolean
  onClose: () => void
  onPick: (exercise: Exercise) => void
}

export default function ExercisePicker({ open, onClose, onPick }: Props) {
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)
  const exercises = useLiveQuery(() => db.exercises.orderBy('nameLower').toArray()) ?? []

  const query = q.trim().toLowerCase()
  const filtered = query ? exercises.filter(e => e.nameLower.includes(query)) : exercises
  const exactMatch = exercises.some(e => e.nameLower === query)

  async function createCustom(muscle: MuscleGroup) {
    const name = q.trim()
    const id = await db.exercises.add({
      name,
      nameLower: name.toLowerCase(),
      muscleGroup: muscle,
      defaultRestSec: 90,
      isCustom: true,
    })
    const created = await db.exercises.get(id)
    setQ('')
    setCreating(false)
    if (created) {
      onPick(created)
      onClose()
    }
  }

  function pick(e: Exercise) {
    setQ('')
    setCreating(false)
    onPick(e)
    onClose()
  }

  return (
    <Sheet open={open} onClose={onClose} title="Add exercise">
      <div className="mb-3 flex items-center gap-2 rounded-xl bg-card px-3">
        <Search size={18} className="shrink-0 text-sub" />
        <input
          value={q}
          onChange={e => {
            setQ(e.target.value)
            setCreating(false)
          }}
          placeholder="Search exercises…"
          className="min-h-[48px] w-full text-base"
        />
      </div>

      {query && !exactMatch && (
        <div className="mb-3">
          {creating ? (
            <div className="rounded-xl border border-primary/40 bg-card p-3">
              <p className="mb-2 text-sm font-medium">
                Muscle group for <span className="text-primary">“{q.trim()}”</span>:
              </p>
              <div className="flex flex-wrap gap-2">
                {MUSCLES.map(m => (
                  <button
                    key={m}
                    onClick={() => createCustom(m)}
                    className="min-h-[40px] rounded-full bg-muted/40 px-3 text-sm font-medium capitalize active:bg-muted"
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <button
              onClick={() => setCreating(true)}
              className="flex w-full items-center gap-2 rounded-xl border border-dashed border-primary/50 px-3 py-3 text-left font-medium text-primary active:bg-muted/30"
            >
              <Plus size={18} /> Create “{q.trim()}”
            </button>
          )}
        </div>
      )}

      <ul className="divide-y divide-edge/50">
        {filtered.map(e => (
          <li key={e.id}>
            <button
              onClick={() => pick(e)}
              className="flex min-h-[52px] w-full items-center justify-between px-1 py-2 text-left active:bg-muted/30"
            >
              <span className="font-medium">{e.name}</span>
              <span className="rounded-full bg-muted/40 px-2 py-0.5 text-xs capitalize text-sub">
                {e.muscleGroup}
              </span>
            </button>
          </li>
        ))}
        {filtered.length === 0 && !query && (
          <li className="py-6 text-center text-sm text-sub">No exercises yet.</li>
        )}
      </ul>
    </Sheet>
  )
}
