import BodyFigure, { MUSCLE_FILL } from './BodyFigure'
import { BODY_TARGETS, type BodyTarget } from '../../lib/muscleMap'

export { BODY_TARGETS, type BodyTarget }

interface Props {
  /** Number of exercises per target; a target with 0/undefined is drawn dimmed and not tappable. */
  counts: Partial<Record<BodyTarget, number>>
  selected: BodyTarget | null
  /** Tapping the selected region again passes null. */
  onSelect: (target: BodyTarget | null) => void
  /** Display name of a target in the UI language (the caller translates). */
  labelFor: (target: BodyTarget) => string
  /** Accessible names for the two figures (already translated). */
  frontLabel: string
  backLabel: string
}

export type RegionState = 'off' | 'idle' | 'on'

/** How a target is drawn: `off` (no exercises, not tappable), `idle` or `on` (selected). */
export function regionState(target: BodyTarget, counts: Props['counts'], selected: BodyTarget | null): RegionState {
  if (!counts[target]) return 'off'
  return target === selected ? 'on' : 'idle'
}

/** Selection after tapping `target`: tapping the selected one clears it. */
export function nextSelection(selected: BodyTarget | null, target: BodyTarget): BodyTarget | null {
  return selected === target ? null : target
}

/** Targets that get a chip (count > 0), in `BODY_TARGETS` order. */
export function chipTargets(counts: Props['counts']): BodyTarget[] {
  return BODY_TARGETS.filter(t => (counts[t] ?? 0) > 0)
}

const FILL: Record<RegionState, string> = {
  off: MUSCLE_FILL.off,
  idle: `${MUSCLE_FILL.idle} group-hover:fill-[#5F6B7A]`,
  on: MUSCLE_FILL.primary,
}

/**
 * Front and back anatomy chart: tap a muscle (or its chip) to filter the exercise
 * library by target. One viewBox holds both figures so they shrink together on a 320 px phone.
 */
export default function BodyMap({ counts, selected, onSelect, labelFor, frontLabel, backLabel }: Props) {
  const tap = (target: BodyTarget) => onSelect(nextSelection(selected, target))

  function regionProps(target: BodyTarget) {
    const state = regionState(target, counts, selected)
    const tappable = state !== 'off'
    return {
      role: 'button',
      tabIndex: tappable ? 0 : undefined,
      'aria-label': `${labelFor(target)}, ${counts[target] ?? 0}`,
      'aria-pressed': state === 'on',
      'aria-disabled': !tappable,
      className: tappable ? 'group cursor-pointer outline-none focus-visible:[&_path]:stroke-ink' : undefined,
      onClick: tappable ? () => tap(target) : undefined,
      onKeyDown: tappable ? (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          tap(target)
        }
      } : undefined,
    }
  }

  const chips = chipTargets(counts)

  return (
    <div className="rounded-2xl bg-card p-3">
      <BodyFigure
        regionClass={target => FILL[regionState(target, counts, selected)]}
        regionProps={regionProps}
        labels={{ front: frontLabel, back: backLabel }}
      />
      {chips.length > 0 && (
        <div className="mt-2 flex flex-wrap justify-center gap-1.5">
          {chips.map(target => {
            const on = target === selected
            return (
              <button
                key={target}
                type="button"
                aria-pressed={on}
                onClick={() => tap(target)}
                className={`min-h-[36px] whitespace-nowrap rounded-full px-2.5 text-[13px] transition-colors motion-reduce:transition-none ${on ? 'bg-primary text-white' : 'bg-surface text-ink active:bg-muted'}`}
              >
                {labelFor(target)} <span className={on ? 'text-white/75' : 'text-sub'}>{counts[target]}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
