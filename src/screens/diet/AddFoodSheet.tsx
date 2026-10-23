import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Search, Layers, Trash2, WifiOff, Loader2, ScanBarcode, X } from 'lucide-react'
import { db, deleteWithTombstone } from '../../db/db'
import Sheet from '../../components/Sheet'
import BarcodeScanSheet from '../../components/BarcodeScanSheet'
import EstimateTab from './EstimateTab'
import NumberStepper from '../../components/NumberStepper'
import { logFood, recipePer100 } from '../../lib/nutrition'
import { planFood } from '../../lib/mealPlan'
import { searchFoods, upsertRemoteFood, remoteFoodKey, PROVIDERS } from '../../lib/foodProviders'
import { t, tp, fmtNum, type Key } from '../../i18n'
import type { Food, Id, MealType, RemoteFood, SavedMeal } from '../../types'

type Tab = 'recent' | 'search' | 'custom' | 'estimate'

const TABS: { id: Tab; label: Key }[] = [
  { id: 'recent', label: 'diet.addFood.tabRecent' },
  { id: 'search', label: 'diet.addFood.tabSearch' },
  { id: 'custom', label: 'diet.addFood.tabCustom' },
  { id: 'estimate', label: 'diet.addFood.tabEstimate' },
]

/** A per-100 g value from the DB or an API, in the language's decimal format (no grouping, as before). */
const num = (n: number) => fmtNum(n, { useGrouping: false })

/** Puts a food on the day: logs it (eaten) or plans it, depending on the sheet's target. */
type AddFn = (foodId: Id, grams: number) => Promise<void>

interface Props {
  open: boolean
  onClose: () => void
  date: string
  meal: MealType
  /** 'plan' adds to the meal plan instead of the log. */
  target?: 'log' | 'plan'
}

export default function AddFoodSheet({ open, onClose, date, meal, target = 'log' }: Props) {
  const [tab, setTab] = useState<Tab>('recent')
  const [scanOpen, setScanOpen] = useState(false)
  const planning = target === 'plan'
  const add: AddFn = planning
    ? async (foodId, grams) => void (await planFood(foodId, grams, date, meal))
    : (foodId, grams) => logFood(foodId, grams, date, meal)

  async function onScannedProduct(p: RemoteFood) {
    const foodId = await upsertRemoteFood(p)
    const food = await db.foods.get(foodId)
    await add(foodId, food ? defaultGrams(food) : 100)
    setScanOpen(false)
    onClose()
  }

  return (
    <Sheet open={open} onClose={onClose} title={planning ? t('diet.addFood.titlePlan') : t('diet.addFood.titleAdd')}>
      <div className="mb-3 flex items-center gap-2">
        <div className="flex flex-1 rounded-xl bg-card p-1">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`min-h-[40px] min-w-0 flex-1 whitespace-nowrap rounded-lg text-sm font-semibold transition-colors ${
                tab === id ? 'bg-muted text-ink' : 'text-sub'
              }`}
            >
              {t(label)}
            </button>
          ))}
        </div>
        <button
          onClick={() => setScanOpen(true)}
          aria-label={t('diet.addFood.scanAria')}
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary active:bg-primary/30"
        >
          <ScanBarcode size={22} />
        </button>
      </div>
      {tab === 'recent' && <RecentTab add={add} onDone={onClose} />}
      {tab === 'search' && <SearchTab add={add} onDone={onClose} />}
      {tab === 'custom' && <CustomTab add={add} planning={planning} onDone={onClose} />}
      {tab === 'estimate' && <EstimateTab add={add} planning={planning} onDone={onClose} />}

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

function RecentTab({ add, onDone }: { add: AddFn; onDone: () => void }) {
  const savedMeals = useLiveQuery(() => db.savedMeals.orderBy('lastUsedAt').reverse().toArray()) ?? []
  const recents = useLiveQuery(
    () => db.foods.orderBy('lastUsedAt').reverse().limit(30).toArray(),
  ) ?? []
  const foods = useLiveQuery(() => db.foods.toArray()) ?? []
  const foodsById = new Map(foods.map(f => [f.id!, f]))

  async function addSavedMeal(m: SavedMeal) {
    for (const item of m.items) {
      if (foodsById.has(item.foodId)) await add(item.foodId, item.grams)
    }
    await db.savedMeals.update(m.id!, { lastUsedAt: Date.now() })
    onDone()
  }

  async function removeSavedMeal(m: SavedMeal) {
    if (window.confirm(t('diet.addFood.deleteSavedMealConfirm', { name: m.name }))) await deleteWithTombstone('savedMeals', m.id!)
  }

  async function addFood(f: Food, grams: number) {
    await add(f.id!, grams)
    onDone()
  }

  return (
    <div>
      {savedMeals.length > 0 && (
        <div className="mb-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-sub">{t('diet.addFood.savedMeals')}</p>
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
                  <span className="num shrink-0 whitespace-nowrap text-sm text-sub">
                    {tp('diet.addFood.savedMealItems', m.items.length)} · {Math.round(kcal)} kcal
                  </span>
                </button>
                <button
                  onClick={() => removeSavedMeal(m)}
                  aria-label={t('diet.addFood.deleteAria', { name: m.name })}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sub active:bg-muted/40"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            )
          })}
        </div>
      )}

      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-sub">{t('diet.addFood.recentFoods')}</p>
      {recents.length === 0 && (
        <p className="py-6 text-center text-sm text-sub">
          {t('diet.addFood.recentEmpty')}
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
          {food.userOverridden && <span className="ml-1 text-xs text-primary">{t('diet.addFood.edited')}</span>}
        </span>
        <span className="num text-xs text-sub">
          {food.brand ? `${food.brand} · ` : ''}
          {Math.round((food.kcal100 * g) / 100)} kcal
        </span>
      </button>
      <div className="num flex shrink-0 items-center gap-1 text-sm">
        <button
          onClick={() => setGrams(Math.max(5, g - 10))}
          aria-label={t('diet.addFood.lessGrams')}
          className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted/30 active:bg-muted"
        >
          −
        </button>
        <span className="w-12 text-center font-semibold">{g} g</span>
        <button
          onClick={() => setGrams(g + 10)}
          aria-label={t('diet.addFood.moreGrams')}
          className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted/30 active:bg-muted"
        >
          +
        </button>
      </div>
    </div>
  )
}

/* ---------- Search (local + online databases) ---------- */

const providerLabel = (source: RemoteFood['source']): string =>
  PROVIDERS.find(p => p.id === source)?.label ?? source

function SearchTab({ add, onDone }: { add: AddFn; onDone: () => void }) {
  const [q, setQ] = useState('')
  const [remote, setRemote] = useState<RemoteFood[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const local = useLiveQuery(async () => {
    const query = q.trim().toLowerCase()
    if (!query) return []
    return db.foods.filter(f => f.nameLower.includes(query)).limit(15).toArray()
  }, [q]) ?? []

  useEffect(() => {
    const query = q.trim()
    setError(null)
    if (query.length < 3) {
      setRemote([])
      setLoading(false)
      return
    }
    if (!navigator.onLine) {
      setError(t('diet.addFood.offline'))
      setLoading(false)
      return
    }
    setLoading(true)
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const results = await searchFoods(query, controller.signal)
        if (controller.signal.aborted) return
        setRemote(results)
        setLoading(false)
      } catch (e) {
        if (controller.signal.aborted || (e as Error).name === 'AbortError') return
        setError(t('diet.addFood.unreachable'))
        setLoading(false)
      }
    }, 400)
    // Cancel a pending timer AND any in-flight fetch on the next keystroke /
    // early-return / unmount, and ignore its late result via signal.aborted.
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [q])

  async function addLocal(f: Food) {
    await add(f.id!, defaultGrams(f))
    onDone()
  }

  async function addRemote(p: RemoteFood) {
    // Upsert by generalized key: an existing row (possibly user-edited) always wins.
    const foodId = await upsertRemoteFood(p)
    const food = await db.foods.get(foodId)
    await add(foodId, food ? defaultGrams(food) : 100)
    onDone()
  }

  // Hide online results already saved locally (matched on the same cache key).
  const localKeys = new Set(local.map(f => f.offId).filter(Boolean) as string[])
  const online = remote.filter(p => !localKeys.has(remoteFoodKey(p)))

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 rounded-xl bg-card px-3">
        <Search size={18} className="shrink-0 text-sub" />
        <input
          autoFocus
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder={t('diet.addFood.searchPlaceholder')}
          className="min-h-[48px] w-full text-base"
        />
        {loading && <Loader2 size={18} className="shrink-0 animate-spin text-sub" />}
      </div>

      {local.length > 0 && (
        <>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-sub">{t('diet.addFood.myFoods')}</p>
          {local.map(f => (
            <button
              key={f.id}
              onClick={() => addLocal(f)}
              className="flex min-h-[52px] w-full flex-col justify-center rounded-xl px-2 text-left active:bg-muted/30"
            >
              <span className="truncate font-medium">{f.name}</span>
              <span className="num text-xs text-sub">
                {f.brand ? `${f.brand} · ` : ''}
                {num(f.kcal100)} kcal/100g · {t('diet.macro.p')} {num(f.protein100)} {t('diet.macro.c')} {num(f.carbs100)} {t('diet.macro.f')} {num(f.fat100)}
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

      {online.length > 0 && (
        <>
          <p className="mb-1 mt-2 text-xs font-semibold uppercase tracking-wide text-sub">
            {t('diet.addFood.onlineDatabases')}
          </p>
          {online.map(p => (
            <button
              key={`${p.source}:${p.sourceId}`}
              onClick={() => addRemote(p)}
              className="flex min-h-[52px] w-full flex-col justify-center rounded-xl px-2 text-left active:bg-muted/30"
            >
              <span className="flex items-center gap-1.5">
                <span className="truncate font-medium">{p.name}</span>
                <span className="shrink-0 rounded bg-muted/50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sub">
                  {providerLabel(p.source)}
                </span>
              </span>
              <span className="num text-xs text-sub">
                {p.brand ? `${p.brand} · ` : ''}
                {num(p.kcal100)} kcal/100g · {t('diet.macro.p')} {num(p.protein100)} {t('diet.macro.c')} {num(p.carbs100)} {t('diet.macro.f')} {num(p.fat100)}
              </span>
            </button>
          ))}
        </>
      )}

      {q.trim().length >= 3 && !loading && online.length === 0 && local.length === 0 && !error && (
        <p className="py-6 text-center text-sm text-sub">{t('diet.addFood.noResults')}</p>
      )}
    </div>
  )
}

/* ---------- Custom ---------- */

function CustomTab({ add, planning, onDone }: { add: AddFn; planning: boolean; onDone: () => void }) {
  const [recipeMode, setRecipeMode] = useState(false)
  const [name, setName] = useState('')
  const [kcal, setKcal] = useState('')
  const [protein, setProtein] = useState('')
  const [carbs, setCarbs] = useState('')
  const [fat, setFat] = useState('')
  const [serving, setServing] = useState('')

  if (recipeMode) {
    return <RecipeBuilder add={add} planning={planning} onDone={onDone} onBack={() => setRecipeMode(false)} />
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
    await add(foodId, servingG ?? 100)
    onDone()
  }

  return (
    <div className="space-y-3">
      <Field label={t('diet.food.name')} value={name} onChange={setName} type="text" placeholder={t('diet.custom.namePlaceholder')} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="kcal / 100g" value={kcal} onChange={setKcal} placeholder="0" />
        <Field label={t('diet.food.protein100')} value={protein} onChange={setProtein} placeholder="0" />
        <Field label={t('diet.food.carbs100')} value={carbs} onChange={setCarbs} placeholder="0" />
        <Field label={t('diet.food.fat100')} value={fat} onChange={setFat} placeholder="0" />
      </div>
      <Field label={t('diet.custom.serving')} value={serving} onChange={setServing} placeholder="100" />
      <button
        onClick={save}
        disabled={!valid}
        className="w-full rounded-2xl bg-primary py-3.5 font-display text-lg font-bold text-bg active:opacity-90 disabled:opacity-40"
      >
        {planning ? t('diet.custom.savePlan') : t('diet.custom.saveLog')}
      </button>
      <button
        onClick={() => setRecipeMode(true)}
        className="flex w-full items-center justify-center gap-2 py-2 text-sm font-medium text-sub active:text-ink"
      >
        <Layers size={16} className="shrink-0" /> {t('diet.custom.fromRecipe')}
      </button>
    </div>
  )
}

/**
 * Recipe → food converter: pick raw ingredients + total cooked weight, and the
 * result becomes an ordinary per-100g food (zero extra taps at log time).
 */
function RecipeBuilder({ add, planning, onDone, onBack }: {
  add: AddFn
  planning: boolean
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
    await add(foodId, 100)
    onDone()
  }

  return (
    <div className="space-y-3">
      <button onClick={onBack} className="text-sm font-medium text-sub active:text-ink">
        {t('diet.recipe.back')}
      </button>
      <Field label={t('diet.recipe.name')} value={name} onChange={setName} type="text" placeholder={t('diet.recipe.namePlaceholder')} />

      <div>
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-sub">
          {t('diet.recipe.ingredients')}
        </span>
        <div className="flex items-center gap-2 rounded-xl bg-card px-3">
          <Search size={16} className="shrink-0 text-sub" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder={t('diet.recipe.searchPlaceholder')}
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
            <span className="num shrink-0 text-xs text-sub">{num(f.kcal100)} kcal/100g</span>
          </button>
        ))}
      </div>

      {items.map((it, idx) => (
        <div key={`${it.food.id}-${idx}`} className="flex items-center gap-2 rounded-xl bg-card px-3 py-1.5">
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{it.food.name}</span>
          <NumberStepper
            compact
            value={it.grams}
            onChange={v => setItems(list => list.map((x, i) => (i === idx ? { ...x, grams: v } : x)))}
            step={10}
            min={1}
            max={5000}
            unit="g"
          />
          <button
            onClick={() => setItems(list => list.filter((_, i) => i !== idx))}
            aria-label={t('diet.recipe.removeAria', { name: it.food.name })}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-sub active:bg-muted/40"
          >
            <X size={16} />
          </button>
        </div>
      ))}

      <Field label={t('diet.recipe.cooked')} value={cooked} onChange={setCooked} placeholder={t('diet.recipe.cookedPlaceholder')} />

      {valid && (
        <p className="num rounded-xl bg-card px-3 py-2 text-center text-sm text-sub">
          {t('diet.recipe.per100')} <b className="text-ink">{num(per100.kcal100)} kcal</b> · {t('diet.macro.p')}{' '}
          {num(per100.protein100)} · {t('diet.macro.c')} {num(per100.carbs100)} · {t('diet.macro.f')}{' '}
          {num(per100.fat100)}
        </p>
      )}

      <button
        onClick={save}
        disabled={!valid}
        className="w-full rounded-2xl bg-primary py-3.5 font-display text-lg font-bold text-bg active:opacity-90 disabled:opacity-40"
      >
        {planning ? t('diet.recipe.savePlan') : t('diet.recipe.saveLog')}
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
