import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft, ChevronRight, Plus, Copy, BookmarkPlus, Dumbbell, BedDouble, ArrowLeftRight } from 'lucide-react'
import { db } from '../../db/db'
import { localDateStr, addDays, fmtDate, parseLocalDate } from '../../lib/dates'
import { macrosFor, totalsForLogs, logFood, dayTargets } from '../../lib/nutrition'
import ProgressRing from '../../components/ProgressRing'
import AddFoodSheet from './AddFoodSheet'
import EntryEditor from './EntryEditor'
import type { FoodLog, MealType } from '../../types'

const MEALS: { key: MealType; label: string }[] = [
  { key: 'breakfast', label: 'Breakfast' },
  { key: 'lunch', label: 'Lunch' },
  { key: 'dinner', label: 'Dinner' },
  { key: 'snack', label: 'Snacks' },
]

export default function DietDay() {
  const [date, setDate] = useState(localDateStr())
  const [addMeal, setAddMeal] = useState<MealType | null>(null)
  const [editLog, setEditLog] = useState<FoodLog | null>(null)

  const logs = useLiveQuery(() => db.foodLogs.where('date').equals(date).toArray(), [date]) ?? []
  const yLogs = useLiveQuery(
    () => db.foodLogs.where('date').equals(addDays(date, -1)).toArray(),
    [date],
  ) ?? []
  const foods = useLiveQuery(() => db.foods.toArray()) ?? []
  const settings = useLiveQuery(() => db.settings.get(1))

  // A day is a training day when a workout was logged on it; tap the chip to override.
  const dayStartMs = parseLocalDate(date).getTime()
  const hasSession =
    (useLiveQuery(
      () => db.sessions.where('startedAt').between(dayStartMs, dayStartMs + 86_400_000).count(),
      [dayStartMs],
    ) ?? 0) > 0
  const override = useLiveQuery(() => db.dayTypes.get(date), [date])
  const isTraining = override ? override.type === 'training' : hasSession

  async function toggleDayType() {
    const next = isTraining ? 'rest' : 'training'
    const auto = hasSession ? 'training' : 'rest'
    if (next === auto) await db.dayTypes.delete(date)
    else await db.dayTypes.put({ date, type: next })
  }

  const foodsById = useMemo(() => new Map(foods.map(f => [f.id!, f])), [foods])
  const totals = totalsForLogs(logs, foodsById)
  const tg = settings ? dayTargets(settings, isTraining) : undefined

  async function copyYesterday(meal: MealType) {
    for (const l of yLogs.filter(l => l.meal === meal)) {
      await logFood(l.foodId, l.grams, date, meal)
    }
  }

  async function saveAsMeal(meal: MealType) {
    const entries = logs.filter(l => l.meal === meal)
    if (entries.length === 0) return
    const name = window.prompt('Name this meal:', MEALS.find(m => m.key === meal)?.label)
    if (!name?.trim()) return
    await db.savedMeals.add({
      name: name.trim(),
      items: entries.map(e => ({ foodId: e.foodId, grams: e.grams })),
      lastUsedAt: Date.now(),
    })
  }

  return (
    <div className="pt-4">
      <div className="mb-4 flex items-center justify-between">
        <button
          onClick={() => setDate(addDays(date, -1))}
          aria-label="Previous day"
          className="flex h-11 w-11 items-center justify-center rounded-xl text-sub active:bg-muted/40"
        >
          <ChevronLeft size={24} />
        </button>
        <button
          onClick={() => setDate(localDateStr())}
          className="font-display text-2xl font-bold active:opacity-70"
        >
          {fmtDate(date)}
        </button>
        <button
          onClick={() => setDate(addDays(date, 1))}
          aria-label="Next day"
          className="flex h-11 w-11 items-center justify-center rounded-xl text-sub active:bg-muted/40"
        >
          <ChevronRight size={24} />
        </button>
      </div>

      <div className="mb-5 rounded-2xl border border-edge bg-card p-4">
        <button
          onClick={toggleDayType}
          aria-label="Switch between training and rest day targets"
          className={`mb-3 flex min-h-[36px] items-center gap-1.5 rounded-full px-3 text-xs font-semibold ${
            isTraining ? 'bg-primary/15 text-primary' : 'bg-muted/40 text-sub'
          }`}
        >
          {isTraining ? <Dumbbell size={13} /> : <BedDouble size={13} />}
          {isTraining ? 'Training day' : 'Rest day'}
          <ArrowLeftRight size={11} className="opacity-60" />
        </button>
        <div className="flex items-center justify-around">
          <ProgressRing size={92} stroke={9} progress={tg ? totals.kcal / tg.kcal : 0} color="#F97316">
            <span className="num font-display text-xl font-bold">{Math.round(totals.kcal)}</span>
            <span className="text-[10px] font-medium uppercase text-sub">/ {tg?.kcal} kcal</span>
          </ProgressRing>
          <MacroRing label="P" value={totals.protein} target={tg?.protein} color="#22C55E" />
          <MacroRing label="C" value={totals.carbs} target={tg?.carbs} color="#3FC1C9" />
          <MacroRing label="F" value={totals.fat} target={tg?.fat} color="#E8B93B" />
        </div>
      </div>

      <div className="space-y-4">
        {MEALS.map(({ key, label }) => {
          const entries = logs.filter(l => l.meal === key)
          const mealKcal = entries.reduce((acc, l) => {
            const f = foodsById.get(l.foodId)
            return acc + (f ? macrosFor(f, l.grams).kcal : 0)
          }, 0)
          const hasYesterday = yLogs.some(l => l.meal === key)
          return (
            <section key={key} className="rounded-2xl border border-edge bg-card">
              <div className="flex items-center justify-between px-4 pt-3">
                <h2 className="font-display text-lg font-semibold">{label}</h2>
                <div className="flex items-center gap-1">
                  {entries.length > 0 && (
                    <>
                      <span className="num mr-1 text-sm text-sub">{Math.round(mealKcal)} kcal</span>
                      <button
                        onClick={() => saveAsMeal(key)}
                        aria-label={`Save ${label} as meal`}
                        className="flex h-10 w-10 items-center justify-center rounded-lg text-sub active:bg-muted/40"
                      >
                        <BookmarkPlus size={18} />
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => setAddMeal(key)}
                    aria-label={`Add food to ${label}`}
                    className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15 text-primary active:bg-primary/30"
                  >
                    <Plus size={20} />
                  </button>
                </div>
              </div>
              <div className="px-2 pb-2 pt-1">
                {entries.map(l => {
                  const f = foodsById.get(l.foodId)
                  if (!f) return null
                  const m = macrosFor(f, l.grams)
                  return (
                    <button
                      key={l.id}
                      onClick={() => setEditLog(l)}
                      className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left active:bg-muted/30"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px] font-medium">{f.name}</p>
                        <p className="num text-xs text-sub">
                          {l.grams} g · P {m.protein.toFixed(0)} · C {m.carbs.toFixed(0)} · F {m.fat.toFixed(0)}
                        </p>
                      </div>
                      <span className="num text-sm font-semibold">{Math.round(m.kcal)}</span>
                    </button>
                  )
                })}
                {entries.length === 0 && (
                  <div className="flex items-center justify-between px-2 py-1.5">
                    <p className="text-sm text-sub">Nothing logged.</p>
                    {hasYesterday && (
                      <button
                        onClick={() => copyYesterday(key)}
                        className="flex min-h-[40px] items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-primary active:bg-muted/30"
                      >
                        <Copy size={15} /> Copy yesterday
                      </button>
                    )}
                  </div>
                )}
              </div>
            </section>
          )
        })}
      </div>

      {addMeal && (
        <AddFoodSheet open onClose={() => setAddMeal(null)} date={date} meal={addMeal} />
      )}
      {editLog && (
        <EntryEditor open log={editLog} food={foodsById.get(editLog.foodId)} onClose={() => setEditLog(null)} />
      )}
    </div>
  )
}

function MacroRing({ label, value, target, color }: {
  label: string; value: number; target?: number; color: string
}) {
  return (
    <ProgressRing size={64} stroke={6} progress={target ? value / target : 0} color={color}>
      <span className="num font-display text-base font-bold">{Math.round(value)}</span>
      <span className="text-[9px] font-medium uppercase text-sub">
        {label} / {target ?? '—'}
      </span>
    </ProgressRing>
  )
}
