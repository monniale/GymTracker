import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft, ChevronRight, Plus, Copy, BookmarkPlus, Dumbbell, BedDouble, ArrowLeftRight, Droplets, Minus, ChevronDown, ChevronUp, ClipboardList, CalendarPlus, Utensils } from 'lucide-react'
import { db, deleteWithTombstone } from '../../db/db'
import { localDateStr, addDays, fmtDate, parseLocalDate } from '../../lib/dates'
import { macrosFor, totalsForLogs, logFood, dayTargets, addTotals } from '../../lib/nutrition'
import { copyToPlan, eatAllPlanned, eatPlanned } from '../../lib/mealPlan'
import { gatherWeekNutrition } from '../../lib/dietReport'
import { useLocalToday } from '../../lib/hooks'
import { haptic } from '../../native/haptics'
import { t, fmtNum, type Key } from '../../i18n'
import ProgressRing from '../../components/ProgressRing'
import DietCoachCard from '../../components/DietCoachCard'
import MacroCompletionCard from '../../components/MacroCompletionCard'
import DemoBanner from '../../components/DemoBanner'
import AddFoodSheet from './AddFoodSheet'
import EntryEditor from './EntryEditor'
import PlannedEntrySheet from './PlannedEntrySheet'
import SupplementsCard from './SupplementsCard'
import type { FoodLog, MealType, PlannedFood } from '../../types'

const MEALS: { key: MealType; labelKey: Key }[] = [
  { key: 'breakfast', labelKey: 'diet.meals.breakfast' },
  { key: 'lunch', labelKey: 'diet.meals.lunch' },
  { key: 'dinner', labelKey: 'diet.meals.dinner' },
  { key: 'snack', labelKey: 'diet.meals.snack' },
]

export default function DietDay() {
  const today = useLocalToday()
  // Opened on a given past day (Coach history › Diet day), else today.
  const opened = (useLocation().state as { date?: string } | null)?.date
  const [date, setDate] = useState(() =>
    opened && /^\d{4}-\d{2}-\d{2}$/.test(opened) && opened <= today ? opened : today)
  // Follow "today" across a day rollover (the app resumed the next morning, e.g. from a meal
  // reminder), but leave a day the user navigated to alone.
  const prevToday = useRef(today)
  useEffect(() => {
    if (today === prevToday.current) return
    const was = prevToday.current
    prevToday.current = today
    setDate(d => (d === was ? today : d))
  }, [today])
  const [addMeal, setAddMeal] = useState<MealType | null>(null)
  const [editLog, setEditLog] = useState<FoodLog | null>(null)
  const [editPlan, setEditPlan] = useState<PlannedFood | null>(null)

  // A future day opens in planning mode (adds go to the meal plan); the toggle can switch it
  // back to logging. Derived from `today`, so after midnight tomorrow's plan is simply "today".
  const [logFuture, setLogFuture] = useState(false)
  useEffect(() => setLogFuture(false), [date])
  const isFuture = date > today
  const planning = isFuture && !logFuture
  const canEat = date <= today

  const logs = useLiveQuery(() => db.foodLogs.where('date').equals(date).toArray(), [date]) ?? []
  const planned = useLiveQuery(() => db.plannedFoods.where('date').equals(date).sortBy('plannedAt'), [date]) ?? []
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
  const withPlan = addTotals(totals, totalsForLogs(planned, foodsById))
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
    const items = yLogs.filter(l => l.meal === meal)
    if (planning) {
      await copyToPlan(items, date, meal)
      return
    }
    for (const l of items) {
      await logFood(l.foodId, l.grams, date, meal)
    }
  }

  async function saveAsMeal(meal: MealType) {
    const entries = (planning ? planned : logs).filter(l => l.meal === meal)
    if (entries.length === 0) return
    const labelKey = MEALS.find(m => m.key === meal)?.labelKey
    const label = t(labelKey ?? 'diet.meals.fallback')
    const raw = window.prompt(t('diet.day.saveMealPrompt'), label)
    if (raw === null) return // cancelled
    // The Android WebView prompt ignores the default value, so OK on an empty field = default name.
    const name = raw.trim() || label
    await db.savedMeals.add({
      name,
      items: entries.map(e => ({ foodId: e.foodId, grams: e.grams })),
      lastUsedAt: Date.now(),
    })
  }

  const P = t('diet.macro.p')
  const C = t('diet.macro.c')
  const F = t('diet.macro.f')

  return (
    <div className="pt-4">
      <DemoBanner />
      <div className="mb-4 flex items-center justify-between">
        <button
          onClick={() => setDate(addDays(date, -1))}
          aria-label={t('diet.day.prevDay')}
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
          aria-label={t('diet.day.nextDay')}
          className="flex h-11 w-11 items-center justify-center rounded-xl text-sub active:bg-muted/40"
        >
          <ChevronRight size={24} />
        </button>
      </div>

      <div className="mb-5 rounded-2xl border border-edge bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button
            onClick={toggleDayType}
            aria-label={t('diet.day.dayTypeAria')}
            className={`flex min-h-[36px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-semibold ${
              isTraining ? 'bg-primary/15 text-primary' : 'bg-muted/40 text-sub'
            }`}
          >
            {isTraining ? <Dumbbell size={13} /> : <BedDouble size={13} />}
            {isTraining ? t('diet.day.trainingDay') : t('diet.day.restDay')}
            <ArrowLeftRight size={11} className="opacity-60" />
          </button>
          {date === today && (
            <button
              onClick={() => setDate(addDays(today, 1))}
              className="flex min-h-[36px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-muted/40 px-3 text-xs font-semibold text-sub active:bg-muted"
            >
              <CalendarPlus size={13} aria-hidden /> {t('diet.day.planTomorrow')}
            </button>
          )}
          {isFuture && (
            <div className="flex shrink-0 rounded-full bg-muted/30 p-0.5 text-xs font-semibold" role="group" aria-label={t('diet.day.addModeAria')}>
              {([['diet.day.planning', false], ['diet.day.logging', true]] as const).map(([label, value]) => (
                <button
                  key={label}
                  onClick={() => setLogFuture(value)}
                  aria-pressed={logFuture === value}
                  className={`min-h-[32px] whitespace-nowrap rounded-full px-3 ${
                    logFuture === value ? 'bg-primary/20 text-primary' : 'text-sub'
                  }`}
                >
                  {t(label)}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center justify-around">
          <ProgressRing size={92} boxSize="clamp(76px, 25vw, 92px)" stroke={9} progress={tg ? totals.kcal / tg.kcal : 0} color="#F97316">
            <span className="num font-display text-xl font-bold">{Math.round(totals.kcal)}</span>
            <span className="text-[10px] font-medium uppercase text-sub">/ {tg?.kcal} kcal</span>
          </ProgressRing>
          <MacroRing label={P} value={totals.protein} target={tg?.protein} color="#22C55E" />
          <MacroRing label={C} value={totals.carbs} target={tg?.carbs} color="#3FC1C9" />
          <MacroRing label={F} value={totals.fat} target={tg?.fat} color="#E8B93B" />
        </div>
        {planned.length > 0 && tg && (
          <p className="num mt-2 flex flex-wrap justify-center gap-x-2 text-xs text-sub">
            <span className="whitespace-nowrap font-semibold text-ink">{t('diet.day.withPlan')}</span>
            <span className="whitespace-nowrap">{Math.round(withPlan.kcal)} / {tg.kcal} kcal</span>
            <span className="whitespace-nowrap">{P} {Math.round(withPlan.protein)}/{tg.protein}</span>
            <span className="whitespace-nowrap">{C} {Math.round(withPlan.carbs)}/{tg.carbs}</span>
            <span className="whitespace-nowrap">{F} {Math.round(withPlan.fat)}/{tg.fat}</span>
          </p>
        )}
        <WaterRow date={date} targetMl={settings?.waterTargetMl ?? 2500} />
      </div>

      <SupplementsCard date={date} today={today} />

      <div className="space-y-4">
        {MEALS.map(({ key, labelKey }) => {
          const label = t(labelKey)
          const entries = logs.filter(l => l.meal === key)
          const plannedEntries = planned.filter(p => p.meal === key)
          const kcalOf = (rows: { foodId: FoodLog['foodId']; grams: number }[]) => rows.reduce((acc, l) => {
            const f = foodsById.get(l.foodId)
            return acc + (f ? macrosFor(f, l.grams).kcal : 0)
          }, 0)
          const mealKcal = kcalOf(entries)
          const plannedKcal = kcalOf(plannedEntries)
          const savable = planning ? plannedEntries : entries
          const hasYesterday = yLogs.some(l => l.meal === key)
          return (
            <section key={key} className="rounded-2xl border border-edge bg-card">
              <div className="flex items-center justify-between px-4 pt-3">
                <h2 className="font-display text-lg font-semibold">{label}</h2>
                <div className="flex items-center gap-1">
                  {entries.length > 0 && (
                    <span className="num mr-1 text-sm text-sub">{Math.round(mealKcal)} kcal</span>
                  )}
                  {savable.length > 0 && (
                    <>
                      <button
                        onClick={() => saveAsMeal(key)}
                        aria-label={t('diet.day.saveMealAria', { meal: label })}
                        className="flex h-10 w-10 items-center justify-center rounded-lg text-sub active:bg-muted/40"
                      >
                        <BookmarkPlus size={18} />
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => setAddMeal(key)}
                    aria-label={t(planning ? 'diet.day.planFoodAria' : 'diet.day.addFoodAria', { meal: label })}
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
                          {l.grams} g · {P} {m.protein.toFixed(0)} · {C} {m.carbs.toFixed(0)} · {F} {m.fat.toFixed(0)}
                        </p>
                      </div>
                      <span className="num text-sm font-semibold">{Math.round(m.kcal)}</span>
                    </button>
                  )
                })}
                {plannedEntries.length > 0 && (
                  <div className={`mt-1 rounded-xl border border-dashed border-edge p-1 ${date < today ? 'opacity-60' : ''}`}>
                    <div className="flex items-center gap-2 px-2 pt-1">
                      <span className="min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-wide text-sub">
                        {date < today ? t('diet.day.plannedNotEaten') : t('diet.day.planned')}
                      </span>
                      <span className="num shrink-0 text-xs text-sub">{Math.round(plannedKcal)} kcal</span>
                      {canEat && (
                        <button
                          onClick={() => {
                            haptic('tap')
                            void eatAllPlanned(date, key)
                          }}
                          className="flex min-h-[36px] shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-2 text-xs font-semibold text-primary active:bg-muted/30"
                        >
                          <Utensils size={13} aria-hidden /> {t('diet.day.eatAll')}
                        </button>
                      )}
                    </div>
                    {plannedEntries.map(p => {
                      const f = foodsById.get(p.foodId)
                      if (!f) return null
                      const m = macrosFor(f, p.grams)
                      return (
                        <div key={p.id} className="flex items-center gap-1">
                          <button
                            onClick={() => setEditPlan(p)}
                            className="flex min-w-0 flex-1 items-center gap-2 rounded-xl px-2 py-2 text-left active:bg-muted/30"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[15px] font-medium text-ink/80">{f.name}</p>
                              <p className="num text-xs text-sub">
                                {p.grams} g · {P} {m.protein.toFixed(0)} · {C} {m.carbs.toFixed(0)} · {F} {m.fat.toFixed(0)}
                              </p>
                            </div>
                            <span className="num shrink-0 text-sm font-semibold text-sub">{Math.round(m.kcal)}</span>
                          </button>
                          {canEat && (
                            <button
                              onClick={() => {
                                haptic('tap')
                                void eatPlanned([p.id!])
                              }}
                              aria-label={t('diet.day.eatAria', { food: f.name })}
                              className="flex h-10 shrink-0 items-center whitespace-nowrap rounded-lg bg-primary/15 px-2.5 text-xs font-bold text-primary active:bg-primary/30"
                            >
                              {t('diet.day.eat')}
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
                {entries.length === 0 && plannedEntries.length === 0 && (
                  <div className="flex items-center justify-between px-2 py-1.5">
                    <p className="min-w-0 text-sm text-sub">{planning ? t('diet.day.nothingPlanned') : t('diet.day.nothingLogged')}</p>
                    {hasYesterday && (
                      <button
                        onClick={() => copyYesterday(key)}
                        className="flex min-h-[40px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-sm font-medium text-primary active:bg-muted/30"
                      >
                        <Copy size={15} /> {t('diet.day.copyYesterday')}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </section>
          )
        })}
      </div>

      {remaining && canEat && <MacroCompletionCard key={date} date={date} remaining={remaining} />}

      <WeekReport date={date} />

      {logs.length > 0 && <DietCoachCard date={date} />}

      {addMeal && (
        <AddFoodSheet open onClose={() => setAddMeal(null)} date={date} meal={addMeal} target={planning ? 'plan' : 'log'} />
      )}
      {editLog && (
        <EntryEditor open log={editLog} food={foodsById.get(editLog.foodId)} onClose={() => setEditLog(null)} />
      )}
      {editPlan && (
        <PlannedEntrySheet
          open
          plan={editPlan}
          food={foodsById.get(editPlan.foodId)}
          canEat={canEat}
          onClose={() => setEditPlan(null)}
        />
      )}
    </div>
  )
}

function WaterRow({ date, targetMl }: { date: string; targetMl: number }) {
  const logs = useLiveQuery(() => db.waterLogs.where('date').equals(date).toArray(), [date]) ?? []
  const total = logs.reduce((a, l) => a + l.ml, 0)

  async function add() {
    haptic('tap')
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
        aria-label={t('diet.water.undo')}
        disabled={total === 0}
        className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted/30 text-sub active:bg-muted disabled:opacity-30"
      >
        <Minus size={15} />
      </button>
      <button
        onClick={add}
        aria-label={t('diet.water.add')}
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
          <ClipboardList size={18} className="text-sub" /> {t('diet.week.title')}
        </span>
        {open ? <ChevronUp size={18} className="text-sub" /> : <ChevronDown size={18} className="text-sub" />}
      </button>
      {open && report && (
        <div className="border-t border-edge/60 px-4 py-3">
          {report.loggedDays === 0 ? (
            <p className="text-sm text-sub">{t('diet.week.empty')}</p>
          ) : (
            <div className="num grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <Stat label={t('diet.week.avgKcal')} value={`${report.avgKcal} kcal`} />
              <Stat label={t('diet.week.avgProtein')} value={`${report.avgProtein} g (${fmtNum(report.proteinPerKg, { useGrouping: false })} g/kg)`} />
              <Stat label={t('diet.week.onTarget')} value={`${report.adherent} / ${report.loggedDays}`} />
              <Stat label={t('diet.week.trainingDays')} value={`${report.trainingDays} / 7`} />
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
    <ProgressRing size={64} boxSize="clamp(54px, 17.5vw, 64px)" stroke={6} progress={target ? value / target : 0} color={color}>
      <span className="num font-display text-base font-bold">{Math.round(value)}</span>
      <span className="text-[9px] font-medium uppercase text-sub">
        {label} / {target ?? '—'}
      </span>
    </ProgressRing>
  )
}
