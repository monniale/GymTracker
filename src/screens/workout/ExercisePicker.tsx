import { useState } from 'react'
import { Plus } from 'lucide-react'
import { db } from '../../db/db'
import Sheet from '../../components/Sheet'
import ExerciseBrowser from '../../components/library/ExerciseBrowser'
import { EQUIPMENTS, EQUIPMENT_LABEL, MUSCLE_GROUPS, muscleGroupLabel } from '../../lib/equipment'
import { t } from '../../i18n'
import type { Equipment, Exercise, MuscleGroup } from '../../types'

interface Props {
  open: boolean
  onClose: () => void
  onPick: (exercise: Exercise) => void
}

/** "Add exercise": my exercises + the exercise library (ExerciseBrowser), or a new custom one. */
export default function ExercisePicker({ open, onClose, onPick }: Props) {
  const [creating, setCreating] = useState(false)
  const [newMuscle, setNewMuscle] = useState<MuscleGroup | null>(null)
  const [newEquip, setNewEquip] = useState<Equipment>('barbell')
  const [saving, setSaving] = useState(false)

  function resetCreate() {
    setCreating(false)
    setNewMuscle(null)
    setNewEquip('barbell')
  }

  async function createCustom(name: string) {
    if (!name || !newMuscle || saving) return
    setSaving(true)
    let created: Exercise | undefined
    try {
      const id = await db.exercises.add({
        name,
        nameLower: name.toLowerCase(),
        muscleGroup: newMuscle,
        equipment: newEquip,
        defaultRestSec: 90,
        isCustom: true,
      })
      created = await db.exercises.get(id)
    } finally {
      setSaving(false)
    }
    resetCreate()
    if (created) {
      onPick(created)
      onClose()
    }
  }

  function pick(e: Exercise) {
    resetCreate()
    onPick(e)
    onClose()
  }

  function close() {
    resetCreate()
    onClose()
  }

  const renderCreate = (name: string) => (
    <div className="mb-3">
      {creating ? (
        <div className="rounded-xl border border-primary/40 bg-card p-3">
          <p className="mb-2 text-sm font-medium">
            {t('workout.picker.newExercise')} <span className="text-primary">“{name}”</span>
          </p>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-sub">{t('workout.picker.muscleGroup')}</p>
          <div className="mb-3 flex flex-wrap gap-2">
            {MUSCLE_GROUPS.map(m => (
              <button
                key={m}
                onClick={() => setNewMuscle(m)}
                className={`min-h-[40px] whitespace-nowrap rounded-full px-3 text-sm font-medium ${
                  newMuscle === m ? 'bg-primary text-bg' : 'bg-muted/40 text-sub active:bg-muted'
                }`}
              >
                {muscleGroupLabel(m)}
              </button>
            ))}
          </div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-sub">{t('workout.shared.equipment')}</p>
          <div className="mb-3 flex flex-wrap gap-2">
            {EQUIPMENTS.map(eq => (
              <button
                key={eq}
                onClick={() => setNewEquip(eq)}
                className={`min-h-[40px] whitespace-nowrap rounded-full px-3 text-sm font-medium ${
                  newEquip === eq ? 'bg-primary text-bg' : 'bg-muted/40 text-sub active:bg-muted'
                }`}
              >
                {EQUIPMENT_LABEL[eq]}
              </button>
            ))}
          </div>
          <button
            onClick={() => void createCustom(name)}
            disabled={!newMuscle || saving}
            className="w-full rounded-xl bg-primary py-3 font-display text-base font-bold text-bg active:opacity-90 disabled:opacity-40"
          >
            {t('workout.picker.create')}
          </button>
        </div>
      ) : (
        <button
          onClick={() => setCreating(true)}
          className="flex w-full items-center gap-2 rounded-xl border border-dashed border-primary/50 px-3 py-3 text-left font-medium text-primary active:bg-muted/30"
        >
          <Plus size={18} className="shrink-0" />
          <span className="min-w-0 truncate">{t('workout.picker.createNamed', { name })}</span>
        </button>
      )}
    </div>
  )

  return (
    <Sheet open={open} onClose={close} title={t('workout.shared.addExercise')}>
      <ExerciseBrowser mode="pick" onPick={pick} renderCreate={renderCreate} onQueryChange={resetCreate} />
    </Sheet>
  )
}
