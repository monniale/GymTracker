import { db } from '../../db/db'
import NumberStepper from '../../components/NumberStepper'
import SegmentedControl from '../../components/SegmentedControl'
import { listedRate, plannedRateKgPerWeek, RATE_CHOICES } from '../../lib/tdee'
import { goalDirection, goalSide, goalWeightPatch } from '../../lib/goalDirection'
import { t, fmtNum } from '../../i18n'
import type { Settings } from '../../types'

const round05 = (v: number) => Math.round(v * 2) / 2

/**
 * Goal weight + weekly rate, written straight to `db.settings` on every change.
 * The rate pick sets the magnitude (% of bodyweight per week, the same choices
 * as the calculator: a stepper would show 0.25 as "0.3"); its sign is set from
 * goal vs current weight (below = lose, above = gain, equal = 0), so
 * `goalRatePctPerWeek` keeps the stored convention (negative = lose).
 * `currentKg` is the weight the goal stat measures from (the newest weigh-in);
 * it defaults to `settings.bodyweightKg`. A stored rate that is not a choice for
 * the current direction (e.g. 0 from "maintain") shows no pick, as goalStatus
 * then has no plan either.
 * Compact: one narrow stepper plus a wrapping segmented row, fits 320 px.
 */
export default function GoalFields({ settings, currentKg }: { settings: Settings; currentKg?: number }) {
  const current = currentKg ?? settings.bodyweightKg
  const goal = settings.goalWeightKg
  const shownGoal = goal ?? round05(current)
  const dir = goal === undefined ? 0 : goalDirection(goal, current)
  const side = goalSide(dir)
  const picked = listedRate(side, settings.goalRatePctPerWeek)
  const minGoal = Math.max(30, Math.floor(current * 0.6))
  const maxGoal = Math.min(300, Math.ceil(current * 1.5))

  function setGoal(g: number) {
    void db.settings.update(1, goalWeightPatch(g, current, settings.goalRatePctPerWeek))
  }
  function setRate(pct: number) {
    void db.settings.update(1, { goalRatePctPerWeek: dir * pct })
  }

  const kgFmt = picked === null
    ? ''
    : fmtNum(Math.abs(plannedRateKgPerWeek(current, picked)), { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return (
    <div>
      <div className="flex flex-wrap items-end justify-center gap-x-4 gap-y-3">
        <NumberStepper
          label={t('progress.weight.goalWeight')}
          value={shownGoal}
          onChange={setGoal}
          step={0.5}
          min={minGoal}
          max={maxGoal}
          unit={t('units.kg')}
          compact="narrow"
        />
      </div>
      {dir !== 0 && (
        <div className="mt-3">
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-sub">
            {t('progress.weight.goalRate')} (%{t('units.perWeek')})
          </p>
          <SegmentedControl
            value={picked === null ? '' : String(picked)}
            onChange={v => setRate(Number(v))}
            ariaLabel={t('progress.weight.goalRate')}
            options={RATE_CHOICES[side].map(r => ({ value: String(r), label: `${fmtNum(r)}%` }))}
          />
        </div>
      )}
      {goal !== undefined && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <p className="num min-w-0 text-sm text-sub">
            {dir === 0
              ? t('progress.weight.goalMaintain')
              : picked === null
                ? t('progress.weight.goalPickRate')
                : t(dir < 0 ? 'progress.weight.goalLose' : 'progress.weight.goalGain', { value: kgFmt })}
          </p>
          <button
            onClick={() => void db.settings.update(1, { goalWeightKg: undefined })}
            className="min-h-[44px] shrink-0 whitespace-nowrap px-1 text-sm font-semibold text-danger active:opacity-70"
          >
            {t('progress.weight.goalClear')}
          </button>
        </div>
      )}
      {/* The hint refers to "the rate above": only shown while the rate row is. */}
      {dir !== 0 && <p className="mt-3 text-xs text-sub">{t('progress.weight.goalHint')}</p>}
    </div>
  )
}
