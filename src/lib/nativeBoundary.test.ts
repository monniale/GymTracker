import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * ROUTEMAP invariant 14 — the native/PWA import boundary.
 * - Capacitor plugin packages (`@capacitor/*` except `@capacitor/core`, `@capacitor-community/*`,
 *   `@capacitor-mlkit/*`) are imported only under src/native/.
 * - Outside src/native/, the only modules of src/native/ that may be imported statically are
 *   platform.ts and haptics.ts (type-only imports are erased and allowed); everything else is a
 *   dynamic `import()` / `React.lazy`, in a file that gates it on `isNative`.
 * - platform.ts and haptics.ts are shared-safe: no static plugin imports.
 * The compile-time proof that the gates work is `node scripts/check-pwa-dist.mjs` on the Pages build.
 */

const SRC = fileURLToPath(new URL('..', import.meta.url))
const NATIVE = join(SRC, 'native') + sep
const SHARED_SAFE = new Set([join(NATIVE, 'platform'), join(NATIVE, 'haptics')])
const PLUGIN_PKG = /^@capacitor\/(?!core$)|^@capacitor-community\/|^@capacitor-mlkit\//

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return walk(p)
    return /\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts') ? [p] : []
  })
}

interface Imp {
  spec: string
  kind: 'static' | 'type' | 'dynamic'
}

function importsOf(code: string): Imp[] {
  const out: Imp[] = []
  // import x from '…' / import { a, type b } from '…' / import '…' / export … from '…' (multi-line ok)
  for (const m of code.matchAll(/^\s*(import|export)\s+(type\s+)?(?:[\w*{}\s,$]+?\s+from\s+)?['"]([^'"]+)['"]/gm))
    out.push({ spec: m[3], kind: m[2] ? 'type' : 'static' })
  for (const m of code.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push({ spec: m[1], kind: 'dynamic' })
  return out
}

/** Absolute path without extension for a relative specifier, else null (package). */
function target(file: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null
  return resolve(dirname(file), spec).replace(/\.(ts|tsx|js)$/, '')
}

const files = walk(SRC).filter(f => f !== fileURLToPath(import.meta.url))
const rel = (f: string) => relative(SRC, f)

describe('native/PWA import boundary (invariant 14)', () => {
  it('finds the imports it is meant to police', () => {
    const total = files.reduce((n, f) => n + importsOf(readFileSync(f, 'utf8')).length, 0)
    expect(files.length).toBeGreaterThan(50)
    expect(total).toBeGreaterThan(200)
    expect(importsOf("import {\n  a,\n  type B,\n} from '../native/x'\nvoid import('./native/y')").map(i => i.kind)).toEqual([
      'static',
      'dynamic',
    ])
  })

  it('imports Capacitor plugin packages only under src/native/', () => {
    const bad: string[] = []
    for (const f of files) {
      if (f.startsWith(NATIVE)) continue
      for (const i of importsOf(readFileSync(f, 'utf8'))) if (PLUGIN_PKG.test(i.spec)) bad.push(`${rel(f)} → ${i.spec}`)
    }
    expect(bad).toEqual([])
  })

  it('imports src/native/ statically only through platform.ts and haptics.ts', () => {
    const bad: string[] = []
    for (const f of files) {
      if (f.startsWith(NATIVE)) continue
      for (const i of importsOf(readFileSync(f, 'utf8'))) {
        const t = target(f, i.spec)
        if (i.kind === 'static' && t && (t + sep).startsWith(NATIVE) && !SHARED_SAFE.has(t)) bad.push(`${rel(f)} → ${i.spec}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('gates dynamic native imports on isNative', () => {
    const bad: string[] = []
    for (const f of files) {
      if (f.startsWith(NATIVE)) continue
      const code = readFileSync(f, 'utf8')
      const dyn = importsOf(code).filter(i => i.kind === 'dynamic' && (target(f, i.spec) + sep).startsWith(NATIVE))
      if (dyn.length && !/\bisNative\b/.test(code)) bad.push(rel(f))
    }
    expect(bad).toEqual([])
  })

  it('keeps platform.ts and haptics.ts shared-safe', () => {
    const staticSpecs = (name: string) =>
      importsOf(readFileSync(join(NATIVE, name), 'utf8'))
        .filter(i => i.kind === 'static')
        .map(i => i.spec)
    expect(staticSpecs('platform.ts')).toEqual(['@capacitor/core'])
    expect(staticSpecs('haptics.ts').filter(s => PLUGIN_PKG.test(s) || s.startsWith('@capacitor/'))).toEqual([])
  })
})
