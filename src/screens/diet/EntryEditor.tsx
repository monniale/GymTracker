import { useState } from 'react'
import { Trash2, Pencil, RotateCcw } from 'lucide-react'
import { db } from '../../db/db'
import Sheet from '../../components/Sheet'
import NumberStepper from '../../components/NumberStepper'
import { macrosFor } from '../../lib/nutrition'
import type { Food, FoodLog } from '../../types'

interface Props {
  open: boolean
  onClose: () => void
  log: FoodLog
  food?: Food
}

/** Edit one logged entry: portion size, delete, or edit the food's macro data. */
export default function EntryEditor({ open, onClose, log, food }: Props) {
  const [grams, setGrams] = useState(log.grams)
  const [editingFood, setEditingFood] = useState(false)

  if (!food) return null
  const m = macrosFor(food, grams)

  async function save() {
    await db.foodLogs.update(log.id!, { grams })
    await db.foods.update(food!.id!, { lastGrams: grams })
    onClose()
  }

  async function remove() {
    await db.foodLogs.delete(log.id!)
    onClose()
  }

  return (
    <Sheet open={open} onClose={onClose} title={food.name}>
      {!editingFood ? (
        <div className="space-y-4">
          <div className="flex justify-center">
            <NumberStepper label="grams" value={grams} onChange={setGrams} step={10} min={1} max={5000} unit="g" />
          </div>
          <p className="num text-center text-sm text-sub">
            {Math.round(m.kcal)} kcal · P {m.protein.toFixed(1)} · C {m.carbs.toFixed(1)} · F {m.fat.toFixed(1)}
          </p>
          <button
            onClick={save}
            className="w-full rounded-2xl bg-primary py-3.5 font-display text-lg font-bold text-bg active:opacity-90"
          >
            Save
          </button>
          <div className="flex justify-between">
            <button
              onClick={() => setEditingFood(true)}
              className="flex min-h-[44px] items-center gap-1.5 px-2 text-sm font-medium text-sub active:text-ink"
            >
              <Pencil size={16} /> Edit food data
            </button>
            <button
              onClick={remove}
              className="flex min-h-[44px] items-center gap-1.5 px-2 text-sm font-medium text-danger"
            >
              <Trash2 size={16} /> Remove entry
            </button>
          </div>
        </div>
      ) : (
        <FoodDataEditor food={food} onDone={() => setEditingFood(false)} />
      )}
    </Sheet>
  )
}

/** Edit the per-100g macro values of a food; user overrides win over API data. */
export function FoodDataEditor({ food, onDone }: { food: Food; onDone: () => void }) {
  const [name, setName] = useState(food.name)
  const [kcal, setKcal] = useState(String(food.kcal100))
  const [protein, setProtein] = useState(String(food.protein100))
  const [carbs, setCarbs] = useState(String(food.carbs100))
  const [fat, setFat] = useState(String(food.fat100))

  async function save() {
    const next = {
      name: name.trim() || food.name,
      nameLower: (name.trim() || food.name).toLowerCase(),
      kcal100: parseFloat(kcal) || 0,
      protein100: parseFloat(protein) || 0,
      carbs100: parseFloat(carbs) || 0,
      fat100: parseFloat(fat) || 0,
    }
    const changedMacros =
      next.kcal100 !== food.kcal100 || next.protein100 !== food.protein100 ||
      next.carbs100 !== food.carbs100 || next.fat100 !== food.fat100
    await db.foods.update(food.id!, {
      ...next,
      userOverridden: food.userOverridden || (food.source === 'off' && changedMacros),
    })
    onDone()
  }

  async function resetToApi() {
    if (!food.offOriginal) return
    await db.foods.update(food.id!, { ...food.offOriginal, userOverridden: false })
    onDone()
  }

  return (
    <div className="space-y-3">
      <MiniField label="Name" value={name} onChange={setName} type="text" />
      <div className="grid grid-cols-2 gap-3">
        <MiniField label="kcal / 100g" value={kcal} onChange={setKcal} />
        <MiniField label="Protein / 100g" value={protein} onChange={setProtein} />
        <MiniField label="Carbs / 100g" value={carbs} onChange={setCarbs} />
        <MiniField label="Fat / 100g" value={fat} onChange={setFat} />
      </div>
      <button
        onClick={save}
        className="w-full rounded-2xl bg-primary py-3.5 font-display text-lg font-bold text-bg active:opacity-90"
      >
        Save food data
      </button>
      {food.source === 'off' && food.userOverridden && food.offOriginal && (
        <button
          onClick={resetToApi}
          className="flex w-full items-center justify-center gap-1.5 py-2 text-sm font-medium text-sub active:text-ink"
        >
          <RotateCcw size={15} /> Reset to Open Food Facts values
        </button>
      )}
    </div>
  )
}

function MiniField({ label, value, onChange, type = 'number' }: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-sub">{label}</span>
      <input
        type={type}
        inputMode={type === 'number' ? 'decimal' : undefined}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="min-h-[48px] w-full rounded-xl bg-card px-3 text-base"
      />
    </label>
  )
}
