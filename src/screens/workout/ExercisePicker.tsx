import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Search, Plus } from 'lucide-react'
import { db } from '../../db/db'
import Sheet from '../../components/Sheet'
import { EQUIPMENTS, EQUIPMENT_LABEL, muscleGroupLabel } from '../../lib/equipment'
import { exerciseDisplayName } from '../../lib/exerciseNames'
import { t } from '../../i18n'
import type { Equipment, Exercise, MuscleGroup } from '../../types'

const MUSCLES: MuscleGroup[] = [
  'chest', 'back', 'shoulders', 'biceps', 'triceps', 'legs', 'glutes', 'core', 'cardio', 'other',
]

const muscleLabel = (m: MuscleGroup): string => muscleGroupLabel(m)

interface Props {
  open: boolean
  onClose: () => void
  onPick: (exercise: Exercise) => void
}

export default function ExercisePicker({ open, onClose, onPick }: Props) {
  const [q, setQ] = useState('')
  const [equipFilter, setEquipFilter] = useState<Equipment | 'all'>('all')
  const [creating, setCreating] = useState(false)
  const [newMuscle, setNewMuscle] = useState<MuscleGroup | null>(null)
  const [newEquip, setNewEquip] = useState<Equipment>('barbell')
  const exercises = useLiveQuery(() => db.exercises.orderBy('nameLower').toArray()) ?? []

  const query = q.trim().toLowerCase()
  // Search matches the stored (English) name and the name shown in the UI language; the list
  // follows the shown name (in English that is the nameLower order the query returns).
  const filtered = exercises
    .map(e => ({ e, label: exerciseDisplayName(e.name) }))
    .filter(({ e, label }) =>
      (!query || e.nameLower.includes(query) || label.toLowerCase().includes(query)) &&
      (equipFilter === 'all' || e.equipment === equipFilter))
    .sort((a, b) => {
      const x = a.label.toLowerCase()
      const y = b.label.toLowerCase()
      return x < y ? -1 : x > y ? 1 : 0
    })
  // A catalog exercise typed by its displayed (e.g. Italian) name is a match too: no duplicate custom.
  const exactMatch = exercises.some(e => e.nameLower === query || exerciseDisplayName(e.name).toLowerCase() === query)

  function resetCreate() {
    setCreating(false)
    setNewMuscle(null)
    setNewEquip('barbell')
  }

  async function createCustom() {
    const name = q.trim()
    if (!name || !newMuscle) return
    const id = await db.exercises.add({
      name,
      nameLower: name.toLowerCase(),
      muscleGroup: newMuscle,
      equipment: newEquip,
      defaultRestSec: 90,
      isCustom: true,
    })
    const created = await db.exercises.get(id)
    setQ('')
    resetCreate()
    if (created) {
      onPick(created)
      onClose()
    }
  }

  function pick(e: Exercise) {
    setQ('')
    resetCreate()
    onPick(e)
    onClose()
  }

  return (
    <Sheet open={open} onClose={onClose} title={t('workout.shared.addExercise')}>
      <div className="mb-3 flex items-center gap-2 rounded-xl bg-card px-3">
        <Search size={18} className="shrink-0 text-sub" />
        <input
          value={q}
          onChange={e => { setQ(e.target.value); resetCreate() }}
          placeholder={t('workout.picker.search')}
          className="min-h-[48px] w-full text-base"
        />
      </div>

      {/* Equipment filter */}
      <div className="mb-3 -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        <Chip active={equipFilter === 'all'} onClick={() => setEquipFilter('all')}>{t('workout.picker.all')}</Chip>
        {EQUIPMENTS.map(eq => (
          <Chip key={eq} active={equipFilter === eq} onClick={() => setEquipFilter(eq)}>
            {EQUIPMENT_LABEL[eq]}
          </Chip>
        ))}
      </div>

      {query && !exactMatch && (
        <div className="mb-3">
          {creating ? (
            <div className="rounded-xl border border-primary/40 bg-card p-3">
              <p className="mb-2 text-sm font-medium">
                {t('workout.picker.newExercise')} <span className="text-primary">“{q.trim()}”</span>
              </p>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-sub">{t('workout.picker.muscleGroup')}</p>
              <div className="mb-3 flex flex-wrap gap-2">
                {MUSCLES.map(m => (
                  <button
                    key={m}
                    onClick={() => setNewMuscle(m)}
                    className={`min-h-[40px] whitespace-nowrap rounded-full px-3 text-sm font-medium ${
                      newMuscle === m ? 'bg-primary text-bg' : 'bg-muted/40 text-sub active:bg-muted'
                    }`}
                  >
                    {muscleLabel(m)}
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
                onClick={() => void createCustom()}
                disabled={!newMuscle}
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
              <span className="min-w-0 truncate">{t('workout.picker.createNamed', { name: q.trim() })}</span>
            </button>
          )}
        </div>
      )}

      <ul className="divide-y divide-edge/50">
        {filtered.map(({ e, label }) => (
          <li key={e.id}>
            <button
              onClick={() => pick(e)}
              className="flex min-h-[52px] w-full items-center justify-between gap-2 px-1 py-2 text-left active:bg-muted/30"
            >
              <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
              <span className="flex shrink-0 items-center gap-1.5">
                {e.equipment && (
                  <span className="whitespace-nowrap rounded-full bg-muted/40 px-2 py-0.5 text-xs text-sub">
                    {EQUIPMENT_LABEL[e.equipment]}
                  </span>
                )}
                <span className="whitespace-nowrap rounded-full bg-muted/40 px-2 py-0.5 text-xs text-sub">
                  {muscleLabel(e.muscleGroup)}
                </span>
              </span>
            </button>
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="py-6 text-center text-sm text-sub">
            {query || equipFilter !== 'all' ? t('workout.picker.noMatch') : t('workout.picker.empty')}
          </li>
        )}
      </ul>
    </Sheet>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-[36px] shrink-0 whitespace-nowrap rounded-full px-3 text-sm font-medium ${
        active ? 'bg-primary text-bg' : 'bg-muted/40 text-sub active:bg-muted'
      }`}
    >
      {children}
    </button>
  )
}
