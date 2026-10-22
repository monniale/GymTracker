import { t, type Key } from '../i18n'

export interface RankTier {
  rank: string
  sub: '' | 'III' | 'II' | 'I'
  threshold: number
  color: string
}

const COLORS: Record<string, string> = {
  Copper: '#9A5B3C',
  Bronze: '#B0762C',
  Silver: '#B8BCC4',
  Gold: '#E8B93B',
  Platinum: '#3FC1C9',
  Emerald: '#3DDC84',
  Diamond: '#7F7FD5',
  Champion: '#E8467C',
}

function tiers(rank: string, t3: number, t2: number, t1: number): RankTier[] {
  const color = COLORS[rank]
  return [
    { rank, sub: 'III', threshold: t3, color },
    { rank, sub: 'II', threshold: t2, color },
    { rank, sub: 'I', threshold: t1, color },
  ]
}

export const TIERS: RankTier[] = [
  ...tiers('Copper', 0, 150, 300),
  ...tiers('Bronze', 500, 750, 1000),
  ...tiers('Silver', 1300, 1650, 2000),
  ...tiers('Gold', 2400, 2850, 3300),
  ...tiers('Platinum', 3800, 4350, 4900),
  ...tiers('Emerald', 5500, 6150, 6800),
  ...tiers('Diamond', 7500, 8250, 9000),
  { rank: 'Champion', sub: '', threshold: 9800, color: COLORS.Champion },
]

export interface RankInfo {
  tier: RankTier
  index: number
  next: RankTier | null
  /** 0..1 progress from current tier threshold to the next. */
  progress: number
}

export function rankForPoints(points: number): RankInfo {
  let index = 0
  for (let i = TIERS.length - 1; i >= 0; i--) {
    if (points >= TIERS[i].threshold) {
      index = i
      break
    }
  }
  const tier = TIERS[index]
  const next = index + 1 < TIERS.length ? TIERS[index + 1] : null
  const progress = next
    ? Math.min(1, Math.max(0, (points - tier.threshold) / (next.threshold - tier.threshold)))
    : 1
  return { tier, index, next, progress }
}

/** English rank label ("Gold II"): what gets STORED (Season.finalRank). */
export function rankLabelEn(t: RankTier): string {
  return t.sub ? `${t.rank} ${t.sub}` : t.rank
}

const RANK_KEY: Record<string, Key> = {
  Copper: 'lib.ranks.copper',
  Bronze: 'lib.ranks.bronze',
  Silver: 'lib.ranks.silver',
  Gold: 'lib.ranks.gold',
  Platinum: 'lib.ranks.platinum',
  Emerald: 'lib.ranks.emerald',
  Diamond: 'lib.ranks.diamond',
  Champion: 'lib.ranks.champion',
}

/** Rank name in the UI language ("Gold" → "Oro"); an unknown name passes through. */
function rankName(rank: string): string {
  const key = RANK_KEY[rank]
  return key ? t(key) : rank
}

/** Rank label in the UI language, for display ("Gold II" / "Oro II"). Never store it: see `rankLabelEn`. */
export function rankLabel(tier: RankTier): string {
  const name = rankName(tier.rank)
  return tier.sub ? `${name} ${tier.sub}` : name
}

/** Display form of a stored English rank label (e.g. an archived season's final rank): "Gold II" → "Oro II".
 * Anything that is not "<rank>" or "<rank> <III|II|I>" passes through unchanged. */
export function translateRankLabel(stored: string): string {
  const m = /^(\S+)(?: (III|II|I))?$/.exec(stored.trim())
  if (!m || !RANK_KEY[m[1]]) return stored
  return m[2] ? `${rankName(m[1])} ${m[2]}` : rankName(m[1])
}

export const SEASON_DAYS = 84 // 12 weeks
export const DECAY_GRACE_DAYS = 7
export const DECAY_PER_DAY = 0.03
export const DECAY_MAX = 0.25
export const SEASON_CARRYOVER = 0.2
