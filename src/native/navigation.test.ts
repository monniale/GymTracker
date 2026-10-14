import { describe, it, expect, vi } from 'vitest'
import { KNOWN_ROUTES, TAB_ROUTES } from '../routes'
import { ALLOWED_ROUTES, sanitizeRoute, setPendingRoute, subscribePendingRoute, backAction } from './navigation'

describe('ALLOWED_ROUTES', () => {
  it('is a subset of the routes App.tsx declares', () => {
    for (const r of ALLOWED_ROUTES) expect(KNOWN_ROUTES).toContain(r)
  })

  it('contains every tab root and never a summary route (invariant 11)', () => {
    for (const t of TAB_ROUTES) expect(ALLOWED_ROUTES).toContain(t.path)
    expect(ALLOWED_ROUTES.some(r => r.includes('summary'))).toBe(false)
    expect(ALLOWED_ROUTES.some(r => r.includes(':'))).toBe(false)
  })
})

describe('sanitizeRoute', () => {
  it('passes allowed routes through', () => {
    expect(sanitizeRoute('/diet', null)).toBe('/diet')
    expect(sanitizeRoute('/rank', null)).toBe('/rank')
    expect(sanitizeRoute('/settings', 'abc')).toBe('/settings')
    expect(sanitizeRoute(' /progress ', null)).toBe('/progress')
  })

  it('sends anything else to /workout', () => {
    for (const bad of [
      undefined,
      null,
      42,
      {},
      '',
      '/',
      '/workout/summary/12',
      '/workout/past/3',
      '/diet?add=lunch',
      '#/diet',
      'diet',
      '/DIET',
      'javascript:alert(1)',
      'https://evil.example/#/diet',
    ]) {
      expect(sanitizeRoute(bad, 7)).toBe('/workout')
    }
  })

  it('opens /workout/session only while a session is active', () => {
    expect(sanitizeRoute('/workout/session', 12)).toBe('/workout/session')
    expect(sanitizeRoute('/workout/session', 'b6a1c2d3-uuid')).toBe('/workout/session')
    expect(sanitizeRoute('/workout/session', null)).toBe('/workout')
    expect(sanitizeRoute('/workout/session', undefined)).toBe('/workout')
    expect(sanitizeRoute('/workout/session', '')).toBe('/workout')
    expect(sanitizeRoute('/workout/session', NaN)).toBe('/workout')
  })
})

describe('pending route', () => {
  it('queues a route until someone subscribes, then delivers it once', () => {
    setPendingRoute('/rank')
    setPendingRoute('/diet') // latest tap wins
    const fn = vi.fn()
    const off = subscribePendingRoute(fn)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('/diet')
    off()
    const again = vi.fn()
    subscribePendingRoute(again)()
    expect(again).not.toHaveBeenCalled()
  })

  it('delivers directly to a live subscriber and ignores empty values', () => {
    const fn = vi.fn()
    const off = subscribePendingRoute(fn)
    setPendingRoute('/workout/session')
    setPendingRoute(undefined)
    setPendingRoute('  ')
    setPendingRoute(5)
    expect(fn.mock.calls).toEqual([['/workout/session']])
    off()
    setPendingRoute('/settings') // queued again once nobody listens
    const late = vi.fn()
    subscribePendingRoute(late)()
    expect(late).toHaveBeenCalledWith('/settings')
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

describe('backAction', () => {
  it('closes an open sheet first, wherever we are', () => {
    expect(backAction('/workout', 'k1', true)).toEqual({ kind: 'close-sheet' })
    expect(backAction('/workout/session', 'k1', true, 3)).toEqual({ kind: 'close-sheet' })
  })

  it('minimizes on the Workout tab, never exits', () => {
    expect(backAction('/workout', 'abc', false, 5)).toEqual({ kind: 'minimize' })
    expect(backAction('/workout', 'default', false, 0)).toEqual({ kind: 'minimize' })
  })

  it('goes to Workout from the other tab roots (replace, regardless of history)', () => {
    for (const p of ['/diet', '/progress', '/rank', '/settings']) {
      expect(backAction(p, 'abc', false, 4)).toEqual({ kind: 'navigate', to: '/workout' })
      expect(backAction(p, 'default', false, 0)).toEqual({ kind: 'navigate', to: '/workout' })
    }
  })

  it('goes back in history on a sub-route that has history', () => {
    expect(backAction('/workout/session', 'x1', false, 1)).toEqual({ kind: 'back' })
    expect(backAction('/workout/past/9', 'x1', false, null)).toEqual({ kind: 'back' })
  })

  it('goes to the parent tab when the sub-route is the first history entry', () => {
    expect(backAction('/workout/session', 'default', false)).toEqual({ kind: 'navigate', to: '/workout' })
    expect(backAction('/workout/summary/3', 'x1', false, 0)).toEqual({ kind: 'navigate', to: '/workout' })
    expect(backAction('/diet/whatever', 'default', false)).toEqual({ kind: 'navigate', to: '/diet' })
    expect(backAction('/nope/deeper', 'default', false)).toEqual({ kind: 'navigate', to: '/workout' })
    expect(backAction('/', 'default', false)).toEqual({ kind: 'navigate', to: '/workout' })
  })
})
