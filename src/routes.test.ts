import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { TAB_ROUTES, KNOWN_ROUTES } from './routes'

describe('routes', () => {
  it('every tab root is a known route', () => {
    for (const t of TAB_ROUTES) expect(KNOWN_ROUTES).toContain(t.path)
    expect(new Set(TAB_ROUTES.map(t => t.path)).size).toBe(TAB_ROUTES.length)
  })

  it('every literal <Route path> in App.tsx is listed in KNOWN_ROUTES', () => {
    const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
    const paths = [...app.matchAll(/<Route\s+path="([^"]+)"/g)].map(m => m[1]).filter(p => p !== '/' && p !== '*')
    expect(paths.length).toBeGreaterThan(0)
    for (const p of paths) expect(KNOWN_ROUTES).toContain(p)
  })
})
