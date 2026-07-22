import { useState } from 'react'
import { Trash2, Pencil, RotateCcw, Sparkles, Loader2, AlertTriangle, RefreshCw, ArrowLeftRight } from 'lucide-react'
import { db, deleteWithTombstone } from '../../db/db'
import Sheet from '../../components/Sheet'
import NumberStepper from '../../components/NumberStepper'
import { errMsg } from '../../components/AiReportCard'
import { macrosFor } from '../../lib/nutrition'
import { useAiStore } from '../../lib/aiStore'
import { gatherSubstitutionBriefing, formatSubstitutionBriefing } from '../../lib/dietReport'
import { generateSubstitution } from '../../lib/gemini'
import { applySwap } from '../../lib/foodResolve'
import type { Food, FoodLog, MacroSuggestionItem } from '../../types'

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
    await deleteWithTombstone('foodLogs', log.id!)
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
          <SwapSuggestion log={log} onApplied={onClose} />
        </div>
      ) : (
        <FoodDataEditor food={food} onDone={() => setEditingFood(false)} />
      )}
    </Sheet>
  )
}

/** F1b: ask the AI for a swap for this logged food and apply it in one tap. */
function SwapSuggestion({ log, onApplied }: { log: FoodLog; onApplied: () => void }) {
  const apiKey = useAiStore(s => s.apiKey)
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [headline, setHeadline] = useState('')
  const [items, setItems] = useState<MacroSuggestionItem[]>([])
  const [applying, setApplying] = useState<number | null>(null)

  if (!apiKey) return null

  async function run() {
    if (!navigator.onLine) {
      setError('Offline — connect to get a swap.')
      setStatus('error')
      return
    }
    setStatus('loading')
    setError(null)
    try {
      const briefing = await gatherSubstitutionBriefing(log.id!)
      if (!briefing) throw new Error('Could not read this entry.')
      const { apiKey: key, model } = useAiStore.getState()
      const res = await generateSubstitution(formatSubstitutionBriefing(briefing), { apiKey: key!, model })
      setHeadline(res.headline)
      setItems(res.items)
      setStatus('done')
    } catch (e) {
      setError(errMsg(e))
      setStatus('error')
    }
  }

  async function apply(i: number, item: MacroSuggestionItem) {
    setApplying(i)
    try {
      const id = await applySwap(log.id!, log.date, log.meal, item)
      if (id != null) {
        onApplied()
        return
      }
      setError('Could not add that food — try another.')
      setStatus('error')
    } catch {
      setError('Could not add that food — try another.')
      setStatus('error')
    } finally {
      setApplying(null)
    }
  }

  return (
    <div className="border-t border-edge/50 pt-3">
      {status === 'idle' && (
        <button
          onClick={() => void run()}
          className="flex items-center gap-1.5 rounded-xl bg-primary/15 px-3 py-2 text-sm font-semibold text-primary active:bg-primary/30"
        >
          <Sparkles size={15} /> Suggest a swap
        </button>
      )}

      {status === 'loading' && (
        <p className="flex items-center gap-2 text-sm text-sub">
          <Loader2 size={16} className="animate-spin" /> Finding a swap…
        </p>
      )}

      {status === 'error' && (
        <div>
          <p className="flex items-start gap-1.5 text-sm text-danger">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {error}
          </p>
          <button
            onClick={() => void run()}
            className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-sub active:text-ink"
          >
            <RefreshCw size={14} /> Try again
          </button>
        </div>
      )}

      {status === 'done' && (
        <div>
          <p className="flex items-center gap-1.5 text-sm font-semibold text-primary">
            <ArrowLeftRight size={15} /> {headline}
          </p>
          {items.length === 0 ? (
            <p className="mt-2 text-sm text-sub">No swap found — tap to retry.</p>
          ) : (
            <ul className="mt-2 space-y-2.5">
              {items.map((item, i) => (
                <li key={i} className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-medium">
                      {item.food}
                      {item.brand && <span className="text-sub"> · {item.brand}</span>}
                      <span className="num text-sub"> · {item.grams} g</span>
                    </p>
                    <p className="num text-xs text-sub">
                      {item.kcal} kcal · P {item.protein} · C {item.carbs} · F {item.fat}
                    </p>
                    {item.reason && <p className="mt-0.5 text-xs text-sub/80">{item.reason}</p>}
                  </div>
                  <button
                    onClick={() => void apply(i, item)}
                    disabled={applying !== null}
                    className="flex h-9 shrink-0 items-center gap-1 rounded-lg bg-primary/15 px-2.5 text-xs font-bold text-primary active:bg-primary/30 disabled:opacity-50"
                  >
                    {applying === i ? <Loader2 size={14} className="animate-spin" /> : <ArrowLeftRight size={14} />}
                    Swap
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
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
