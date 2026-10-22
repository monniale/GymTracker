import type { RankTier } from '../lib/ranks'

interface Props {
  tier: RankTier
  size?: number
}

// One emblem per tier+sub-tier (src/assets/ranks/<rank>-<sub>.svg; Champion has no sub).
const EMBLEMS = import.meta.glob('../assets/ranks/*.svg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>

/** URL of the tier's emblem SVG (also drawn onto the share card). */
export function emblemUrl(tier: RankTier): string {
  const file = `${tier.rank}${tier.sub ? `-${tier.sub}` : ''}`.toLowerCase()
  return EMBLEMS[`../assets/ranks/${file}.svg`]
}

/** Rank emblem for the tier. The SVG carries its own aura, so it is drawn square. */
export default function RankBadge({ tier, size = 96 }: Props) {
  const src = emblemUrl(tier)
  return (
    <img
      src={src}
      width={size}
      height={size}
      alt={`${tier.rank} ${tier.sub}`.trim()}
      draggable={false}
      className="shrink-0"
    />
  )
}
