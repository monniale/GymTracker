import { describe, it, expect, afterEach } from 'vitest'
import { en } from './en'
import { it as itDict } from './it'
import { bindT, t, tp } from './index'
import { useUiStore } from '../lib/uiStore'

type Node = string | { [k: string]: Node }

/** key → leaf ("a.b" → "text", or "a.b#one"/"a.b#other" for plurals). */
function leaves(node: Node, prefix = ''): Map<string, string> {
  const out = new Map<string, string>()
  if (typeof node === 'string') {
    out.set(prefix, node)
    return out
  }
  for (const [k, v] of Object.entries(node)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'object' && v !== null && 'one' in v && 'other' in v && Object.keys(v).length === 2) {
      out.set(`${key}#one`, v.one as string)
      out.set(`${key}#other`, v.other as string)
    } else {
      for (const [lk, lv] of leaves(v, key)) out.set(lk, lv)
    }
  }
  return out
}

const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort()

describe('dictionaries', () => {
  const EN = leaves(en as unknown as Node)
  const IT = leaves(itDict as unknown as Node)

  it('Italian has exactly the English keys', () => {
    expect([...IT.keys()].sort()).toEqual([...EN.keys()].sort())
  })

  it('every message keeps the same {placeholders}', () => {
    const mismatched = [...EN].filter(([k, v]) => {
      const other = IT.get(k)
      // A plural "one" form may drop {n} ("un giorno"), never add new ones.
      if (k.endsWith('#one') && other !== undefined) return !vars(other).every(x => vars(v).includes(x) || x === 'n')
      return other !== undefined && vars(v).join() !== vars(other).join()
    })
    expect(mismatched.map(([k]) => k)).toEqual([])
  })

  it('has no empty English message', () => {
    expect([...EN].filter(([, v]) => v.trim() === '').map(([k]) => k)).toEqual([])
  })
})

describe('t / tp', () => {
  afterEach(() => useUiStore.setState({ language: 'en' }))

  it('translates with the current language and fills placeholders', () => {
    useUiStore.setState({ language: 'en' })
    expect(t('common.save')).toBe('Save')
    useUiStore.setState({ language: 'it' })
    expect(t('common.save')).toBe('Salva')
    expect(bindT('en').t('common.save')).toBe('Save')
  })

  it('picks plural forms per language and formats {n}', () => {
    expect(bindT('en').tp('units.sets', 1)).toBe('1 set')
    expect(bindT('en').tp('units.sets', 3)).toBe('3 sets')
    expect(bindT('it').tp('units.workouts', 1)).toBe('1 allenamento')
    expect(bindT('it').tp('units.workouts', 0)).toBe('0 allenamenti')
    expect(bindT('en').tp('units.points', 1234)).toBe('1,234 points')
    expect(bindT('it').tp('units.points', 1234)).toBe('1234 punti')
    useUiStore.setState({ language: 'it' })
    expect(tp('units.days', 2)).toBe('2 giorni')
  })

  it('formats numbers per language', () => {
    expect(bindT('en').fmtNum(12345.5)).toBe('12,345.5')
    expect(bindT('it').fmtNum(12345.5)).toBe('12.345,5')
  })

  it('falls back to the key for an unknown message', () => {
    expect(bindT('it').t('nope.missing' as never)).toBe('nope.missing')
  })
})
