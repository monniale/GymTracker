import { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { db } from '../../db/db'
import Sheet from '../../components/Sheet'
import NumberStepper from '../../components/NumberStepper'
import SegmentedControl from '../../components/SegmentedControl'
import { localDateStr } from '../../lib/dates'
import {
  ageFrom,
  bmrMifflin,
  goalEta,
  plannedRateKgPerWeek,
  RATE_CHOICES,
  rateChoice,
  targetsFor,
  targetsPatch,
  tdee as tdeeOf,
  type Activity,
  type MacroTargets,
  type Sex,
} from '../../lib/tdee'
import { goalBounds, goalWeightFor, initialGoal, type Goal } from '../../lib/goalDirection'
import type { Settings } from '../../types'
import { fmtNum, t, tp } from '../../i18n'

const ACTIVITIES: Activity[] = ['sedentary', 'light', 'moderate', 'active', 'very']

function initialRate(s: Settings, goal: Goal): number {
  return rateChoice(goal === 'maintain' ? 'lose' : goal, s.goalRatePctPerWeek)
}

const RATES_FOR = (goal: 'lose' | 'gain') =>
  RATE_CHOICES[goal].map(r => ({ value: String(r), label: `${fmtNum(r)}%` }))

const signed = (n: number, digits = 0) =>
  fmtNum(n, { signDisplay: 'exceptZero', maximumFractionDigits: digits, minimumFractionDigits: digits })

/**
 * TDEE / macro calculator: profile + activity + goal → training and rest day targets.
 * Calls `onApply` with the 8 targets plus the profile fields; the caller writes them.
 */
export function TargetsCalculatorForm({
  settings,
  onApply,
  onSkip,
  applyLabel,
}: {
  settings: Settings
  onApply: (patch: Partial<Settings>) => void
  onSkip?: () => void
  applyLabel?: string
}) {
  const today = localDateStr()
  const thisYear = Number(today.slice(0, 4))
  const [sex, setSex] = useState<Sex>(settings.sex ?? 'm')
  const [birthYear, setBirthYear] = useState(settings.birthYear ?? thisYear - 30)
  const [heightCm, setHeightCm] = useState(settings.heightCm ?? (settings.sex === 'f' ? 165 : 175))
  const [activity, setActivity] = useState<Activity>(settings.activity ?? 'moderate')
  const [goal, setGoal] = useState<Goal>(() => initialGoal(settings))
  const [rate, setRate] = useState(() => initialRate(settings, initialGoal(settings)))
  const [goalKg, setGoalKg] = useState(() => {
    const g = initialGoal(settings)
    return g === 'maintain' ? settings.bodyweightKg : goalWeightFor(g, settings.bodyweightKg, settings.goalWeightKg)
  })
  const [advanced, setAdvanced] = useState(false)
  const [proteinPerKg, setProteinPerKg] = useState(1.8)
  const [fatPct, setFatPct] = useState(28)

  const weightKg = settings.bodyweightKg
  const goalRatePctPerWeek = goal === 'lose' ? -rate : goal === 'gain' ? rate : 0

  const calc = useMemo(() => {
    const bmr = bmrMifflin({ sex, ageYears: ageFrom(birthYear, today), heightCm, weightKg })
    const tdee = tdeeOf(bmr, activity)
    const result = targetsFor({
      tdee,
      bmr,
      weightKg,
      goalRatePctPerWeek,
      proteinGPerKg: proteinPerKg,
      fatPct: fatPct / 100,
    })
    return { tdee, result }
  }, [sex, birthYear, today, heightCm, weightKg, activity, goalRatePctPerWeek, proteinPerKg, fatPct])

  const pickGoal = (g: Goal) => {
    setGoal(g)
    if (g === 'maintain') return
    setRate(rateChoice(g, rate))
    setGoalKg(goalWeightFor(g, weightKg, goalKg))
  }

  // Maintain clears the goal weight: the goal is the current weight.
  const apply = () =>
    onApply({
      ...targetsPatch(calc.result),
      sex,
      birthYear,
      heightCm,
      activity,
      goalRatePctPerWeek,
      goalWeightKg: goal === 'maintain' ? undefined : goalKg,
    })

  const kgPerWeek = plannedRateKgPerWeek(weightKg, goalRatePctPerWeek)
  const etaWeeks = goal === 'maintain' ? null : goalEta(weightKg, goalKg, kgPerWeek)
  const [goalMin, goalMax] = goal === 'maintain' ? [0, 0] : goalBounds(goal, weightKg)

  return (
    <div className="space-y-4">
      <Field label={t('settings.calc.sex.title')}>
        <SegmentedControl
          value={sex}
          onChange={setSex}
          ariaLabel={t('settings.calc.sex.title')}
          options={[
            { value: 'm', label: t('settings.calc.sex.m') },
            { value: 'f', label: t('settings.calc.sex.f') },
          ]}
        />
      </Field>

      <div className="flex flex-wrap justify-around gap-3">
        <NumberStepper
          label={t('settings.calc.birthYear')}
          compact="narrow"
          value={birthYear}
          onChange={v => setBirthYear(Math.round(v))}
          step={1}
          min={thisYear - 100}
          max={thisYear - 14}
        />
        <NumberStepper
          label={t('settings.calc.height')}
          compact="narrow"
          value={heightCm}
          onChange={v => setHeightCm(Math.round(v))}
          step={1}
          min={120}
          max={230}
          unit="cm"
        />
      </div>

      <p className="text-sm text-sub">{t('settings.calc.weight', { kg: fmtNum(weightKg) })}</p>

      <Field label={t('settings.calc.activity.title')}>
        <div role="group" aria-label={t('settings.calc.activity.title')} className="space-y-1">
          {ACTIVITIES.map(a => {
            const active = activity === a
            return (
              <button
                key={a}
                type="button"
                aria-pressed={active}
                onClick={() => setActivity(a)}
                className={`block min-h-[44px] w-full rounded-xl border px-3 py-1.5 text-left ${
                  active ? 'border-primary/60 bg-primary/15' : 'border-edge bg-card active:bg-muted/40'
                }`}
              >
                <span className={`block text-sm font-semibold ${active ? 'text-primary' : ''}`}>
                  {t(`settings.calc.activity.${a}`)}
                </span>
                <span className="block text-xs leading-snug text-sub">{t(`settings.calc.activityHint.${a}`)}</span>
              </button>
            )
          })}
        </div>
      </Field>

      <Field label={t('settings.calc.goal.title')}>
        <SegmentedControl
          value={goal}
          onChange={pickGoal}
          ariaLabel={t('settings.calc.goal.title')}
          options={[
            { value: 'lose', label: t('settings.calc.goal.lose') },
            { value: 'maintain', label: t('settings.calc.goal.maintain') },
            { value: 'gain', label: t('settings.calc.goal.gain') },
          ]}
        />
        {goal !== 'maintain' && (
          <div className="mt-2">
            <SegmentedControl
              value={String(rate)}
              onChange={v => setRate(Number(v))}
              ariaLabel={t('settings.calc.rate')}
              options={RATES_FOR(goal)}
            />
            <p className="mt-1 text-xs text-sub">
              {t('settings.calc.ratePerWeek', { pct: signed(goalRatePctPerWeek, 2), kg: signed(kgPerWeek, 2) })}
            </p>
            <div className="mt-3 flex justify-center">
              <NumberStepper
                label={t('settings.calc.goalWeight')}
                compact="narrow"
                value={goalKg}
                onChange={setGoalKg}
                step={0.5}
                min={goalMin}
                max={goalMax}
                unit={t('units.kg')}
              />
            </div>
            <p className="num mt-1 text-center text-xs text-sub">
              {etaWeeks === null ? t('settings.calc.etaFar') : tp('settings.calc.eta', etaWeeks)}
            </p>
          </div>
        )}
      </Field>

      <div>
        <button
          type="button"
          aria-expanded={advanced}
          onClick={() => setAdvanced(v => !v)}
          className="flex min-h-[44px] items-center gap-1 whitespace-nowrap text-sm font-semibold text-sub"
        >
          {t('settings.calc.advanced')}
          {advanced ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        {advanced && (
          <div className="mt-1 flex flex-wrap justify-around gap-3">
            <NumberStepper
              label={t('settings.calc.proteinPerKg')}
              compact="narrow"
              value={proteinPerKg}
              onChange={v => setProteinPerKg(Math.round(v * 10) / 10)}
              step={0.1}
              min={1.6}
              max={2.2}
            />
            <NumberStepper
              label={t('settings.calc.fatPct')}
              compact="narrow"
              value={fatPct}
              onChange={v => setFatPct(Math.round(v))}
              step={1}
              min={25}
              max={30}
              unit="%"
            />
          </div>
        )}
      </div>

      <Preview tdee={calc.tdee} result={calc.result} />

      <p className="text-xs text-sub">{t('settings.calc.disclaimer')}</p>

      <div className="flex flex-wrap gap-2">
        {onSkip && (
          <button
            type="button"
            onClick={onSkip}
            className="min-h-[44px] flex-1 whitespace-nowrap rounded-2xl border border-edge px-4 py-3 font-semibold text-sub active:bg-muted/40"
          >
            {t('settings.calc.skip')}
          </button>
        )}
        <button
          type="button"
          onClick={apply}
          className="min-h-[44px] flex-[2] whitespace-nowrap rounded-2xl bg-primary px-4 py-3 font-display text-lg font-bold text-bg active:opacity-90"
        >
          {applyLabel ?? t('settings.calc.apply')}
        </button>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-sub">{label}</p>
      {children}
    </div>
  )
}

function Preview({
  tdee,
  result,
}: {
  tdee: number
  result: { training: MacroTargets; rest: MacroTargets; dailyDeltaKcal: number }
}) {
  const rows: [string, MacroTargets][] = [
    [t('settings.calc.preview.training'), result.training],
    [t('settings.calc.preview.rest'), result.rest],
  ]
  return (
    <div className="rounded-xl border border-edge bg-card p-3">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-sub">
            <th className="text-left font-medium" />
            <th className="px-1 text-right font-medium">{t('settings.calc.preview.kcal')}</th>
            <th className="px-1 text-right font-medium">{t('settings.calc.preview.protein')}</th>
            <th className="px-1 text-right font-medium">{t('settings.calc.preview.carbs')}</th>
            <th className="pl-1 text-right font-medium">{t('settings.calc.preview.fat')}</th>
          </tr>
        </thead>
        <tbody className="num">
          {rows.map(([label, m]) => (
            <tr key={label}>
              <td className="truncate py-1 pr-1 font-semibold">{label}</td>
              <td className="px-1 text-right">{fmtNum(m.kcal)}</td>
              <td className="px-1 text-right">{fmtNum(m.protein)}</td>
              <td className="px-1 text-right">{fmtNum(m.carbs)}</td>
              <td className="pl-1 text-right">{fmtNum(m.fat)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 space-y-0.5 border-t border-edge/50 pt-2 text-xs text-sub">
        <p>{t('settings.calc.preview.tdee', { kcal: fmtNum(Math.round(tdee / 10) * 10) })}</p>
        <p>{t('settings.calc.preview.delta', { kcal: signed(result.dailyDeltaKcal) })}</p>
      </div>
    </div>
  )
}

/** Bottom sheet around the calculator; applying writes the targets and the profile to settings. */
export default function TargetsCalculatorSheet({
  open,
  onClose,
  settings,
}: {
  open: boolean
  onClose: () => void
  settings: Settings
}) {
  return (
    <Sheet open={open} onClose={onClose} title={t('settings.calc.title')}>
      <TargetsCalculatorForm
        settings={settings}
        onApply={patch => {
          void db.settings.update(1, patch)
          onClose()
        }}
      />
    </Sheet>
  )
}
