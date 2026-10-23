import { describe, it, expect } from 'vitest'
import { refLabelPlace, refLineInReach } from './Charts'

describe('refLineInReach', () => {
  it('is false for no data or a non-finite line', () => {
    expect(refLineInReach([], 80)).toBe(false)
    expect(refLineInReach([78, 82], Number.NaN)).toBe(false)
    expect(refLineInReach([78, 82], Number.POSITIVE_INFINITY)).toBe(false)
  })

  it('allows 15 % of the data span beyond min and max', () => {
    // Span 4: reach 0.6.
    expect(refLineInReach([78, 82], 77.4)).toBe(true)
    expect(refLineInReach([78, 82], 77.3)).toBe(false)
    expect(refLineInReach([78, 82], 82.6)).toBe(true)
    expect(refLineInReach([78, 82], 82.7)).toBe(false)
  })

  it('gives a flat series 15 % of a nominal 1 unit', () => {
    expect(refLineInReach([80, 80], 80.1)).toBe(true)
    expect(refLineInReach([80, 80], 80.2)).toBe(false)
    expect(refLineInReach([80, 80], 79.9)).toBe(true)
  })
})

describe('refLabelPlace', () => {
  const P = { l: 34, r: 12, t: 14, b: 22 }
  const W = 340
  const H = 180
  // The latest point plus its value label (drawn above it) cover about lastY - 17 .. lastY + 6.
  const overlapsLatest = (y: number, lastY: number) => y + 2 >= lastY - 18 && y - 8 <= lastY + 7

  it('goes on the side of the line away from a distant latest point, at the right end', () => {
    expect(refLabelPlace(100, 40, P, W, H)).toEqual({ x: W - P.r, y: 112, anchor: 'end' }) // point above: label under
    expect(refLabelPlace(60, 120, P, W, H)).toEqual({ x: W - P.r, y: 56, anchor: 'end' }) // point below: label above
  })

  it('never shares the band of the latest point and its value label', () => {
    for (let lastY = 20; lastY <= 150; lastY += 1) {
      for (const ly of [30, 60, 90, 120, 150]) {
        const p = refLabelPlace(ly, lastY, P, W, H)
        if (p.anchor === 'end') expect(overlapsLatest(p.y, lastY)).toBe(false)
      }
    }
  })

  it('moves to the left end when the latest point sits just under the line (gain goal approached from below)', () => {
    const p = refLabelPlace(90, 96, P, W, H)
    expect(p.anchor).toBe('start')
    expect(p.x).toBe(P.l + 4)
  })

  it('stays inside the plot', () => {
    for (const ly of [P.t, H - P.b]) {
      const p = refLabelPlace(ly, 90, P, W, H)
      expect(p.y).toBeGreaterThanOrEqual(P.t + 8)
      expect(p.y).toBeLessThanOrEqual(H - P.b - 2)
    }
  })
})
