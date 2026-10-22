import { describe, it, expect } from 'vitest'
import { samplePath, smoothPath, sideOf, FRONT, BACK, SILHOUETTE } from './bodyShapes'
import { BODY_TARGETS } from '../../lib/muscleMap'

describe('smoothPath', () => {
  it('rounds a square into a closed quadratic path inside the square', () => {
    const d = smoothPath('M0 0 L10 0 L10 10 L0 10 Z', 2.4)
    expect(d.startsWith('M')).toBe(true)
    expect(d.endsWith('Z')).toBe(true)
    expect(d).toContain('Q')
    const nums = d.match(/-?\d*\.?\d+/g)!.map(Number)
    expect(Math.min(...nums)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...nums)).toBeLessThanOrEqual(10)
    // the curve's on-path points (after each control point) never touch a corner
    const ends = [...d.matchAll(/Q[-\d.]+ [-\d.]+ ([-\d.]+) ([-\d.]+)/g)].map(m => `${m[1]},${m[2]}`)
    for (const corner of ['0,0', '10,0', '10,10', '0,10']) expect(ends).not.toContain(corner)
  })

  it('samples lines and cubics at most `step` apart', () => {
    const pts = samplePath('M0 0 L10 0 C10 5 5 10 0 10 Z', 2)
    for (let i = 1; i < pts.length; i++) {
      expect(Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])).toBeLessThanOrEqual(2.01)
    }
  })

  it('smooths every shape of the figures', () => {
    for (const [, paths] of [...FRONT, ...BACK]) for (const d of paths) expect(d).toMatch(/^M[^LC]+Z$/)
    expect(SILHOUETTE).toMatch(/^M[^LC]+Z$/)
  })

  it('draws every target on a side', () => {
    const drawn = new Set([...FRONT, ...BACK].map(([t]) => t))
    for (const t of BODY_TARGETS) expect(drawn.has(t)).toBe(true)
    expect(sideOf('pectorals')).toBe('front')
    expect(sideOf('glutes')).toBe('back')
    expect(sideOf('calves')).toBe('back')
    expect(sideOf('delts')).toBe('front')
  })
})
