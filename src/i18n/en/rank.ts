/** `rank` namespace (rules in src/i18n/index.ts). Keys: screen.element, camelCase. */
export default {
  screen: {
    title: 'Rank',
    toNext: { one: '{n} pt to {rank}', other: '{n} pts to {rank}' },
    streak: { one: '{n} wk streak', other: '{n} wk streak' },
    seasonLeft: { one: 'Season {season} · {n}d left', other: 'Season {season} · {n}d left' },
    ghostNow: 'Day {day}: {pts} vs',
    ghostLast: '{pts} last season',
  },
  quests: {
    title: 'Weekly quests',
    bonusEach: '+{n} pts each',
  },
  scoring: {
    toggle: 'How scoring works',
    // `**…**` marks the bold lead-in of each paragraph.
    volume: '**Volume load** (sets × reps × weight ÷ your bodyweight) is the base — it is the standard scientific proxy for training stimulus, with a proven dose–response for muscle growth.',
    intensity: '**Intensity weighting**: each set is scaled by how heavy it is relative to your estimated 1-rep max (Epley formula). Sets under 30% of your max score almost nothing — junk volume doesn\'t build muscle, and it doesn\'t build points either.',
    prBonus: '**PR bonuses** (+25 per e1RM record, +10 per volume record, max 75): progressive overload — beating your previous best — is the mechanism of adaptation, so it pays extra.',
    streak: '**Streak multiplier** (+5% per consecutive week hitting your weekly session target, max +30%): consistency is the single best predictor of results, so it multiplies everything.',
    caps: '**Caps**: max 6 scored sets per exercise, 24 per session, 150 base points — diminishing returns are real, and grinding endless easy sets won\'t rank you up. A second session the same day counts 25%. After 7 rest days points decay 3%/day (max −25%). Seasons last 12 weeks; you restart with 20% carryover.',
  },
  recent: {
    title: 'Recent scores',
    empty: 'Finish a workout to earn your first points.',
  },
  achievements: {
    title: 'Achievements',
  },
  seasons: {
    title: 'Past seasons',
    season: 'Season {season}',
    sessions: { one: '{n} session', other: '{n} sessions' },
    lifted: '{kg} kg lifted',
    best: 'best: {name} {e1rm} e1RM',
  },
  tiers: {
    title: 'All ranks',
    reached: 'Reached',
    toGo: { one: '{n} pt to go', other: '{n} pts to go' },
  },
} as const
