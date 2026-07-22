import { describe, it, expect } from 'vitest'
import { formatDietBriefing, type DietBriefing } from './dietReport'

const briefing = (p: Partial<DietBriefing> = {}): DietBriefing => ({
  date: '2026-07-18',
  isTraining: true,
  totals: { kcal: 2450, protein: 172, carbs: 250, fat: 80 },
  targets: { kcal: 2500, protein: 160, carbs: 280, fat: 80 },
  meals: [
    { meal: 'breakfast', kcal: 600, protein: 40 },
    { meal: 'lunch', kcal: 800, protein: 55 },
  ],
  waterMl: 2000,
  waterTargetMl: 2500,
  bodyweightKg: 80,
  week: {
    loggedDays: 6,
    avgKcal: 2400,
    avgProtein: 165,
    avgCarbs: 240,
    avgFat: 78,
    proteinPerKg: 2.06,
    adherent: 4,
    trainingDays: 3,
  },
  ...p,
})

describe('formatDietBriefing', () => {
  it('shows calories and protein vs targets with g/kg', () => {
    const t = formatDietBriefing(briefing())
    expect(t).toContain('Calories: 2450 / 2500 kcal target')
    expect(t).toContain('Protein: 172 / 160 g (2.15 g/kg)')
  })

  it('labels training vs rest day', () => {
    expect(formatDietBriefing(briefing())).toContain('(training day)')
    expect(formatDietBriefing(briefing({ isTraining: false }))).toContain('(rest day)')
  })

  it('lists the per-meal breakdown', () => {
    const t = formatDietBriefing(briefing())
    expect(t).toContain('- breakfast: 600 kcal, 40 g protein')
    expect(t).toContain('- lunch: 800 kcal, 55 g protein')
  })

  it('handles no per-meal data', () => {
    expect(formatDietBriefing(briefing({ meals: [] }))).toContain('nothing logged by meal')
  })

  it('includes weekly context when present', () => {
    const t = formatDietBriefing(briefing())
    expect(t).toContain('Last 7 days:')
    expect(t).toContain('Logged 6/7 days; 3 training days')
    expect(t).toContain('On-target (±10% kcal): 4/6 logged days')
  })

  it('omits the weekly section when there is no week data', () => {
    expect(formatDietBriefing(briefing({ week: null }))).not.toContain('Last 7 days')
  })

  it('shows water intake vs target', () => {
    expect(formatDietBriefing(briefing())).toContain('Water: 2000 / 2500 ml')
  })

  it('handles zero bodyweight without NaN', () => {
    const t = formatDietBriefing(briefing({ bodyweightKg: 0 }))
    expect(t).toContain('g/kg')
    expect(t).not.toContain('NaN')
  })
})
