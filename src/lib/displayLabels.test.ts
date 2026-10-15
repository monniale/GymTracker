import { describe, it, expect, afterEach } from 'vitest'
import { TIERS, rankForPoints, rankLabel, rankLabelEn, translateRankLabel } from './ranks'
import { displayEventLabel, questsForWeek } from './quests'
import { LEVELS, levelLabel } from './standards'
import { muscleGroupLabel } from './equipment'
import { useUiStore } from './uiStore'

/** Display helpers translate at render time; what is stored stays English. */
describe('display labels', () => {
  afterEach(() => useUiStore.setState({ language: 'en' }))

  it('rank labels: English stored, UI language shown', () => {
    const gold2 = rankForPoints(2850).tier
    expect(rankLabelEn(gold2)).toBe('Gold II')
    expect(rankLabel(gold2)).toBe('Gold II')
    useUiStore.setState({ language: 'it' })
    expect(rankLabelEn(gold2)).toBe('Gold II')
    expect(rankLabel(gold2)).toBe('Oro II')
    expect(rankLabel(TIERS[TIERS.length - 1])).toBe('Campione')
    expect(TIERS.map(rankLabel).every(l => l.trim() !== '')).toBe(true)
  })

  it('translateRankLabel maps a stored English rank and passes anything else through', () => {
    expect(translateRankLabel('Gold II')).toBe('Gold II')
    useUiStore.setState({ language: 'it' })
    expect(translateRankLabel('Gold II')).toBe('Oro II')
    expect(translateRankLabel('Copper III')).toBe('Rame III')
    expect(translateRankLabel('Champion')).toBe('Campione')
    for (const t of TIERS) expect(translateRankLabel(rankLabelEn(t))).toBe(rankLabel(t))
    expect(translateRankLabel('Mystery IV')).toBe('Mystery IV')
    expect(translateRankLabel('')).toBe('')
  })

  it('quest labels: stored event label stays English, displayed translated', () => {
    const [q] = questsForWeek('2026-07-06')
    expect(q.label).toBe(q.labelEn)
    const stored = `Quest: ${q.labelEn}`
    expect(displayEventLabel(stored)).toBe(stored)
    useUiStore.setState({ language: 'it' })
    expect(q.label).not.toBe(q.labelEn)
    expect(displayEventLabel(stored)).toBe(`Missione: ${q.label}`)
    expect(displayEventLabel('Quest: Finish 3 sessions')).toBe('Missione: Completa 3 allenamenti')
    expect(displayEventLabel('Quest: Move 15,000 kg of volume')).toBe('Missione: Sposta 15.000 kg di volume')
    expect(displayEventLabel('Quest: Something retired')).toBe('Quest: Something retired')
    expect(displayEventLabel('Season carry-over')).toBe('Season carry-over')
  })

  it('strength levels and muscle groups', () => {
    expect(LEVELS.map(levelLabel)).toEqual([...LEVELS])
    expect(muscleGroupLabel('legs')).toBe('Legs')
    useUiStore.setState({ language: 'it' })
    expect(levelLabel('Intermediate')).toBe('Intermedio')
    expect(muscleGroupLabel('legs')).toBe('Gambe')
  })
})
