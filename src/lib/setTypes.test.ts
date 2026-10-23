import { describe, it, expect } from 'vitest'
import {
  SET_TYPES, setKind, normalizeRpe, rirOf, fmtEffort, setTypeLabel, setTypeBadge, briefingTag,
} from './setTypes'

describe('setKind', () => {
  it('reads the warm-up flag first, then the type; absent = working', () => {
    expect(setKind({ isWarmup: true, setType: 'drop' })).toBe('warmup')
    expect(setKind({ isWarmup: false })).toBe('working')
    expect(setKind({ isWarmup: false, setType: 'working' })).toBe('working')
    expect(setKind({ isWarmup: false, setType: 'drop' })).toBe('drop')
    expect(setKind({ isWarmup: false, setType: 'failure' })).toBe('failure')
    expect(setKind({ isWarmup: false, setType: 'amrap' })).toBe('amrap')
  })

  it('treats an unknown stored type as working', () => {
    expect(setKind({ isWarmup: false, setType: 'cluster' as never })).toBe('working')
  })

  it('lists the four set types', () => {
    expect(SET_TYPES).toEqual(['working', 'drop', 'failure', 'amrap'])
  })
})

describe('normalizeRpe', () => {
  it('clamps to 6–10 and rounds to 0.5', () => {
    expect(normalizeRpe(8)).toBe(8)
    expect(normalizeRpe(8.3)).toBe(8.5)
    expect(normalizeRpe(8.2)).toBe(8)
    expect(normalizeRpe(4)).toBe(6)
    expect(normalizeRpe(11)).toBe(10)
  })

  it('rejects anything that is not a finite number', () => {
    expect(normalizeRpe(undefined)).toBeUndefined()
    expect(normalizeRpe(null)).toBeUndefined()
    expect(normalizeRpe('8')).toBeUndefined()
    expect(normalizeRpe(NaN)).toBeUndefined()
    expect(normalizeRpe(Infinity)).toBeUndefined()
  })
})

describe('effort labels', () => {
  it('rirOf is 10 − RPE', () => {
    expect(rirOf(8)).toBe(2)
    expect(rirOf(9.5)).toBe(0.5)
    expect(rirOf(10)).toBe(0)
  })

  it('fmtEffort prints the chosen scale, empty when not recorded', () => {
    expect(fmtEffort(8, 'rpe')).toBe('@8')
    expect(fmtEffort(8, 'rir')).toBe('RIR 2')
    expect(fmtEffort(undefined, 'rpe')).toBe('')
    expect(fmtEffort(undefined, 'rir')).toBe('')
  })

  it('labels and badges every kind', () => {
    expect(setTypeLabel('drop')).toBe('Drop set')
    expect(setTypeLabel('working')).toBe('Working')
    expect(setTypeBadge('drop')).toBe('D')
    expect(setTypeBadge('failure')).toBe('F')
    expect(setTypeBadge('amrap')).toBe('A')
    expect(setTypeBadge('working')).toBe('')
    expect(setTypeBadge('warmup')).toBe('')
  })
})

describe('briefingTag (English, for AI briefings)', () => {
  it('appends the RPE and the type badge', () => {
    expect(briefingTag({ rpe: 8 })).toBe('@8')
    expect(briefingTag({ rpe: 8.5 })).toBe('@8.5')
    expect(briefingTag({ setType: 'drop' })).toBe(' D')
    expect(briefingTag({ setType: 'failure' })).toBe(' F')
    expect(briefingTag({ setType: 'amrap' })).toBe(' A')
    expect(briefingTag({ rpe: 9, setType: 'failure' })).toBe('@9 F')
  })

  it('is empty for a plain working set', () => {
    expect(briefingTag({})).toBe('')
    expect(briefingTag({ setType: 'working' })).toBe('')
    expect(briefingTag({ isWarmup: true, setType: 'drop' })).toBe('')
  })
})
