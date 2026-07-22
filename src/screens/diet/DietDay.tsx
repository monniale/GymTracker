import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft, ChevronRight, Plus, Copy, BookmarkPlus, Dumbbell, BedDouble, ArrowLeftRight, Droplets, Minus, ChevronDown, ChevronUp, ClipboardList } from 'lucide-react'
import { db, deleteWithTombstone } from '../../db/db'
import { localDateStr, addDays, fmtDate, parseLocalDate } from '../../lib/dates'
import { macrosFor, totalsForLogs, logFood, dayTargets } from '../../lib/nutrition'
import { gatherWeekNutrition } from '../../lib/dietReport'
import ProgressRing from '../../components/ProgressRing'
import DietCoachCard from '../../components/DietCoachCard'
import MacroCompletionCard from '../../components/MacroCompletionCard'
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
    if (next === auto) await deleteWithTombstone('dayTypes', date)
    else await db.dayTypes.put({ date, type: next })
  }

  const foodsById = useMemo(() => new Map(foods.map(f => [f.id!, f])), [foods])
  const totals = totalsForLogs(logs, foodsById)
  const tg = settings ? dayTargets(settings, isTraining) : undefined
  const remaining = tg
    ? {
        kcal: tg.kcal - totals.kcal,
        protein: tg.protein - totals.protein,
        carbs: tg.carbs - totals.carbs,
        fat: tg.fat - totals.fat,
      }
    : undefined

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
        <WaterRow date={date} targetMl={settings?.waterTargetMl ?? 2500} />
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

      {remaining && <MacroCompletionCard key={date} date={date} remaining={remaining} />}

      <WeekReport date={date} />

      {logs.length > 0 && <DietCoachCard date={date} />}

      {addMeal && (
        <AddFoodSheet open onClose={() => setAddMeal(null)} date={date} meal={addMeal} />
      )}
      {editLog && (
        <EntryEditor open log={editLog} food={foodsById.get(editLog.foodId)} onClose={() => setEditLog(null)} />
      )}
    </div>
  )
}

function WaterRow({ date, targetMl }: { date: string; targetMl: number }) {
  const logs = useLiveQuery(() => db.waterLogs.where('date').equals(date).toArray(), [date]) ?? []
  const total = logs.reduce((a, l) => a + l.ml, 0)

  async function add() {
    await db.waterLogs.add({ date, ml: 250 })
  }
  async function undo() {
    const last = logs[logs.length - 1]
    if (last) await deleteWithTombstone('waterLogs', last.id!)
  }

  return (
    <div className="mt-3 flex items-center gap-2 border-t border-edge/50 pt-3">
      <Droplets size={18} className="shrink-0 text-[#3FC1C9]" aria-hidden />
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted/30">
        <div
          className="h-full rounded-full bg-[#3FC1C9] transition-[width] duration-300"
          style={{ width: `${Math.min(100, (total / targetMl) * 100)}%` }}
        />
      </div>
      <span className="num text-xs font-semibold text-sub">
        {total} / {targetMl} ml
      </span>
      <button
        onClick={undo}
        aria-label="Undo water"
        disabled={total === 0}
        className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted/30 text-sub active:bg-muted disabled:opacity-30"
      >
        <Minus size={15} />
      </button>
      <button
        onClick={add}
        aria-label="Add 250ml water"
        className="num flex h-9 items-center justify-center rounded-lg bg-[#3FC1C9]/15 px-2.5 text-xs font-bold text-[#3FC1C9] active:bg-[#3FC1C9]/30"
      >
        +250
      </button>
    </div>
  )
}

function WeekReport({ date }: { date: string }) {
  const [open, setOpen] = useState(false)
  const report = useLiveQuery(
    () => (open ? gatherWeekNutrition(date) : Promise.resolve(null)),
    [open, date],
  )

  return (
    <section className="mt-4 rounded-2xl border border-edge bg-card">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 font-display text-lg font-semibold">
          <ClipboardList size={18} className="text-sub" /> Last 7 days
        </span>
        {open ? <ChevronUp size={18} className="text-sub" /> : <ChevronDown size={18} className="text-sub" />}
      </button>
      {open && report && (
        <div className="border-t border-edge/60 px-4 py-3">
          {report.loggedDays === 0 ? (
            <p className="text-sm text-sub">No food logged in the last 7 days.</p>
          ) : (
            <div className="num grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <Stat label="Avg calories" value={`${report.avgKcal} kcal`} />
              <Stat label="Avg protein" value={`${report.avgProtein} g (${report.proteinPerKg} g/kg)`} />
              <Stat label="On-target days (±10%)" value={`${report.adherent} / ${report.loggedDays}`} />
              <Stat label="Training days" value={`${report.trainingDays} / 7`} />
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-sub">{label}</p>
      <p className="font-semibold">{value}</p>
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
