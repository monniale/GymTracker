/** Target muscles of the exercise library (dataset `target` values). */
export const BODY_TARGETS = ['traps', 'levator scapulae', 'delts', 'pectorals', 'serratus anterior', 'biceps', 'triceps', 'forearms', 'abs', 'upper back', 'lats', 'spine', 'glutes', 'abductors', 'adductors', 'quads', 'hamstrings', 'calves'] as const
export type BodyTarget = typeof BODY_TARGETS[number]

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

/*
 * Geometry: each figure lives in a 100 × 200 box with the midline at x = 50. Paths are
 * drawn for the viewer's left half only and mirrored, so the figure stays symmetric;
 * only the head (an ellipse on the midline) is drawn once.
 */
const W = 100
const H = 202
const MIRROR = `matrix(-1 0 0 1 ${W} 0)`

const BASE = '#2A3442'
const STROKE = '#1B2431'
const FILL: Record<RegionState, string> = {
  off: 'fill-[#323C4A]',
  idle: 'fill-[#4B5563] group-hover:fill-[#5F6B7A]',
  on: 'fill-primary',
}

type Region = [BodyTarget, string[]]

/** Outline of the viewer's left half (neck to foot); the head is an ellipse on the midline. */
const SILHOUETTE = [
  'M50 21 L45 21.6 C44.8 27.6 44.4 31.6 43.2 34.8 C39.2 37.2 34.2 38 30 39.2',
  'C25 40.6 22 44 21.4 49.6 C20.8 54 20.4 58 20.2 62 C19.8 67 19.6 72 19.4 76',
  'C16.8 84 14.8 92 13.6 100 C11.4 103 10 108 10.4 112 C10.8 115 12.2 117.6 14 118',
  'C15.6 118.2 16.8 116 17.6 113 C18.4 110 18.8 106 18.8 101.6 C21 94 24.6 86 28.6 79',
  'C29.8 74 30.8 66 31 57.6 C32.4 64 33.6 70 34.4 76 C34.8 80 34.4 84 33.2 88',
  'C31.2 92 30.2 98 30.2 104 C29.8 116 30.8 128 33.2 140 C33.8 145 34.4 149 34.6 152',
  'C33.8 160 34.2 168 36.4 176 C37.4 180 38.2 184 38.4 188 C37 191 35.4 194 36 196.4',
  'C38.4 197.6 42.6 197.6 44.4 196.2 C45 194.6 44.6 192 44.2 190 C44.2 186 44.8 182 45.8 176',
  'C47.4 168 47.6 160 46 152 C45.8 148 46 144 46.4 140 C47.8 130 48.4 118 48.8 106 L50 105.6 Z',
].join(' ')

/** Sternocleidomastoid crease on the front neck (decoration only). */
const NECK_LINE = 'M45.2 23.4 C46 28 47.2 32 48.8 36.4'

const FRONT: Region[] = [
  ['traps', ['M44.5 29 C43.5 33 41 36 35 39 L44 39.5 Z']],
  ['delts', ['M35 39 C28 38.4 23.4 42 22.4 48.4 C21.8 52.4 22.2 56.6 23.4 60 C26.2 56 29.2 52.6 31.4 48.6 C32.6 45.4 33.6 42 35 39 Z']],
  ['pectorals', ['M49.2 41.2 L49.2 57 C44.6 60.4 38.4 60.6 33.8 57.2 C31.8 54.6 31.6 50.4 32.8 47.2 C34.6 42.6 39.8 40.4 45 40.6 C46.6 40.6 48 40.8 49.2 41.2 Z']],
  ['serratus anterior', [
    'M33.2 59 L37.6 60.2 L37.4 62.6 L33.4 61.8 Z',
    'M33.6 63.4 L37.4 64.2 L37.2 66.6 L34 66 Z',
    'M34.2 67.6 L37.2 68.2 L37 70.4 L34.6 70 Z',
  ]],
  ['biceps', ['M23.6 61.4 C21.8 64.8 20.8 68.4 21 72.4 L27.6 73 C29.6 68.8 30.6 63.6 30.6 56.4 C28 57.4 25.6 59 23.6 61.4 Z']],
  ['forearms', [
    'M20.2 80.4 C17.6 86 15.8 93 14.6 100.4 L16.8 100.8 C18.4 94 20.6 87.6 23.4 81.2 Z',
    'M24.2 81 C21.6 87.4 19.6 94 18.4 100.8 L18.8 101 C21.6 94.6 25.2 87.4 28.4 80.4 Z',
  ]],
  ['abs', [
    // rectus abdominis blocks
    'M43 60.8 C45 60.2 47.4 60.2 49.2 60.6 L49.2 66.6 L42.6 67 C42.4 64.8 42.6 62.6 43 60.8 Z',
    'M42.6 68.4 L49.2 68 L49.2 74.6 L42.6 75 Z',
    'M42.6 76.4 L49.2 76 L49.2 82.6 L42.8 83 Z',
    'M42.8 84.4 L49.2 84 L49.2 97 C47.2 95.6 45 92.6 43.8 89.6 C43.2 87.8 42.9 86 42.8 84.4 Z',
    // external oblique
    'M38.6 61.6 L41.2 62.4 L41.2 84 C41.4 87.6 42 90 43 92.4 C40.4 91 38.4 89 37 86.6 C36.6 80 36.8 74 36.4 72 L38.6 71.4 Z',
  ]],
  ['abductors', ['M34.4 88 C32.6 92 31.6 97 31.4 102 L35.4 104.6 C36.2 99 37 93.8 37.8 89.8 Z']],
  ['adductors', ['M48.6 106 C48.4 112 47.8 118 46.8 123 C45.6 120.6 44.4 118.4 43.2 116.6 C42.4 115 41.8 113.6 41.4 112 C43.4 109.4 46 107.4 48.6 106 Z']],
  ['quads', [
    // vastus lateralis
    'M31 104 C29.8 114 30.6 127 33.6 142.6 L36.8 142.4 C35.4 128 35.2 116 35.8 106 Z',
    // rectus femoris
    'M37.4 98.6 C35.8 109 35.8 123 38 142.4 L41.6 142.6 C42.8 133 43.4 120 40.2 99.4 Z',
    // vastus medialis
    'M45.2 121.6 C47.6 127 48.2 134.6 45.8 143 L42.4 143 C43.2 135 44 128 45.2 121.6 Z',
  ]],
  ['calves', [
    // tibialis anterior
    'M35.4 150.6 C34.4 159 35 169 37.8 180 L40.4 180.4 C40.6 170 40.4 160 39.8 150.8 Z',
    // gastrocnemius (medial head seen from the front)
    'M42 150.8 C44.8 151.6 46.6 156 46.8 161.6 C46.6 167 45.6 171 44 174 C42.6 172 41.8 168 41.6 163 C41.4 158.6 41.6 154 42 150.8 Z',
  ]],
]

const BACK: Region[] = [
  ['levator scapulae', ['M45.6 26 C45.4 30 44.6 33.4 43 36 L46.4 35.4 C47 32.4 47.4 29.4 47.4 26.4 Z']],
  ['traps', ['M49.2 26 C48.8 30.6 47.8 34.6 44 37.6 C40.6 39.2 37.4 39.8 34.4 40.4 C38.8 42.8 42.4 47 45.2 53 C47 57.4 48.4 62.6 49.2 68 Z']],
  ['delts', ['M34.6 40.8 C28.2 39.8 23.4 43 22.4 49 C21.8 53 22.2 56.8 23.4 60 C26.6 56 29.8 51.4 32 47.6 C32.8 45.4 33.6 43 34.6 40.8 Z']],
  ['upper back', [
    // infraspinatus / teres on the shoulder blade
    'M34 44 C37.8 46 41.4 50 43.6 55.4 C43.2 59.6 41.6 62.6 39 64 C36 61 34 56.4 33.2 51.4 C33 48.8 33.2 46.2 34 44 Z',
  ]],
  ['lats', ['M33 60.4 C35 64.4 37.6 66.8 40.4 66.6 C43.2 65.6 44.8 62 45.6 58 C47 63.4 48.2 69 49.2 72.4 L49.2 77 C47.4 80 46 84 45.2 88.6 C42.4 88 40 87 38.2 85.6 C36.6 78 34.8 70.4 33 63.6 Z']],
  ['triceps', [
    'M23.2 61.4 C21.4 65 20.6 68.6 20.8 72.6 L25 73 C25.2 68 25.6 63.4 26.6 58.6 Z',
    'M27.6 57.6 C26.6 62.8 26.2 68 26.4 73 L28 73 C29.8 68.6 30.8 63.4 30.8 56.4 Z',
  ]],
  ['forearms', [
    'M20.2 80.4 C17.6 86 15.8 93 14.6 100.4 L16.8 100.8 C18.4 94 20.6 87.6 23.4 81.2 Z',
    'M24.2 81 C21.6 87.4 19.6 94 18.4 100.8 L18.8 101 C21.6 94.6 25.2 87.4 28.4 80.4 Z',
  ]],
  ['spine', ['M49.2 78.6 L49.2 96 L45.4 96 C45.2 92.4 45.6 88.6 46.4 85 C47.2 82.6 48.2 80.4 49.2 78.6 Z']],
  ['abductors', ['M38.6 87.4 C41 88.8 43.4 89.6 45.2 90 L44.8 92.6 C41 93.2 37.6 94.8 34.6 97.4 C34.8 93.6 36.2 90 38.6 87.4 Z']],
  ['glutes', ['M49.2 97.6 L49.2 116.6 C45.4 118.6 39.6 118.6 35.6 116.6 C32 113.6 31.2 108.4 32.6 103.6 C34.6 98.6 40 95 45.6 94.6 C47 94.6 48.2 96 49.2 97.6 Z']],
  ['hamstrings', [
    // biceps femoris
    'M31.6 110 C30.6 120 31.4 130 33.8 142.6 L39 142.6 C38.6 131 38.4 123.6 39.2 118.6 C36 118 33.4 115 31.6 110 Z',
    // semitendinosus / semimembranosus
    'M40.4 119.2 C39.6 126 40 133 40.6 142.6 L45.8 142.6 C47.2 133 47.8 125.6 48 118.8 C45.2 119.4 42.8 119.6 40.4 119.2 Z',
  ]],
  ['calves', [
    // lateral head
    'M35.2 150 C33.8 157 34.2 165 36.2 170.6 C37.8 172.4 39.4 172.4 40.4 171.4 C40.6 165 40.4 157.6 40 150.4 Z',
    // medial head
    'M41.4 150.4 C41.8 158 41.8 165.4 41.4 171.6 C43 172.8 44.8 172 46 170 C47.6 164.6 47.2 157 45.6 150 Z',
    // soleus
    'M37.4 173.4 C38.6 176.4 39.2 179 39.4 182 L43 182 C43.4 179 44.2 176.4 45 173.6 C43.8 174.6 42.4 174.8 41 174.2 C39.6 174.8 38.4 174.6 37.4 173.4 Z',
  ]],
]

/**
 * Front and back anatomy chart: tap a muscle (or its chip) to filter the exercise
 * library by target. Regions are hand-drawn half paths mirrored about the midline;
 * one viewBox holds both figures so they shrink together on a 320 px phone.
 */
export default function BodyMap({ counts, selected, onSelect, labelFor, frontLabel, backLabel }: Props) {
  const tap = (target: BodyTarget) => onSelect(nextSelection(selected, target))

  function region([target, paths]: Region, i: number) {
    const state = regionState(target, counts, selected)
    const tappable = state !== 'off'
    return (
      <g
        key={`${target}-${i}`}
        role="button"
        tabIndex={tappable ? 0 : undefined}
        aria-label={`${labelFor(target)}, ${counts[target] ?? 0}`}
        aria-pressed={state === 'on'}
        aria-disabled={!tappable}
        className={tappable ? 'group cursor-pointer outline-none focus-visible:[&_path]:stroke-ink' : undefined}
        onClick={tappable ? () => tap(target) : undefined}
        onKeyDown={tappable ? e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            tap(target)
          }
        } : undefined}
      >
        {paths.flatMap((d, j) => [
          <path key={`l${j}`} d={d} className={`${FILL[state]} transition-[fill] duration-150 motion-reduce:transition-none`} />,
          <path key={`r${j}`} d={d} transform={MIRROR} className={`${FILL[state]} transition-[fill] duration-150 motion-reduce:transition-none`} />,
        ])}
      </g>
    )
  }

  function figure(regions: Region[], label: string, dx: number, neck: boolean) {
    return (
      <g role="group" aria-label={label} transform={`translate(${dx} 0)`} stroke={STROKE} strokeWidth={0.6} strokeLinejoin="round">
        <g fill={BASE} stroke="none" aria-hidden="true">
          <path d={SILHOUETTE} />
          <path d={SILHOUETTE} transform={MIRROR} />
          <ellipse cx={50} cy={13.4} rx={7.6} ry={9.8} />
          {neck && <path d={NECK_LINE} fill="none" stroke={STROKE} strokeWidth={0.6} />}
          {neck && <path d={NECK_LINE} transform={MIRROR} fill="none" stroke={STROKE} strokeWidth={0.6} />}
        </g>
        {regions.map(region)}
      </g>
    )
  }

  const chips = chipTargets(counts)

  return (
    <div className="rounded-2xl bg-card p-3">
      <svg viewBox={`0 0 ${2 * W} ${H}`} className="w-full h-auto">
        {figure(FRONT, frontLabel, 0, true)}
        {figure(BACK, backLabel, W, false)}
      </svg>
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
