import { useState } from 'react'
import { Trash2, Utensils } from 'lucide-react'
import Sheet from '../../components/Sheet'
import NumberStepper from '../../components/NumberStepper'
import { macrosFor } from '../../lib/nutrition'
import { deletePlanned, eatPlanned, updatePlannedGrams } from '../../lib/mealPlan'
import { haptic } from '../../native/haptics'
import { t, fmtNum } from '../../i18n'
import type { Food, PlannedFood } from '../../types'

/** One-decimal macro value in the language's format ("12.5" / "12,5"). */
const dec1 = (n: number) => fmtNum(n, { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false })

interface Props {
  open: boolean
  onClose: () => void
  plan: PlannedFood
  food?: Food
  /** False for a future day: it can't be eaten yet. */
  canEat: boolean
}

/** Edit one planned food: portion, eat it now, or take it off the plan. */
export default function PlannedEntrySheet({ open, onClose, plan, food, canEat }: Props) {
  const [grams, setGrams] = useState(plan.grams)

  if (!food) return null
  const m = macrosFor(food, grams)

  async function save() {
    if (grams !== plan.grams) await updatePlannedGrams(plan.id!, grams)
    onClose()
  }

  async function eat() {
    haptic('tap')
    if (grams !== plan.grams) await updatePlannedGrams(plan.id!, grams)
    await eatPlanned([plan.id!])
    onClose()
  }

  async function remove() {
    await deletePlanned(plan.id!)
    onClose()
  }

  return (
    <Sheet open={open} onClose={onClose} title={food.name}>
      <div className="space-y-4">
        <p className="text-center text-xs font-semibold uppercase tracking-wide text-sub">{t('diet.planned.status')}</p>
        <div className="flex justify-center">
          <NumberStepper label={t('diet.food.grams')} value={grams} onChange={setGrams} step={10} min={1} max={5000} unit="g" />
        </div>
        <p className="num text-center text-sm text-sub">
          {Math.round(m.kcal)} kcal · {t('diet.macro.p')} {dec1(m.protein)} · {t('diet.macro.c')} {dec1(m.carbs)} ·{' '}
          {t('diet.macro.f')} {dec1(m.fat)}
        </p>
        {canEat && (
          <button
            onClick={eat}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-3.5 font-display text-lg font-bold text-bg active:opacity-90"
          >
            <Utensils size={18} aria-hidden /> {t('diet.planned.eatNow')}
          </button>
        )}
        <button
          onClick={save}
          className={`w-full rounded-2xl py-3.5 font-display text-lg font-bold active:opacity-90 ${
            canEat ? 'border border-edge bg-card' : 'bg-primary text-bg'
          }`}
        >
          {t('common.save')}
        </button>
        <div className="flex justify-end">
          <button
            onClick={remove}
            className="flex min-h-[44px] items-center gap-1.5 px-2 text-sm font-medium text-danger"
          >
            <Trash2 size={16} /> {t('diet.planned.remove')}
          </button>
        </div>
      </div>
    </Sheet>
  )
}
