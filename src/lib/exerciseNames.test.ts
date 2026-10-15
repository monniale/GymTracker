import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { CATALOG_NAMES_TRANSLATED, exerciseDisplayName } from './exerciseNames'
import { useUiStore } from './uiStore'

/** The English catalog names, read from the seed's `ROWS` (not exported: the seed owns them). */
const SEED_NAMES = [...readFileSync(new URL('../db/seed.ts', import.meta.url), 'utf8')
  .matchAll(/^\s*\['([^']+)', '[a-z]+', '[a-z]+', \d+\],?$/gm)].map(m => m[1])

describe('exerciseDisplayName', () => {
  afterEach(() => useUiStore.setState({ language: 'en' }))

  it('the Italian map covers exactly the seed catalog', () => {
    expect(SEED_NAMES.length).toBeGreaterThan(60)
    expect([...CATALOG_NAMES_TRANSLATED].sort()).toEqual([...SEED_NAMES].sort())
  })

  it('English shows the stored name unchanged', () => {
    for (const n of SEED_NAMES) expect(exerciseDisplayName(n)).toBe(n)
  })

  it('Italian translates catalog names and leaves custom names alone', () => {
    useUiStore.setState({ language: 'it' })
    expect(exerciseDisplayName('Bench Press')).toBe('Panca piana')
    expect(exerciseDisplayName('Deadlift')).toBe('Stacco da terra')
    expect(exerciseDisplayName('Lat Pulldown')).toBe('Lat Machine')
    expect(exerciseDisplayName('Hip Thrust')).toBe('Hip Thrust')
    expect(exerciseDisplayName('Push-Up')).toBe('Piegamenti')
    expect(exerciseDisplayName('My Cable Thing')).toBe('My Cable Thing')
    expect(exerciseDisplayName('bench press')).toBe('bench press') // only the exact catalog name
    for (const n of SEED_NAMES) expect(exerciseDisplayName(n).trim()).not.toBe('')
  })
})

describe('exerciseDisplayName with prototype names', () => {
  it('passes custom names like "constructor" through in Italian', () => {
    useUiStore.setState({ language: 'it' })
    try {
      expect(exerciseDisplayName('constructor')).toBe('constructor')
      expect(exerciseDisplayName('toString')).toBe('toString')
    } finally {
      useUiStore.setState({ language: 'en' })
    }
  })
})
