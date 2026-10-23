import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft, ChevronUp, ChevronDown, Trash2, Plus, Link2 } from 'lucide-react'
import { db, deleteWithTombstone } from '../../db/db'
import { parseRouteId } from '../../lib/ids'
import NumberStepper from '../../components/NumberStepper'
import { defaultTemplateItem, isCardioExercise } from '../../lib/cardio'
import ExercisePicker from './ExercisePicker'
import SchemeSheet, { chipCls } from './SchemeSheet'
import { ShareActions } from './ProgramDetailSheet'
import { exerciseDisplayName } from '../../lib/exerciseNames'
import { WEEKDAY_FULL_NAMES, WEEKDAY_LABELS } from '../../lib/dates'
import { useLocalToday } from '../../lib/hooks'
import { currentWeek, schemeLabel } from '../../lib/prescription'
import { programForTemplate } from '../../lib/programs'
import { exportTemplate } from '../../lib/shareTemplate'
import { fmtNum, t } from '../../i18n'
import type { Exercise, TemplateItem } from '../../types'

export default function TemplateEditor() {
  const navigate = useNavigate()
  const { id } = useParams()
  const tid = parseRouteId(id)
  const template = useLiveQuery(() => db.templates.get(tid), [tid])
  const exercises = useLiveQuery(() => db.exercises.toArray()) ?? []
  const exMap = useMemo(() => new Map(exercises.map(e => [e.id!, e])), [exercises])
  const [pickerOpen, setPickerOpen] = useState(false)
  // Index of the item whose progression scheme is being edited (SchemeSheet), null = closed.
  const [schemeFor, setSchemeFor] = useState<number | null>(null)
  const today = useLocalToday()
  // The program this template belongs to: its week picks the 5/3/1 sets shown on percent items.
  const program = useLiveQuery(async () => (await programForTemplate(tid)) ?? null, [tid])
  const week = program ? currentWeek(program, today) : 1

  if (!template) return null

  const update = (patch: Partial<typeof template>) =>
    db.templates.update(tid, { ...patch, updatedAt: Date.now() })

  const updateItem = (index: number, patch: Partial<TemplateItem>) => {
    const items = template.items.map((it, i) => (i === index ? { ...it, ...patch } : it))
    void update({ items })
  }

  const replaceItem = (index: number, next: TemplateItem) =>
    update({ items: template.items.map((it, i) => (i === index ? next : it)) })

  // Rep range on/off: the top of the range starts 4 above the bottom; off removes the field.
  const toggleRange = (index: number) => {
    const { targetRepsMax, ...rest } = template.items[index]
    void replaceItem(index, targetRepsMax !== undefined ? rest : { ...rest, targetRepsMax: Math.min(50, rest.targetReps + 4) })
  }

  async function saveScheme(index: number, next: TemplateItem, trainingMaxKg?: number) {
    await replaceItem(index, next)
    if (trainingMaxKg !== undefined) await db.exercises.update(next.exerciseId, { trainingMaxKg })
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

  // Weekday schedule: stored sorted as getDay values (Sunday 0); no day left removes the field.
  const weekdays = template.weekdays ?? []
  const toggleWeekday = (d: number) => {
    const next = weekdays.includes(d) ? weekdays.filter(x => x !== d) : [...weekdays, d].sort((a, b) => a - b)
    void update({ weekdays: next.length > 0 ? next : undefined })
  }

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

      <div className="mb-4" role="group" aria-label={t('workout.template.schedule')}>
        <div className="grid grid-cols-7 gap-1">
          {WEEKDAY_LABELS.map((label, i) => {
            // WEEKDAY_LABELS is Monday-first; getDay counts from Sunday 0.
            const d = (i + 1) % 7
            const active = weekdays.includes(d)
            return (
              <button
                key={d}
                type="button"
                aria-pressed={active}
                aria-label={WEEKDAY_FULL_NAMES[i]}
                onClick={() => toggleWeekday(d)}
                className={`h-9 min-w-0 truncate rounded-lg text-sm font-semibold ${
                  active ? 'bg-primary/15 text-primary' : 'bg-card text-sub'
                }`}
              >
                {label}
              </button>
            )
          })}
        </div>
        <p className="mt-1 text-xs text-sub">{t('workout.template.weekdaysHint')}</p>
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
                  onChange={v => {
                    const reps = Math.round(v)
                    // The top of a rep range never drops under its bottom.
                    updateItem(i, item.targetRepsMax !== undefined && item.targetRepsMax < reps
                      ? { targetReps: reps, targetRepsMax: reps }
                      : { targetReps: reps })
                  }}
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
              {!isCardioExercise(ex) && (
                <ItemChips
                  item={item}
                  exercise={ex}
                  week={week}
                  cycleWeeks={program?.cycleWeeks}
                  onToggleRange={() => toggleRange(i)}
                  onRepsMax={v => updateItem(i, { targetRepsMax: Math.max(item.targetReps, Math.round(v)) })}
                  onEditScheme={() => setSchemeFor(i)}
                />
              )}
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

      {template.items.length > 0 && (
        <div className="mt-6">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-sub">{t('programs.editor.share')}</p>
          <ShareActions kind="template" name={template.name} load={() => exportTemplate(tid)} />
        </div>
      )}

      <button onClick={deleteTemplate} className="mt-8 w-full py-3 text-sm font-medium text-danger">
        {t('workout.template.delete')}
      </button>

      <ExercisePicker open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={addExercise} />
      {schemeFor !== null && template.items[schemeFor] && (
        <SchemeSheet
          item={template.items[schemeFor]}
          exercise={exMap.get(template.items[schemeFor].exerciseId)}
          onClose={() => setSchemeFor(null)}
          onSave={(next, tm) => void saveScheme(schemeFor, next, tm)}
        />
      )}
    </div>
  )
}

/**
 * The chip line under an item's steppers (flex-wrap; chips never wrap or shrink, invariant 13):
 * rep range (toggles a 4th stepper for the top of the range), progression scheme (SchemeSheet),
 * GZCLP stage and program week when they apply. Percent items also list the week's sets.
 */
function ItemChips({ item, exercise, week, cycleWeeks, onToggleRange, onRepsMax, onEditScheme }: {
  item: TemplateItem
  exercise?: Exercise
  week: number
  cycleWeeks?: number
  onToggleRange: () => void
  onRepsMax: (v: number) => void
  onEditScheme: () => void
}) {
  const scheme = item.scheme
  const hasRange = item.targetRepsMax !== undefined
  const stages = scheme?.kind === 'linear' ? scheme.stages ?? [] : []
  const weeks = item.setsByWeek?.filter(w => w.length > 0).length ?? 0
  const schemeChip = scheme?.kind === 'linear'
    ? t('schemes.linear', { kg: fmtNum(scheme.stepKg) })
    : scheme?.kind === 'percent' ? t('programs.schemeSheet.percent') : t('programs.schemeSheet.double')
  const needsTm = scheme?.kind === 'percent' && !(exercise?.trainingMaxKg && exercise.trainingMaxKg > 0)

  return (
    <>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {scheme?.kind !== 'percent' && (
          <button type="button" aria-pressed={hasRange} aria-label={t('programs.editor.repRange')} onClick={onToggleRange} className={chipCls(hasRange)}>
            {hasRange ? `${item.targetReps}–${item.targetRepsMax}` : t('programs.editor.range')}
          </button>
        )}
        <button type="button" onClick={onEditScheme} className={chipCls(scheme !== undefined && scheme.kind !== 'double')}>
          {schemeChip} <ChevronDown size={12} aria-hidden />
        </button>
        {stages.length > 0 && (
          <span className={chipCls(false)}>
            {t('programs.editor.stage', { n: Math.min(stages.length, (item.progress?.stage ?? 0) + 1), total: stages.length })}
          </span>
        )}
        {weeks > 1 && (
          <span className={chipCls(false)}>
            {t('programs.editor.week', { n: ((week - 1) % weeks) + 1, total: cycleWeeks && cycleWeeks >= weeks ? cycleWeeks : weeks })}
          </span>
        )}
        {needsTm && (
          <button
            type="button"
            onClick={onEditScheme}
            className="flex min-h-[32px] shrink-0 items-center whitespace-nowrap rounded-full border border-danger/40 bg-bg px-2.5 text-xs font-semibold text-danger"
          >
            {t('programs.editor.noTrainingMax')}
          </button>
        )}
      </div>
      {hasRange && scheme?.kind !== 'percent' && (
        <div className="mt-2 flex justify-center">
          <NumberStepper
            compact
            label={t('programs.editor.repsMax')}
            value={item.targetRepsMax!}
            onChange={onRepsMax}
            step={1}
            min={item.targetReps}
            max={50}
          />
        </div>
      )}
      {scheme?.kind === 'percent' && (
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="num min-w-0 flex-1 text-sm text-sub">{schemeLabel(item, week)}</p>
          <button type="button" onClick={onEditScheme} className={chipCls(false)}>
            {t('programs.editor.editSets')}
          </button>
        </div>
      )}
    </>
  )
}
