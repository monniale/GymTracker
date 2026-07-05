import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft, ChevronUp, ChevronDown, Trash2, Plus } from 'lucide-react'
import { db } from '../../db/db'
import NumberStepper from '../../components/NumberStepper'
import ExercisePicker from './ExercisePicker'
import type { Exercise, TemplateItem } from '../../types'

export default function TemplateEditor() {
  const navigate = useNavigate()
  const { id } = useParams()
  const tid = Number(id)
  const template = useLiveQuery(() => db.templates.get(tid), [tid])
  const exercises = useLiveQuery(() => db.exercises.toArray()) ?? []
  const exMap = useMemo(() => new Map(exercises.map(e => [e.id!, e])), [exercises])
  const [pickerOpen, setPickerOpen] = useState(false)

  if (!template) return null

  const update = (patch: Partial<typeof template>) =>
    db.templates.update(tid, { ...patch, updatedAt: Date.now() })

  const updateItem = (index: number, patch: Partial<TemplateItem>) => {
    const items = template.items.map((it, i) => (i === index ? { ...it, ...patch } : it))
    void update({ items })
  }

  const moveItem = (index: number, dir: -1 | 1) => {
    const items = [...template.items]
    const j = index + dir
    if (j < 0 || j >= items.length) return
    ;[items[index], items[j]] = [items[j], items[index]]
    void update({ items })
  }

  const removeItem = (index: number) =>
    update({ items: template.items.filter((_, i) => i !== index) })

  const addExercise = (e: Exercise) =>
    update({
      items: [
        ...template.items,
        { exerciseId: e.id!, targetSets: 3, targetReps: 8, restSec: e.defaultRestSec },
      ],
    })

  async function deleteTemplate() {
    if (!window.confirm(`Delete workout “${template!.name}”? Logged sessions are kept.`)) return
    await db.templates.delete(tid)
    navigate('/workout')
  }

  return (
    <div className="pt-4">
      <div className="mb-4 flex items-center gap-2">
        <button
          onClick={() => navigate('/workout')}
          aria-label="Back"
          className="flex h-11 w-11 items-center justify-center rounded-xl text-sub active:bg-muted/40"
        >
          <ChevronLeft size={24} />
        </button>
        <input
          value={template.name}
          onChange={e => update({ name: e.target.value })}
          aria-label="Workout name"
          className="w-full border-b border-transparent font-display text-2xl font-bold focus:border-primary"
        />
      </div>

      <div className="space-y-3">
        {template.items.map((item, i) => {
          const ex = exMap.get(item.exerciseId)
          return (
            <div key={`${item.exerciseId}-${i}`} className="rounded-2xl border border-edge bg-card p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="font-display text-lg font-semibold">{ex?.name ?? '…'}</p>
                <div className="flex gap-1">
                  <button
                    onClick={() => moveItem(i, -1)}
                    aria-label="Move up"
                    className="flex h-10 w-10 items-center justify-center rounded-lg text-sub active:bg-muted/40"
                  >
                    <ChevronUp size={18} />
                  </button>
                  <button
                    onClick={() => moveItem(i, 1)}
                    aria-label="Move down"
                    className="flex h-10 w-10 items-center justify-center rounded-lg text-sub active:bg-muted/40"
                  >
                    <ChevronDown size={18} />
                  </button>
                  <button
                    onClick={() => removeItem(i)}
                    aria-label="Remove exercise"
                    className="flex h-10 w-10 items-center justify-center rounded-lg text-danger active:bg-muted/40"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
              <div className="flex justify-between gap-2">
                <NumberStepper
                  label="Sets"
                  value={item.targetSets}
                  onChange={v => updateItem(i, { targetSets: Math.round(v) })}
                  step={1}
                  min={1}
                  max={10}
                />
                <NumberStepper
                  label="Reps"
                  value={item.targetReps}
                  onChange={v => updateItem(i, { targetReps: Math.round(v) })}
                  step={1}
                  min={1}
                  max={50}
                />
                <NumberStepper
                  label="Rest"
                  value={item.restSec ?? ex?.defaultRestSec ?? 90}
                  onChange={v => updateItem(i, { restSec: Math.round(v) })}
                  step={15}
                  min={15}
                  max={600}
                  unit="s"
                />
              </div>
            </div>
          )
        })}
      </div>

      <button
        onClick={() => setPickerOpen(true)}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-edge py-4 font-medium text-sub active:bg-muted/30"
      >
        <Plus size={20} /> Add exercise
      </button>

      <button onClick={deleteTemplate} className="mt-8 w-full py-3 text-sm font-medium text-danger">
        Delete workout
      </button>

      <ExercisePicker open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={addExercise} />
    </div>
  )
}
