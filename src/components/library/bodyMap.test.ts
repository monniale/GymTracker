import { describe, it, expect } from 'vitest'
import { BODY_TARGETS, chipTargets, nextSelection, regionState } from './BodyMap'

describe('BodyMap helpers', () => {
  it('dims targets without exercises and marks the selected one', () => {
    const counts = { quads: 12, abs: 3, calves: 0 }
    expect(regionState('quads', counts, 'quads')).toBe('on')
    expect(regionState('abs', counts, 'quads')).toBe('idle')
    expect(regionState('calves', counts, null)).toBe('off')
    expect(regionState('lats', counts, 'lats')).toBe('off')
  })

  it('toggles the selection', () => {
    expect(nextSelection(null, 'abs')).toBe('abs')
    expect(nextSelection('quads', 'abs')).toBe('abs')
    expect(nextSelection('abs', 'abs')).toBeNull()
  })

  it('lists chips with a count in BODY_TARGETS order', () => {
    expect(chipTargets({ calves: 4, traps: 525, abs: 0, delts: 9 })).toEqual(['traps', 'delts', 'calves'])
    expect(chipTargets({})).toEqual([])
    expect(BODY_TARGETS).toHaveLength(18)
  })
})
