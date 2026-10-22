import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft, ChevronUp, ChevronDown, Trash2, Plus, Link2 } from 'lucide-react'
import { db, deleteWithTombstone } from '../../db/db'
import { parseRouteId } from '../../lib/ids'
import NumberStepper from '../../components/NumberStepper'
import { defaultTemplateItem, isCardioExercise } from '../../lib/cardio'
import ExercisePicker from './ExercisePicker'
import { exerciseDisplayName } from '../../lib/exerciseNames'
import { t } from '../../i18n'
import type { Exercise, TemplateItem } from '../../types'

export default function TemplateEditor() {
  const navigate = useNavigate()
  const { id } = useParams()
  const tid = parseRouteId(id)
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

  const addExercise = (e: Exercise) => update({ items: [...template.items, defaultTemplateItem(e)] })

  async function deleteTemplate() {
    if (!window.confirm(t('workout.template.confirmDelete', { name: template!.name }))) return
    await deleteWithTombstone('templates', tid)
    navigate('/workout')
  }

  return (
    <div className="pt-4">
      <div className="mb-4 flex items-center gap-2">
        <button
          onClick={() => navigate('/workout')}
          aria-label={t('common.back')}
          className="flex h-11 w-11 items-center justify-center rounded-xl text-sub active:bg-muted/40"
        >
          <ChevronLeft size={24} />
        </button>
        <input
          value={template.name}
          onChange={e => update({ name: e.target.value })}
          aria-label={t('workout.template.nameAria')}
          className="min-w-0 w-full truncate border-b border-transparent font-display text-2xl font-bold focus:border-primary"
        />
      </div>

      <div className="space-y-3">
        {template.items.map((item, i) => {
          const ex = exMap.get(item.exerciseId)
          return (
            <div key={`${item.exerciseId}-${i}`}>
            <div className={`rounded-2xl border bg-card p-3 ${
              item.supersetWithNext || template.items[i - 1]?.supersetWithNext
                ? 'border-primary/40'
                : 'border-edge'
            }`}>
              <div className="mb-2 flex items-center justify-between gap-1">
                <p className="min-w-0 flex-1 truncate font-display text-lg font-semibold">{ex ? exerciseDisplayName(ex.name) : '…'}</p>
                <div className="flex shrink-0 gap-0.5">
                  <button
                    onClick={() => moveItem(i, -1)}
                    aria-label={t('workout.template.moveUp')}
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-sub active:bg-muted/40"
                  >
                    <ChevronUp size={18} />
                  </button>
                  <button
                    onClick={() => moveItem(i, 1)}
                    aria-label={t('workout.template.moveDown')}
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-sub active:bg-muted/40"
                  >
                    <ChevronDown size={18} />
                  </button>
                  <button
                    onClick={() => removeItem(i)}
                    aria-label={t('workout.template.removeExercise')}
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-danger active:bg-muted/40"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap items-end justify-around gap-x-1 gap-y-2">
                <NumberStepper
                  compact
                  label={t('workout.template.sets')}
                  value={item.targetSets}
                  onChange={v => updateItem(i, { targetSets: Math.round(v) })}
                  step={1}
                  min={1}
                  max={10}
                />
                <NumberStepper
                  compact
                  label={isCardioExercise(ex) ? 'Min' : t('workout.template.reps')}
                  value={item.targetReps}
                  onChange={v => updateItem(i, { targetReps: Math.round(v) })}
                  step={1}
                  min={1}
                  max={isCardioExercise(ex) ? 180 : 50}
                />
                <NumberStepper
                  compact
                  label={t('workout.template.rest')}
                  value={item.restSec ?? ex?.defaultRestSec ?? 90}
                  onChange={v => updateItem(i, { restSec: Math.round(v) })}
                  step={15}
                  min={15}
                  max={600}
                  unit="s"
                />
              </div>
            </div>
            {i < template.items.length - 1 && (
              <div className="relative z-10 -mb-2 -mt-1.5 flex justify-center">
                <button
                  onClick={() => updateItem(i, { supersetWithNext: !item.supersetWithNext })}
                  aria-label={item.supersetWithNext ? t('workout.template.unlinkSuperset') : t('workout.template.linkSuperset')}
                  aria-pressed={!!item.supersetWithNext}
                  className={`flex min-h-[28px] items-center gap-1 whitespace-nowrap rounded-full border px-2.5 text-[10px] font-bold uppercase tracking-wide ${
                    item.supersetWithNext
                      ? 'border-primary/40 bg-bg text-primary'
                      : 'border-edge bg-bg text-sub/60'
                  }`}
                >
                  <Link2 size={11} /> {item.supersetWithNext ? t('workout.shared.superset') : t('workout.template.link')}
                </button>
              </div>
            )}
            </div>
          )
        })}
      </div>

      <button
        onClick={() => setPickerOpen(true)}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-edge py-4 font-medium text-sub active:bg-muted/30"
      >
        <Plus size={20} /> {t('workout.shared.addExercise')}
      </button>

      <button onClick={deleteTemplate} className="mt-8 w-full py-3 text-sm font-medium text-danger">
        {t('workout.template.delete')}
      </button>

      <ExercisePicker open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={addExercise} />
    </div>
  )
}
