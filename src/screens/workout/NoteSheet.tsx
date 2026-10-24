import { useState } from 'react'
import { BookOpen } from 'lucide-react'
import { db } from '../../db/db'
import { isCardioExercise } from '../../lib/cardio'
import { EQUIPMENTS, EQUIPMENT_LABEL } from '../../lib/equipment'
import { bwFactorOf, defaultBwFactor } from '../../lib/load'
import { refreshStampedE1rm } from '../../lib/finishSession'
import NumberStepper from '../../components/NumberStepper'
import Sheet from '../../components/Sheet'
import ExerciseDetailSheet from '../../components/library/ExerciseDetailSheet'
import { libraryIdOf, useExerciseLibrary } from '../../lib/exerciseLibrary'
import { exerciseDisplayName } from '../../lib/exerciseNames'
import { t } from '../../i18n'
import type { Equipment, Exercise } from '../../types'

export function NoteSheet({ open, onClose, exercise }: {
  open: boolean
  onClose: () => void
  exercise: Exercise
}) {
  const [text, setText] = useState(exercise.notes ?? '')
  const [step, setStep] = useState(exercise.progressionStepKg ?? 2.5)
  const [equip, setEquip] = useState<Equipment>(exercise.equipment ?? 'other')
  const [logAs, setLogAs] = useState<'strength' | 'cardio'>(isCardioExercise(exercise) ? 'cardio' : 'strength')
  // Fraction of bodyweight the exercise moves, edited as a whole percent: NumberStepper shows
  // one decimal, so a 0.05 step on the raw fraction would display 0.64 as "0.6".
  const [bwPct, setBwPct] = useState(Math.round(bwFactorOf({ ...exercise, equipment: 'bodyweight' }) * 100))

  async function save() {
    const byGroup = exercise.muscleGroup === 'cardio' ? 'cardio' : 'strength'
    const changes: Partial<Exercise> = {
      notes: text.trim() || undefined,
      progressionStepKg: step,
      equipment: equip,
      // Only store an override; matching the muscle-group default clears it.
      kind: logAs === byGroup ? undefined : logAs,
    }
    if (equip === 'bodyweight') {
      // Same rule: store the factor only when it differs from the default for this name.
      const factor = bwPct / 100
      const byName = defaultBwFactor({ nameLower: exercise.nameLower, equipment: equip })
      changes.bwFactor = Math.abs(factor - byName) < 1e-9 ? undefined : factor
    }
    const next: Exercise = { ...exercise, ...changes }
    await db.transaction('rw', db.exercises, db.sets, db.sessions, async () => {
      await db.exercises.update(exercise.id!, changes)
      // Factor/equipment/kind are properties of the exercise: they set the load of its sets in
      // every stamped workout, finished ones included, so the stored e1rm follows. Points already
      // earned stay until that workout is edited (rescoreSession then scores the new load).
      await refreshStampedE1rm(next)
    })
    onClose()
  }

  return (
    <Sheet open={open} onClose={onClose} title={exerciseDisplayName(exercise.name)}>
      {libraryIdOf(exercise) && <HowTo exercise={exercise} libId={libraryIdOf(exercise)!} />}
      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-sub">
        {t('workout.notes.label')}
      </label>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        rows={3}
        className="w-full rounded-xl bg-card p-3 text-base"
        placeholder={t('workout.notes.placeholder')}
      />
      <p className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-sub">{t('workout.shared.equipment')}</p>
      <div className="flex flex-wrap gap-2">
        {EQUIPMENTS.map(eq => (
          <button
            key={eq}
            onClick={() => setEquip(eq)}
            className={`min-h-[40px] whitespace-nowrap rounded-full px-3 text-sm font-medium ${
              equip === eq ? 'bg-primary text-bg' : 'bg-muted/40 text-sub active:bg-muted'
            }`}
          >
            {EQUIPMENT_LABEL[eq]}
          </button>
        ))}
      </div>
      <p className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-sub">{t('workout.notes.logAs')}</p>
      <div className="flex gap-2" role="group" aria-label={t('workout.notes.logAs')}>
        {(['strength', 'cardio'] as const).map(k => (
          <button
            key={k}
            onClick={() => setLogAs(k)}
            aria-pressed={logAs === k}
            className={`min-h-[40px] flex-1 whitespace-nowrap rounded-full px-3 text-sm font-medium ${
              logAs === k ? 'bg-primary text-bg' : 'bg-muted/40 text-sub active:bg-muted'
            }`}
          >
            {k === 'strength' ? t('workout.notes.strength') : t('workout.notes.cardio')}
          </button>
        ))}
      </div>
      <div className={`mt-3 items-center justify-between ${logAs === 'cardio' ? 'hidden' : 'flex'}`}>
        <NumberStepper
          label={t('workout.notes.step')}
          value={step}
          onChange={setStep}
          step={1.25}
          min={1.25}
          max={10}
          unit="kg"
        />
      </div>
      {equip === 'bodyweight' && logAs !== 'cardio' && (
        <div className="mt-3 flex flex-col items-start">
          <NumberStepper
            label={t('workout.notes.bwFactor')}
            value={bwPct}
            onChange={setBwPct}
            step={5}
            min={20}
            max={150}
            unit="%"
          />
          <p className="mt-1 text-xs text-sub">{t('workout.notes.bwFactorHint')}</p>
        </div>
      )}
      <button
        onClick={save}
        className="mt-4 w-full rounded-2xl bg-primary py-3.5 font-display text-lg font-bold text-bg active:opacity-90"
      >
        {t('common.save')}
      </button>
    </Sheet>
  )
}

/** "How to" for an exercise linked to the library: opens its instructions (and animation, if on). */
function HowTo({ exercise, libId }: { exercise: Exercise; libId: string }) {
  const { library } = useExerciseLibrary()
  const [open, setOpen] = useState(false)
  const lib = library?.byId.get(libId)
  if (!lib) return null
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="mb-3 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-muted/40 font-semibold text-ink active:bg-muted"
      >
        <BookOpen size={18} /> {t('library.howTo')}
      </button>
      <ExerciseDetailSheet open={open} onClose={() => setOpen(false)} library={library} lib={lib} exercise={exercise} />
    </>
  )
}
