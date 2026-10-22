import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import BodyFigure, { MUSCLE_FILL } from './library/BodyFigure'
import { HEAT_ROWS, regionHeatLevel, type MuscleWeek } from '../lib/muscleHeat'
import { targetLabel } from '../lib/exerciseLibrary'
import { weekRangeLabel } from '../lib/weekBriefing'
import { parseLocalDate } from '../lib/dates'
import type { BodyTarget } from '../lib/muscleMap'
import { useT } from '../i18n'

/** Body fill per heat level (0 = a plain grey muscle). */
const LEVEL_FILL = [MUSCLE_FILL.idle, 'fill-primary/30', 'fill-primary/55', 'fill-primary/80', 'fill-primary'] as const
/** Grid cell colour per heat level. */
const LEVEL_BG = ['bg-muted/30', 'bg-primary/30', 'bg-primary/55', 'bg-primary/80', 'bg-primary'] as const

/**
 * Muscles trained per week: a front/back body coloured by the selected week's hard sets per
 * muscle (tap a muscle for its number), and a muscles × weeks grid (tap a week to show it).
 */
export default function MuscleHeatmap({ weeks }: { weeks: MuscleWeek[] }) {
  const { t, tp, fmtNum, lang } = useT()
  const last = weeks.length - 1
  const [index, setIndex] = useState(last)
  const [region, setRegion] = useState<BodyTarget | null>(null)
  // A new week (Monday rollover) moves the selection to it.
  useEffect(() => setIndex(weeks.length - 1), [weeks.length, weeks[weeks.length - 1]?.monday])

  const week = weeks[Math.min(index, last)]
  if (!week) return null
  const dayMonth = new Intl.DateTimeFormat(lang === 'it' ? 'it-IT' : 'en-GB', { day: 'numeric', month: 'numeric' })

  function regionProps(target: BodyTarget) {
    const on = region === target
    return {
      role: 'button',
      tabIndex: 0,
      'aria-pressed': on,
      'aria-label': `${targetLabel(target)}, ${tp('progress.muscleHeat.sets', week.regions[target] ?? 0)}`,
      className: 'cursor-pointer outline-none focus-visible:[&_path]:stroke-ink',
      onClick: () => setRegion(on ? null : target),
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          setRegion(on ? null : target)
        }
      },
    }
  }

  const readout = region
    ? `${targetLabel(region)} · ${tp('progress.muscleHeat.sets', week.regions[region] ?? 0)}`
    : week.sets > 0 ? tp('progress.muscleHeat.weekTotal', week.sets) : t('progress.muscleHeat.none')

  return (
    <div>
      <div className="mb-2 flex items-center gap-1">
        <button
          onClick={() => setIndex(i => Math.max(0, i - 1))}
          disabled={index === 0}
          aria-label={t('progress.week.prevAria')}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sub active:bg-muted/40 disabled:opacity-30"
        >
          <ChevronLeft size={22} />
        </button>
        <p className="min-w-0 flex-1 truncate text-center font-display text-lg font-semibold">
          {index === last ? t('progress.muscleHeat.thisWeek') : weekRangeLabel(week.monday)}
        </p>
        <button
          onClick={() => setIndex(i => Math.min(last, i + 1))}
          disabled={index === last}
          aria-label={t('progress.week.nextAria')}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sub active:bg-muted/40 disabled:opacity-30"
        >
          <ChevronRight size={22} />
        </button>
      </div>

      <BodyFigure
        className="mx-auto block h-auto w-full max-w-[300px]"
        regionClass={target => (region === target ? `${LEVEL_FILL[regionHeatLevel(week.regions[target])]} stroke-ink` : LEVEL_FILL[regionHeatLevel(week.regions[target])])}
        regionProps={regionProps}
        labels={{ front: t('library.browser.front'), back: t('library.browser.back') }}
      />

      <p className="num mt-2 min-h-[20px] text-center text-sm font-medium" aria-live="polite">{readout}</p>

      <div className="mt-1 flex items-center justify-center gap-1 text-[11px] text-sub" aria-hidden>
        <span className="mr-1">{t('progress.muscleHeat.less')}</span>
        {LEVEL_BG.map(bg => <span key={bg} className={`h-3 w-3 rounded-sm ${bg}`} />)}
        <span className="ml-1">{t('progress.muscleHeat.more')}</span>
      </div>

      <div
        className="mt-4 grid items-center gap-x-[3px] gap-y-[3px]"
        style={{ gridTemplateColumns: `minmax(0, 5.5rem) repeat(${weeks.length}, minmax(0, 1fr))` }}
      >
        {HEAT_ROWS.map(target => (
          <div key={target} className="contents">
            <span className="truncate pr-1 text-xs text-sub">{targetLabel(target)}</span>
            {weeks.map((w, i) => (
              <div
                key={w.monday}
                aria-hidden
                onClick={() => setIndex(i)}
                className={`h-4 rounded-sm ${LEVEL_BG[regionHeatLevel(w.regions[target])]} ${i === index ? 'ring-1 ring-ink/80' : ''}`}
              />
            ))}
          </div>
        ))}
        <span />
        {weeks.map((w, i) => (
          <button
            key={w.monday}
            onClick={() => setIndex(i)}
            aria-pressed={i === index}
            aria-label={weekRangeLabel(w.monday)}
            className={`num min-h-[32px] whitespace-nowrap text-center text-[10px] ${i === index ? 'font-bold text-ink' : 'text-sub'}`}
          >
            {(last - i) % 2 === 0 ? dayMonth.format(parseLocalDate(w.monday)) : ''}
          </button>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-sub">{t('progress.muscleHeat.note', { n: fmtNum(10) })}</p>
    </div>
  )
}
