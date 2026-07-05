import type { RankTier } from '../lib/ranks'

interface Props {
  tier: RankTier
  size?: number
}

/** Shield badge in the tier color with the sub-tier numeral. */
export default function RankBadge({ tier, size = 96 }: Props) {
  const id = `grad-${tier.rank}-${tier.sub || 'top'}`
  return (
    <svg width={size} height={size * 1.1} viewBox="0 0 100 110" role="img" aria-label={`${tier.rank} ${tier.sub}`.trim()}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={tier.color} stopOpacity="1" />
          <stop offset="100%" stopColor={tier.color} stopOpacity="0.55" />
        </linearGradient>
      </defs>
      <path
        d="M50 4 L92 20 V58 C92 84 73 100 50 108 C27 100 8 84 8 58 V20 Z"
        fill={`url(#${id})`}
        stroke={tier.color}
        strokeWidth="3"
      />
      <path
        d="M50 14 L83 27 V57 C83 78 68 91 50 98 C32 91 17 78 17 57 V27 Z"
        fill="none"
        stroke="#0B0F14"
        strokeOpacity="0.35"
        strokeWidth="2"
      />
      <text
        x="50"
        y={tier.sub ? 68 : 66}
        textAnchor="middle"
        fontFamily="'Barlow Condensed', sans-serif"
        fontWeight="700"
        fontSize={tier.sub ? 34 : 20}
        fill="#0B0F14"
      >
        {tier.sub || 'MAX'}
      </text>
    </svg>
  )
}
