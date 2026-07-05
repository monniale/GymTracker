import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Search, Layers, Trash2, WifiOff, Loader2, ScanBarcode, X } from 'lucide-react'
import { db } from '../../db/db'
import Sheet from '../../components/Sheet'
import BarcodeScanSheet from '../../components/BarcodeScanSheet'
import NumberStepper from '../../components/NumberStepper'
import { logFood, recipePer100 } from '../../lib/nutrition'
import { searchOff, upsertOffProduct, type OffProduct } from '../../lib/off'
import type { Food, MealType, SavedMeal } from '../../types'

type Tab = 'recent' | 'search' | 'custom'

interface Props {
  open: boolean
  onClose: () => void
  date: string
  meal: MealType
}

export default function AddFoodSheet({ open, onClose, date, meal }: Props) {
  const [tab, setTab] = useState<Tab>('recent')
  const [scanOpen, setScanOpen] = useState(false)

  async function onScannedProduct(p: OffProduct) {
    const foodId = await upsertOffProduct(p)
    const food = await db.foods.get(foodId)
    await logFood(foodId, food ? defaultGrams(food) : 100, date, meal)
    setScanOpen(false)
    onClose()
  }

  return (
    <Sheet open={open} onClose={onClose} title="Add food">
      <div className="mb-3 flex items-center gap-2">
        <div className="flex flex-1 rounded-xl bg-card p-1">
          {(['recent', 'search', 'custom'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`min-h-[40px] flex-1 rounded-lg text-sm font-semibold capitalize transition-colors ${
                tab === t ? 'bg-muted text-ink' : 'text-sub'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <button
          onClick={() => setScanOpen(true)}
          aria-label="Scan barcode"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary active:bg-primary/30"
        >
          <ScanBarcode size={22} />
        </button>
      </div>
      {tab === 'recent' && <RecentTab date={date} meal={meal} onDone={onClose} />}
      {tab === 'search' && <SearchTab date={date} meal={meal} onDone={onClose} />}
      {tab === 'custom' && <CustomTab date={date} meal={meal} onDone={onClose} />}

      {scanOpen && (
        <BarcodeScanSheet open onClose={() => setScanOpen(false)} onProduct={onScannedProduct} />
      )}
    </Sheet>
  )
}

function defaultGrams(f: Food): number {
  return f.lastGrams ?? f.servingG ?? 100
}

/* ---------- Recent ---------- */

function RecentTab({ date, meal, onDone }: { date: string; meal: MealType; onDone: () => void }) {
  const savedMeals = useLiveQuery(() => db.savedMeals.orderBy('lastUsedAt').reverse().toArray()) ?? []
  const recents = useLiveQuery(
    () => db.foods.orderBy('lastUsedAt').reverse().limit(30).toArray(),
  ) ?? []
  const foods = useLiveQuery(() => db.foods.toArray()) ?? []
  const foodsById = new Map(foods.map(f => [f.id!, f]))

  async function addSavedMeal(m: SavedMeal) {
    for (const item of m.items) {
      if (foodsById.has(item.foodId)) await logFood(item.foodId, item.grams, date, meal)
    }
    await db.savedMeals.update(m.id!, { lastUsedAt: Date.now() })
    onDone()
  }

  async function removeSavedMeal(m: SavedMeal) {
    if (window.confirm(`Delete saved meal “${m.name}”?`)) await db.savedMeals.delete(m.id!)
  }

  async function addFood(f: Food, grams: number) {
    await logFood(f.id!, grams, date, meal)
    onDone()
  }

  return (
    <div>
      {savedMeals.length > 0 && (
        <div className="mb-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-sub">Saved meals</p>
          {savedMeals.map(m => {
            const kcal = m.items.reduce((acc, it) => {
              const f = foodsById.get(it.foodId)
              return acc + (f ? (f.kcal100 * it.grams) / 100 : 0)
            }, 0)
            return (
              <div key={m.id} className="flex items-center">
                <button
                  onClick={() => addSavedMeal(m)}
                  className="flex min-h-[52px] flex-1 items-center gap-2 rounded-xl px-2 text-left active:bg-muted/30"
                >
                  <Layers size={18} className="shrink-0 text-primary" />
                  <span className="min-w-0 flex-1 truncate font-medium">{m.name}</span>
                  <span className="num text-sm text-sub">
                    {m.items.length} items · {Math.round(kcal)} kcal
                  </span>
                </button>
                <button
                  onClick={() => removeSavedMeal(m)}
                  aria-label={`Delete ${m.name}`}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sub active:bg-muted/40"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            )
          })}
        </div>
      )}

      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-sub">Recent foods</p>
      {recents.length === 0 && (
        <p className="py-6 text-center text-sm text-sub">
          Nothing yet — use Search or Custom to add your first food.
        </p>
      )}
      {recents.map(f => (
        <FoodRow key={f.id} food={f} onAdd={grams => addFood(f, grams)} />
      ))}
    </div>
  )
}

function FoodRow({ food, onAdd }: { food: Food; onAdd: (grams: number) => void }) {
  const [grams, setGrams] = useState<number | null>(null)
  const g = grams ?? defaultGrams(food)

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => onAdd(g)}
        className="flex min-h-[52px] min-w-0 flex-1 flex-col justify-center rounded-xl px-2 text-left active:bg-muted/30"
      >
        <span className="truncate font-medium">
          {food.name}
          {food.userOverridden && <span className="ml-1 text-xs text-primary">·edited</span>}
        </span>
        <span className="num text-xs text-sub">
          {food.brand ? `${food.brand} · ` : ''}
          {Math.round((food.kcal100 * g) / 100)} kcal
        </span>
      </button>
      <div className="num flex shrink-0 items-center gap-1 text-sm">
        <button
          onClick={() => setGrams(Math.max(5, g - 10))}
          aria-label="Less grams"
          className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted/30 active:bg-muted"
        >
          −
        </button>
        <span className="w-12 text-center font-semibold">{g} g</span>
        <button
          onClick={() => setGrams(g + 10)}
          aria-label="More grams"
          className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted/30 active:bg-muted"
        >
          +
        </button>
      </div>
    </div>
  )
}

/* ---------- Search (local + Open Food Facts) ---------- */

function SearchTab({ date, meal, onDone }: { date: string; meal: MealType; onDone: () => void }) {
  const [q, setQ] = useState('')
  const [offResults, setOffResults] = useState<OffProduct[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const local = useLiveQuery(async () => {
    const query = q.trim().toLowerCase()
    if (!query) return []
    return db.foods.filter(f => f.nameLower.includes(query)).limit(15).toArray()
  }, [q]) ?? []

  useEffect(() => {
    const query = q.trim()
    setError(null)
    if (query.length < 3) {
      setOffResults([])
      setLoading(false)
      return
    }
    if (!navigator.onLine) {
      setError('Offline — showing your local foods only.')
      return
    }
    setLoading(true)
    const timer = setTimeout(async () => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      try {
        const results = await searchOff(query, controller.signal)
        setOffResults(results)
        setLoading(false)
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          setError('Food database unreachable.')
          setLoading(false)
        }
      }
    }, 400)
    return () => clearTimeout(timer)
  }, [q])

  async function addLocal(f: Food) {
    await logFood(f.id!, defaultGrams(f), date, meal)
    onDone()
  }

  async function addOff(p: OffProduct) {
    // Upsert by barcode: an existing row (possibly user-edited) always wins.
    const foodId = await upsertOffProduct(p)
    const food = await db.foods.get(foodId)
    await logFood(foodId, food ? defaultGrams(food) : 100, date, meal)
    onDone()
  }

  const localIds = new Set(local.filter(f => f.offId).map(f => f.offId))

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 rounded-xl bg-card px-3">
        <Search size={18} className="shrink-0 text-sub" />
        <input
          autoFocus
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search foods…"
          className="min-h-[48px] w-full text-base"
        />
        {loading && <Loader2 size={18} className="shrink-0 animate-spin text-sub" />}
      </div>

      {local.length > 0 && (
        <>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-sub">My foods</p>
          {local.map(f => (
            <button
              key={f.id}
              onClick={() => addLocal(f)}
              className="flex min-h-[52px] w-full flex-col justify-center rounded-xl px-2 text-left active:bg-muted/30"
            >
              <span className="truncate font-medium">{f.name}</span>
              <span className="num text-xs text-sub">
                {f.brand ? `${f.brand} · ` : ''}
                {f.kcal100} kcal/100g · P {f.protein100} C {f.carbs100} F {f.fat100}
              </span>
            </button>
          ))}
        </>
      )}

      {error && (
        <p className="flex items-center gap-2 py-3 text-sm text-sub">
          <WifiOff size={16} /> {error}
        </p>
      )}

      {offResults.length > 0 && (
        <>
          <p className="mb-1 mt-2 text-xs font-semibold uppercase tracking-wide text-sub">
            Open Food Facts
          </p>
          {offResults
            .filter(p => !localIds.has(p.offId))
            .map(p => (
              <button
                key={p.offId}
                onClick={() => addOff(p)}
                className="flex min-h-[52px] w-full flex-col justify-center rounded-xl px-2 text-left active:bg-muted/30"
              >
                <span className="truncate font-medium">{p.name}</span>
                <span className="num text-xs text-sub">
                  {p.brand ? `${p.brand} · ` : ''}
                  {p.kcal100} kcal/100g · P {p.protein100} C {p.carbs100} F {p.fat100}
                </span>
              </button>
            ))}
        </>
      )}

      {q.trim().length >= 3 && !loading && offResults.length === 0 && local.length === 0 && !error && (
        <p className="py-6 text-center text-sm text-sub">No results — try the Custom tab.</p>
      )}
    </div>
  )
}

/* ---------- Custom ---------- */

function CustomTab({ date, meal, onDone }: { date: string; meal: MealType; onDone: () => void }) {
  const [recipeMode, setRecipeMode] = useState(false)
  const [name, setName] = useState('')
  const [kcal, setKcal] = useState('')
  const [protein, setProtein] = useState('')
  const [carbs, setCarbs] = useState('')
  const [fat, setFat] = useState('')
  const [serving, setServing] = useState('')

  if (recipeMode) {
    return <RecipeBuilder date={date} meal={meal} onDone={onDone} onBack={() => setRecipeMode(false)} />
  }

  const valid = name.trim().length > 0 && parseFloat(kcal) >= 0

  async function save() {
    if (!valid) return
    const servingG = parseFloat(serving) || undefined
    const foodId = await db.foods.add({
      source: 'custom',
      name: name.trim(),
      nameLower: name.trim().toLowerCase(),
      kcal100: parseFloat(kcal) || 0,
      protein100: parseFloat(protein) || 0,
      carbs100: parseFloat(carbs) || 0,
      fat100: parseFloat(fat) || 0,
      servingG,
      userOverridden: false,
      lastUsedAt: Date.now(),
      useCount: 0,
    })
    await logFood(foodId, servingG ?? 100, date, meal)
    onDone()
  }

  return (
    <div className="space-y-3">
      <Field label="Name" value={name} onChange={setName} type="text" placeholder="e.g. Mum's lasagna" />
      <div className="grid grid-cols-2 gap-3">
        <Field label="kcal / 100g" value={kcal} onChange={setKcal} placeholder="0" />
        <Field label="Protein / 100g" value={protein} onChange={setProtein} placeholder="0" />
        <Field label="Carbs / 100g" value={carbs} onChange={setCarbs} placeholder="0" />
        <Field label="Fat / 100g" value={fat} onChange={setFat} placeholder="0" />
      </div>
      <Field label="Serving size in grams (optional)" value={serving} onChange={setServing} placeholder="100" />
      <button
        onClick={save}
        disabled={!valid}
        className="w-full rounded-2xl bg-primary py-3.5 font-display text-lg font-bold text-bg active:opacity-90 disabled:opacity-40"
      >
        Save & log
      </button>
      <button
        onClick={() => setRecipeMode(true)}
        className="flex w-full items-center justify-center gap-2 py-2 text-sm font-medium text-sub active:text-ink"
      >
        <Layers size={16} /> Build from a recipe (cook once, log portions)
      </button>
    </div>
  )
}

/**
 * Recipe → food converter: pick raw ingredients + total cooked weight, and the
 * result becomes an ordinary per-100g food (zero extra taps at log time).
 */
function RecipeBuilder({ date, meal, onDone, onBack }: {
  date: string
  meal: MealType
  onDone: () => void
  onBack: () => void
}) {
  const [name, setName] = useState('')
  const [q, setQ] = useState('')
  const [items, setItems] = useState<{ food: Food; grams: number }[]>([])
  const [cooked, setCooked] = useState('')

  const results = useLiveQuery(async () => {
    const query = q.trim().toLowerCase()
    if (!query) return []
    return db.foods.filter(f => f.nameLower.includes(query)).limit(6).toArray()
  }, [q]) ?? []

  const cookedG = parseFloat(cooked) || 0
  const per100 = recipePer100(
    items.map(i => ({ food: i.food, grams: i.grams })),
    cookedG,
  )
  const valid = name.trim().length > 0 && items.length > 0 && cookedG > 0

  async function save() {
    if (!valid) return
    const foodId = await db.foods.add({
      source: 'custom',
      name: name.trim(),
      nameLower: name.trim().toLowerCase(),
      ...per100,
      userOverridden: false,
      lastUsedAt: Date.now(),
      useCount: 0,
    })
    await logFood(foodId, 100, date, meal)
    onDone()
  }

  return (
    <div className="space-y-3">
      <button onClick={onBack} className="text-sm font-medium text-sub active:text-ink">
        ‹ Back to custom food
      </button>
      <Field label="Recipe name" value={name} onChange={setName} type="text" placeholder="e.g. Sunday ragù" />

      <div>
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-sub">
          Add raw ingredients (from your foods)
        </span>
        <div className="flex items-center gap-2 rounded-xl bg-card px-3">
          <Search size={16} className="shrink-0 text-sub" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search your foods…"
            className="min-h-[44px] w-full text-base"
          />
        </div>
        {results.map(f => (
          <button
            key={f.id}
            onClick={() => {
              setItems(list => [...list, { food: f, grams: 100 }])
              setQ('')
            }}
            className="flex min-h-[44px] w-full items-center justify-between px-2 text-left active:bg-muted/30"
          >
            <span className="truncate text-sm font-medium">{f.name}</span>
            <span className="num text-xs text-sub">{f.kcal100} kcal/100g</span>
          </button>
        ))}
      </div>

      {items.map((it, idx) => (
        <div key={`${it.food.id}-${idx}`} className="flex items-center gap-2 rounded-xl bg-card px-3 py-1.5">
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{it.food.name}</span>
          <NumberStepper
            value={it.grams}
            onChange={v => setItems(list => list.map((x, i) => (i === idx ? { ...x, grams: v } : x)))}
            step={10}
            min={1}
            max={5000}
            unit="g"
          />
          <button
            onClick={() => setItems(list => list.filter((_, i) => i !== idx))}
            aria-label={`Remove ${it.food.name}`}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-sub active:bg-muted/40"
          >
            <X size={16} />
          </button>
        </div>
      ))}

      <Field label="Total cooked weight (g)" value={cooked} onChange={setCooked} placeholder="e.g. 1200" />

      {valid && (
        <p className="num rounded-xl bg-card px-3 py-2 text-center text-sm text-sub">
          Per 100g: <b className="text-ink">{per100.kcal100} kcal</b> · P {per100.protein100} · C{' '}
          {per100.carbs100} · F {per100.fat100}
        </p>
      )}

      <button
        onClick={save}
        disabled={!valid}
        className="w-full rounded-2xl bg-primary py-3.5 font-display text-lg font-bold text-bg active:opacity-90 disabled:opacity-40"
      >
        Save recipe & log 100 g
      </button>
    </div>
  )
}

function Field({ label, value, onChange, placeholder, type = 'number' }: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
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
        placeholder={placeholder}
        className="min-h-[48px] w-full rounded-xl bg-card px-3 text-base"
      />
    </label>
  )
}
