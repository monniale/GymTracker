import type { SVGProps } from 'react'
import { BACK, FRONT, H, HEAD, MIRROR, NECK_LINE, SILHOUETTE, W, type Region, type Side } from './bodyShapes'
import type { BodyTarget, Involvement } from '../../lib/muscleMap'

const BASE = '#2A3442'
const STROKE = '#1B2431'

/** Muscle fill classes shared by every body view. */
export const MUSCLE_FILL = {
  /** A drawn muscle with nothing to say. */
  idle: 'fill-[#4B5563]',
  /** A muscle that can't be picked (no exercises). */
  off: 'fill-[#323C4A]',
  primary: 'fill-primary',
  secondary: 'fill-primary/40',
} as const

interface Props {
  /** Figures to draw, left to right. */
  sides?: Side[]
  /** Fill class of a muscle, or null to leave it out (only the silhouette shows there). */
  regionClass: (target: BodyTarget) => string | null
  /** Extra attributes for a muscle's group (role/handlers on the interactive map). */
  regionProps?: (target: BodyTarget) => SVGProps<SVGGElement> | undefined
  /** Accessible names of the figures; without them the drawing is decorative (aria-hidden). */
  labels?: Partial<Record<Side, string>>
  /** Gap stroke between muscles, in viewBox units (thicker reads better when small). */
  gap?: number
  /** Silhouette colour (lighter for the small thumbnails). */
  base?: string
  className?: string
}

/** Front/back anatomy figures (smoothed half paths mirrored about the midline) in one SVG. */
export default function BodyFigure({ sides = ['front', 'back'], regionClass, regionProps, labels, gap = 0.7, base = BASE, className }: Props) {
  function region([target, paths]: Region, i: number) {
    const cls = regionClass(target)
    if (cls === null) return null
    return (
      <g key={`${target}-${i}`} {...regionProps?.(target)}>
        {paths.flatMap((d, j) => [
          <path key={`l${j}`} d={d} className={`${cls} transition-[fill] duration-150 motion-reduce:transition-none`} />,
          <path key={`r${j}`} d={d} transform={MIRROR} className={`${cls} transition-[fill] duration-150 motion-reduce:transition-none`} />,
        ])}
      </g>
    )
  }

  return (
    <svg viewBox={`0 0 ${W * sides.length} ${H}`} className={className ?? 'h-auto w-full'} aria-hidden={labels ? undefined : true}>
      {sides.map((side, i) => (
        <g
          key={side}
          role={labels ? 'group' : undefined}
          aria-label={labels?.[side]}
          transform={`translate(${i * W} 0)`}
          stroke={STROKE}
          strokeWidth={gap}
          strokeLinejoin="round"
        >
          <g fill={base} stroke="none" aria-hidden="true">
            <path d={SILHOUETTE} />
            <path d={SILHOUETTE} transform={MIRROR} />
            <ellipse {...HEAD} />
            {side === 'front' && <path d={NECK_LINE} fill="none" stroke={STROKE} strokeWidth={0.6} strokeLinecap="round" />}
            {side === 'front' && <path d={NECK_LINE} transform={MIRROR} fill="none" stroke={STROKE} strokeWidth={0.6} strokeLinecap="round" />}
          </g>
          {(side === 'front' ? FRONT : BACK).map(region)}
        </g>
      ))}
    </svg>
  )
}

/** The body areas an exercise works: target in the accent, secondary muscles in a lighter accent.
 * `mini` leaves the other muscles out (row thumbnails); otherwise they are drawn in grey. */
export function InvolvementFigure({ inv, mini, className }: { inv: Involvement; mini?: boolean; className?: string }) {
  return (
    <BodyFigure
      className={className}
      gap={mini ? 1.4 : 0.7}
      base={mini ? '#4B5563' : undefined}
      regionClass={target =>
        inv.primary.includes(target) ? MUSCLE_FILL.primary
          : inv.secondary.includes(target) ? MUSCLE_FILL.secondary
            : mini ? null : MUSCLE_FILL.idle}
    />
  )
}
