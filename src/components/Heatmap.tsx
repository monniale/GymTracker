import { useState } from 'react'
import { GRID, INK, SUB } from './Charts'
import { heatLevel, type TrainingHeatmap, type HeatCell } from '../lib/heatmap'
import { fmtDate } from '../lib/dates'
import { t, tp } from '../i18n'

const ORANGE = '#F97316'
const TODAY_RING = '#FB923C'
/** Fill opacity per heat level (0 = empty cell drawn in the grid colour). */
const LEVEL_OPACITY = [1, 0.35, 0.65, 1] as const

const CELL = 11
const GAP = 2.5
const STEP = CELL + GAP
const LEFT = 23 // weekday labels
const TOP = 15 // month labels
const ROW_LABELS: [number, string][] = [[0, t('components.heatmap.mon')], [2, t('components.heatmap.wed')], [4, t('components.heatmap.fri')]]

function cellFill(level: number) {
  return level === 0 ? GRID : ORANGE
}

/**
 * Week-column consistency grid (one cell per day, Monday on top). The viewBox
 * scales with the card, so 26 columns still fit a 320 px phone. Tap picks the
 * nearest day, like `LineChart`.
 */
export default function Heatmap({ data, today }: { data: TrainingHeatmap; today: string }) {
  const [sel, setSel] = useState<HeatCell | null>(null)
  const cols = data.columns.length
  const W = LEFT + cols * STEP - GAP + 2
  const H = TOP + 7 * STEP - GAP + 2
  const total = data.columns.reduce((n, c) => n + c.days.reduce((m, d) => m + d.count, 0), 0)

  function pick(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    const vx = ((e.clientX - rect.left) / rect.width) * W
    const vy = ((e.clientY - rect.top) / rect.height) * H
    const col = Math.min(cols - 1, Math.max(0, Math.floor((vx - LEFT + GAP / 2) / STEP)))
    const row = Math.min(6, Math.max(0, Math.floor((vy - TOP + GAP / 2) / STEP)))
    const cell = data.columns[col].days[row]
    setSel(cell.future || sel?.date === cell.date ? null : cell)
  }

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={t('components.heatmap.aria', { workouts: tp('units.workouts', total), weeks: tp('units.weeks', cols) })}
        onClick={pick}
        style={{ cursor: 'pointer' }}
      >
        {data.monthTicks.map(t => (
          <text key={t.col} x={LEFT + t.col * STEP} y={10} fontSize="10" fill={SUB}>
            {t.label}
          </text>
        ))}
        {ROW_LABELS.map(([row, label]) => (
          <text key={row} x={0} y={TOP + row * STEP + CELL - 2} fontSize="9" fill={SUB}>
            {label}
          </text>
        ))}
        {data.columns.map((c, ci) =>
          c.days.map((d, ri) => {
            const x = LEFT + ci * STEP
            const y = TOP + ri * STEP
            if (d.future) {
              return (
                <rect
                  key={d.date}
                  x={x + 0.5}
                  y={y + 0.5}
                  width={CELL - 1}
                  height={CELL - 1}
                  rx="2"
                  fill="none"
                  stroke={GRID}
                  strokeDasharray="2 1.5"
                />
              )
            }
            const level = heatLevel(d.count)
            const ring = sel?.date === d.date ? INK : d.date === today ? TODAY_RING : undefined
            return (
              <rect
                key={d.date}
                x={x}
                y={y}
                width={CELL}
                height={CELL}
                rx="2"
                fill={cellFill(level)}
                fillOpacity={LEVEL_OPACITY[level]}
                stroke={ring}
                strokeWidth={ring ? 1.5 : undefined}
              />
            )
          }),
        )}
      </svg>
      <div className="mt-1.5 flex items-center gap-2 text-xs text-sub">
        <span className="num min-w-0 flex-1 truncate" aria-live="polite">
          {sel
            ? `${fmtDate(sel.date)} · ${sel.count === 0 ? t('components.heatmap.restDay') : tp('units.workouts', sel.count)}`
            : t('components.heatmap.tapDay')}
        </span>
        <span className="flex shrink-0 items-center gap-1 whitespace-nowrap" aria-hidden>
          {t('components.heatmap.less')}
          {[0, 1, 2, 3].map(l => (
            <span
              key={l}
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: cellFill(l), opacity: LEVEL_OPACITY[l] }}
            />
          ))}
          {t('components.heatmap.more')}
        </span>
      </div>
    </div>
  )
}
