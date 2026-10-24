import { useState } from 'react'
import { t } from '../i18n'

/**
 * Hand-rolled SVG charts (datasets < 200 points). Marks follow the dataviz
 * method: 2px lines, ≥8px touch markers, 4px-rounded bar ends on the baseline,
 * recessive grid, text in ink tokens (never the series color), tap-tooltips.
 */

export interface ChartPoint {
  x: number // timestamp or ordinal
  y: number
  label: string // tooltip label (e.g. date)
}

export const GRID = '#2A3442'
export const INK = '#F8FAFC'
export const SUB = '#94A3B8'

function niceRange(values: number[]): [number, number] {
  const min = Math.min(...values)
  const max = Math.max(...values)
  const pad = (max - min || max || 1) * 0.12
  return [Math.max(0, min - pad), max + pad]
}

/** A refLine within this share of the data's span beyond its min/max is drawn; a farther one is not. */
const REF_REACH = 0.15

/**
 * Whether a reference line at `y` belongs on a chart of `values`: inside the
 * data range extended by 15 % of that range on each side. A farther line (a goal
 * 20 kg away) is not drawn at all, so it never squashes the data into a flat band.
 */
export function refLineInReach(values: number[], y: number): boolean {
  if (values.length === 0 || !Number.isFinite(y)) return false
  const min = Math.min(...values)
  const max = Math.max(...values)
  // A flat series has no span: allow the same 15 % of a nominal 1 unit.
  const reach = (max - min || 1) * REF_REACH
  return y >= min - reach && y <= max + reach
}

/** The card background, used as the halo behind text drawn over the series. */
const CARD = '#1B2431'

/**
 * Where the reference line's label goes: just above or just below the line at
 * the right end (the side away from the latest point first), unless that spot
 * overlaps the latest point or its value label (drawn above the point, from
 * about 17 px above to 6 px below its centre); then at the left end instead.
 * `ly` and `lastY` are viewBox y values; the label is 10 px text (baseline - 8 to + 2).
 */
export function refLabelPlace(
  ly: number,
  lastY: number,
  P: { l: number; r: number; t: number; b: number },
  W: number,
  height: number,
): { x: number; y: number; anchor: 'start' | 'end' } {
  const clampY = (y: number) => Math.min(Math.max(y, P.t + 8), height - P.b - 2)
  const above = clampY(ly - 4)
  const under = clampY(ly + 12)
  const sides = lastY < ly ? [under, above] : [above, under]
  const clear = (y: number) => y + 2 < lastY - 18 || y - 8 > lastY + 7
  const y = sides.find(clear)
  return y === undefined ? { x: P.l + 4, y: sides[0], anchor: 'start' } : { x: W - P.r, y, anchor: 'end' }
}

/** Above this many points the line drops its per-point markers (taps still pick the nearest point). */
const DENSE = 40

export function LineChart({ points, color, height = 160, yFmt = (v: number) => String(Math.round(v)), trend, trendColor = SUB, xFmt, refLine }: {
  points: ChartPoint[]
  color: string
  height?: number
  yFmt?: (v: number) => string
  /** Optional smoothed series (e.g. a moving average), drawn dashed behind the points. */
  trend?: ChartPoint[]
  trendColor?: string
  /** When set, the first and last x values are labelled under the plot. */
  xFmt?: (x: number) => string
  /**
   * Optional horizontal reference (e.g. a goal weight), drawn dashed across the
   * plot with a small label at its right end (left end when the latest point is
   * too close, `refLabelPlace`). It joins the y range only when it
   * lies within the data range extended by 15 % of that range (`refLineInReach`);
   * otherwise it is not drawn, so a far-off target never flattens the series.
   */
  refLine?: { y: number; color?: string; label?: string }
}) {
  const [sel, setSel] = useState<number | null>(null)
  const W = 340
  const P = { l: 34, r: 12, t: 14, b: xFmt ? 22 : 8 }
  if (points.length === 0) return null
  const values = [...points, ...(trend ?? [])].map(p => p.y)
  const ref = refLine && refLineInReach(values, refLine.y) ? refLine : null
  const [y0, y1] = niceRange(ref ? [...values, ref.y] : values)
  const x0 = points[0].x
  const x1 = points[points.length - 1].x || x0 + 1
  const px = (x: number) =>
    P.l + (x1 === x0 ? 0.5 : (x - x0) / (x1 - x0)) * (W - P.l - P.r)
  const py = (y: number) => P.t + (1 - (y - y0) / (y1 - y0 || 1)) * (height - P.t - P.b)
  const line = (pts: ChartPoint[]) =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${px(p.x).toFixed(1)},${py(p.y).toFixed(1)}`).join(' ')
  const last = points[points.length - 1]
  const selected = sel !== null ? points[sel] : null
  const dense = points.length > DENSE
  const refLabel = ref?.label ? refLabelPlace(py(ref.y), py(last.y), P, W, height) : null

  // Tap anywhere on the plot: select the point nearest in x (dots are too small to hit on a phone).
  function pick(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    if (rect.width === 0) return
    const vx = ((e.clientX - rect.left) / rect.width) * W
    let best = 0
    points.forEach((p, i) => {
      if (Math.abs(px(p.x) - vx) < Math.abs(px(points[best].x) - vx)) best = i
    })
    setSel(sel === best ? null : best)
  }

  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="w-full" role="img" aria-label={t('components.charts.trend')} onClick={pick} style={{ cursor: 'pointer' }}>
      {[0.25, 0.5, 0.75].map(f => {
        const y = P.t + f * (height - P.t - P.b)
        return <line key={f} x1={P.l} x2={W - P.r} y1={y} y2={y} stroke={GRID} strokeWidth="1" />
      })}
      <text x={2} y={py(y1) + 4} fontSize="10" fill={SUB} className="num">{yFmt(y1)}</text>
      <text x={2} y={py(y0) + 4} fontSize="10" fill={SUB} className="num">{yFmt(y0)}</text>
      {xFmt && (
        <>
          <text x={P.l} y={height - 6} fontSize="10" fill={SUB} className="num">{xFmt(x0)}</text>
          {x1 !== x0 && (
            <text x={W - P.r} y={height - 6} fontSize="10" fill={SUB} textAnchor="end" className="num">{xFmt(x1)}</text>
          )}
        </>
      )}
      {ref && (
        <line x1={P.l} x2={W - P.r} y1={py(ref.y)} y2={py(ref.y)} stroke={ref.color ?? SUB} strokeWidth="1.5" strokeDasharray="6 4" opacity="0.9" />
      )}
      {trend && trend.length > 1 && (
        <path d={line(trend)} fill="none" stroke={trendColor} strokeWidth="2" strokeDasharray="4 4" strokeLinejoin="round" strokeLinecap="round" />
      )}
      <path d={line(points)} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) =>
        dense && sel !== i ? null : (
          <circle
            key={i}
            cx={px(p.x)}
            cy={py(p.y)}
            r={sel === i ? 5 : 3.5}
            fill={color}
            stroke="#1B2431"
            strokeWidth="2"
          />
        ),
      )}
      {refLabel && (
        // Drawn over the series, with a card-colored halo, so a line or dot never hides it.
        <text x={refLabel.x} y={refLabel.y} fontSize="10" fill={SUB} textAnchor={refLabel.anchor} className="num" stroke={CARD} strokeWidth="3" strokeLinejoin="round" paintOrder="stroke">
          {ref?.label}
        </text>
      )}
      {!selected && (
        <text x={Math.min(px(last.x), W - P.r - 4)} y={py(last.y) - 8} fontSize="11" fontWeight="600" fill={INK} textAnchor="end" className="num">
          {yFmt(last.y)}
        </text>
      )}
      {selected && (
        <g>
          <rect
            x={Math.min(Math.max(px(selected.x) - 44, P.l), W - P.r - 88)}
            y={Math.max(py(selected.y) - 34, 2)}
            width="88"
            height="24"
            rx="6"
            fill="#0B0F14"
            stroke={GRID}
          />
          <text
            x={Math.min(Math.max(px(selected.x), P.l + 44), W - P.r - 44)}
            y={Math.max(py(selected.y) - 18, 18)}
            fontSize="10"
            fill={INK}
            textAnchor="middle"
            className="num"
          >
            {selected.label} · {yFmt(selected.y)}
          </text>
        </g>
      )}
    </svg>
  )
}

export function BarChart({ points, color, height = 120, yFmt = (v: number) => String(Math.round(v)) }: {
  points: ChartPoint[]
  color: string
  height?: number
  yFmt?: (v: number) => string
}) {
  const [sel, setSel] = useState<number | null>(null)
  const W = 340
  const P = { l: 8, r: 8, t: 18, b: 4 }
  if (points.length === 0) return null
  const max = Math.max(...points.map(p => p.y)) || 1
  const bw = Math.min(26, (W - P.l - P.r) / points.length - 4)
  const py = (y: number) => P.t + (1 - y / max) * (height - P.t - P.b)
  const selected = sel !== null ? points[sel] : null

  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="w-full" role="img" aria-label={t('components.charts.bar')}>
      {points.map((p, i) => {
        const x = P.l + (i + 0.5) * ((W - P.l - P.r) / points.length) - bw / 2
        const y = py(p.y)
        const h = height - P.b - y
        const r = Math.min(4, h)
        return (
          <path
            key={i}
            d={`M${x},${height - P.b} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${height - P.b} Z`}
            fill={color}
            opacity={sel === null || sel === i ? 1 : 0.4}
            onClick={() => setSel(sel === i ? null : i)}
            style={{ cursor: 'pointer' }}
          />
        )
      })}
      {selected && (
        <text x={W / 2} y={12} fontSize="11" fontWeight="600" fill={INK} textAnchor="middle" className="num">
          {selected.label} · {yFmt(selected.y)}
        </text>
      )}
    </svg>
  )
}

/** Horizontal bars with a shaded recommended band (weekly sets per muscle). */
export function BandBars({ rows, band, color, max: maxProp }: {
  rows: { label: string; value: number; marker?: number }[]
  band: [number, number]
  color: string
  max?: number
}) {
  const max = Math.max(maxProp ?? 0, band[1] + 2, ...rows.map(r => Math.max(r.value, r.marker ?? 0)))
  return (
    <div className="space-y-1.5">
      {rows.map(r => (
        <div key={r.label} className="flex items-center gap-2">
          <span className="w-20 shrink-0 text-xs font-medium capitalize text-sub">{r.label}</span>
          <div className="relative h-5 flex-1 overflow-hidden rounded-md bg-muted/15">
            <div
              className="absolute inset-y-0 bg-muted/25"
              style={{ left: `${(band[0] / max) * 100}%`, width: `${((band[1] - band[0]) / max) * 100}%` }}
            />
            <div
              className="absolute inset-y-1 rounded-r-sm"
              style={{ width: `${(r.value / max) * 100}%`, backgroundColor: color }}
            />
            {r.marker !== undefined && r.marker > 0 && (
              <div
                className="absolute inset-y-0 w-0.5 bg-ink/70"
                style={{ left: `${(r.marker / max) * 100}%` }}
                title={t('components.charts.average')}
              />
            )}
          </div>
          <span className="num w-6 shrink-0 text-right text-xs font-semibold">{r.value}</span>
        </div>
      ))}
    </div>
  )
}

export function Sparkline({ values, color, width = 96, height = 32 }: {
  values: number[]
  color: string
  width?: number
  height?: number
}) {
  if (values.length < 2) return null
  const min = Math.min(...values)
  const max = Math.max(...values)
  const px = (i: number) => 2 + (i / (values.length - 1)) * (width - 4)
  const py = (v: number) => 3 + (1 - (v - min) / (max - min || 1)) * (height - 6)
  const path = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ')
  return (
    <svg width={width} height={height} aria-hidden>
      <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={px(values.length - 1)} cy={py(values[values.length - 1])} r="3" fill={color} />
    </svg>
  )
}
