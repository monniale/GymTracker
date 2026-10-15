import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Guard: no hard-coded English UI copy in screens, components or native UI. JSX text and
 * aria-label / placeholder / title / alt literals must come from src/i18n (t / tp).
 * Brand names, units and symbols are allowed. Enforced once the migration is complete;
 * until then run it with I18N_GUARD=1 to list what is left.
 */
const ENFORCE = false
const DIRS = ['src/screens', 'src/components', 'src/native/ui']

/** Text that is the same in every language. */
const ALLOW = new Set([
  'GymTracker', 'Gemini', 'GitHub', 'PAT', 'Strong', 'Hevy', 'USDA', 'Open Food Facts', 'kg', 'km', 'kcal', 'ml',
  'g', 'min', 's', 'W', 'P', 'C', 'F', 'e1RM', 'RM', 'OK', 'English', 'Italiano', 'AI',
])

/** Text between `>` and `<` that is really code (comparisons such as `a > b … c < d`). */
const CODE = /\b(const|let|return|useState|useRef|Promise|null|undefined|await|async)\b|=>|===|!==|&&|\|\||[;{}]|\w\(|^\s*[=(!]|^\w+\.\w+|\?\s*\(|\)\s*:/

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return files(p)
    return p.endsWith('.tsx') && !p.endsWith('.test.tsx') ? [p] : []
  })
}

/** Hard-coded copy in one file: JSX text nodes and literal user-facing attributes. */
export function findCopy(src: string): string[] {
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    // TypeScript generics (useState<Food | null>, Promise<void>, Map<Id, Food[]>) are not JSX.
    .replace(/<[A-Z][\w.]*(?:\[\])?(?:\s*[|,]\s*[\w.'"]+(?:\[\])?)*>/g, '')
  const hits: string[] = []
  for (const m of code.matchAll(/>([^<>{}]*)</g)) {
    const text = m[1].replace(/\s+/g, ' ').trim()
    if (!/[A-Za-z]{2,}/.test(text) || ALLOW.has(text) || CODE.test(text)) continue
    hits.push(text)
  }
  for (const m of code.matchAll(/\b(aria-label|placeholder|title|alt)="([^"]*)"/g)) {
    if (/[A-Za-z]{2,}/.test(m[2]) && !ALLOW.has(m[2])) hits.push(`${m[1]}="${m[2]}"`)
  }
  return hits
}

describe('UI copy goes through src/i18n', () => {
  it('finds JSX text and literal attributes', () => {
    expect(findCopy('<p className="x">Hello world</p><b>{t("a")}</b><i aria-label="Close menu" />')).toEqual([
      'Hello world', 'aria-label="Close menu"',
    ])
    expect(findCopy('<span>kg</span><span>{n} </span>')).toEqual([])
    expect(findCopy('const [a, setA] = useState<Food | null>(null)\nconst x = a > b && c < d\nfn(): Promise<void> {}')).toEqual([])
    expect(findCopy('<p>Shaded band = the 10–20 range (optional)</p>')).toEqual(['Shaded band = the 10–20 range (optional)'])
  })

  it.runIf(ENFORCE || process.env.I18N_GUARD === '1')('has no hard-coded English in screens, components and native UI', () => {
    const left = DIRS.flatMap(d => files(d).flatMap(f => findCopy(readFileSync(f, 'utf8')).map(h => `${f}: ${h}`)))
    expect(left).toEqual([])
  })
})
