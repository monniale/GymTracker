import { describe, it, expect } from 'vitest'
import { mapFdc, canonicalGtin } from './usda'
import { remoteFoodKey, searchAcross, lookupAcross } from './foodProviders'
import type { FoodProvider, RemoteFood } from '../types'

/* ---------- USDA normalization ---------- */

const fdc = (over: Record<string, unknown> = {}) => ({
  fdcId: 111,
  description: 'Chicken, breast, raw',
  dataType: 'SR Legacy',
  foodNutrients: [
    { nutrientNumber: '203', unitName: 'G', value: 22.5 },
    { nutrientNumber: '204', unitName: 'G', value: 2.6 },
    { nutrientNumber: '205', unitName: 'G', value: 0 },
    { nutrientNumber: '208', unitName: 'KCAL', value: 120 },
  ],
  ...over,
})

describe('mapFdc', () => {
  it('normalizes SR Legacy energy (208) + macros per 100g', () => {
    const r = mapFdc(fdc())!
    expect(r).toMatchObject({ source: 'usda', sourceId: '111', name: 'Chicken, breast, raw', kcal100: 120, protein100: 22.5, carbs100: 0, fat100: 2.6 })
    expect(r.barcode).toBeUndefined()
  })

  it('reads Foundation energy from Atwater 957 when 208 is absent', () => {
    const r = mapFdc(fdc({
      dataType: 'Foundation',
      foodNutrients: [
        { nutrientNumber: '203', unitName: 'G', value: 22.5 },
        { nutrientNumber: '957', unitName: 'KCAL', value: 106 },
        { nutrientNumber: '958', unitName: 'KCAL', value: 112 },
      ],
    }))!
    expect(r.kcal100).toBe(106) // prefers 208>957>958; 208 absent → 957
  })

  it('derives kcal from kJ (268) as a last resort', () => {
    const r = mapFdc(fdc({ foodNutrients: [{ nutrientNumber: '268', unitName: 'kJ', value: 720 }] }))!
    expect(r.kcal100).toBeCloseTo(720 / 4.184, 1)
  })

  it('drops a food with no usable energy', () => {
    expect(mapFdc(fdc({ foodNutrients: [{ nutrientNumber: '203', unitName: 'G', value: 22 }] }))).toBeNull()
  })

  it('uses gtinUpc as the barcode and grams serving for branded foods', () => {
    const r = mapFdc(fdc({
      dataType: 'Branded', gtinUpc: '009800800124', brandName: 'Nutella',
      servingSize: 52, servingSizeUnit: 'g',
      foodNutrients: [{ nutrientNumber: '208', unitName: 'KCAL', value: 519 }],
    }))!
    expect(r.barcode).toBe('009800800124')
    expect(r.brand).toBe('Nutella')
    expect(r.servingG).toBe(52)
  })

  it('reads servingG from the UN/ECE "GRM" unit code too', () => {
    expect(mapFdc(fdc({ servingSize: 30, servingSizeUnit: 'GRM' }))!.servingG).toBe(30)
    expect(mapFdc(fdc({ servingSize: 30, servingSizeUnit: 'MLT' }))!.servingG).toBeUndefined()
  })

  it('requires a name and fdcId', () => {
    expect(mapFdc(fdc({ description: '' }))).toBeNull()
    expect(mapFdc(fdc({ fdcId: undefined }))).toBeNull()
  })
})

describe('canonicalGtin', () => {
  it('collapses UPC-12 / EAN-13 / GTIN-14 of the same item to one key', () => {
    expect(canonicalGtin('028400589871')).toBe('28400589871') // UPC-12
    expect(canonicalGtin('0028400589871')).toBe('28400589871') // EAN-13 (zxing)
    expect(canonicalGtin('00028400589871')).toBe('28400589871') // GTIN-14
  })
  it('strips non-digits and empty stays empty', () => {
    expect(canonicalGtin(' 12-3 ')).toBe('123')
    expect(canonicalGtin('0000')).toBe('')
  })
})

/* ---------- remoteFoodKey (dedup / cache key) ---------- */

describe('remoteFoodKey', () => {
  const f = (p: Partial<RemoteFood>): RemoteFood =>
    ({ source: 'off', sourceId: 'x', name: 'n', kcal100: 0, protein100: 0, carbs100: 0, fat100: 0, ...p })

  it('uses the raw barcode when present (OFF stays backward-compatible)', () => {
    expect(remoteFoodKey(f({ source: 'off', sourceId: '737628064502', barcode: '737628064502' }))).toBe('737628064502')
  })
  it('a USDA branded gtin dedups against OFF (same barcode → same key)', () => {
    expect(remoteFoodKey(f({ source: 'usda', sourceId: '111', barcode: '737628064502' }))).toBe('737628064502')
  })
  it('namespaces whole foods with no barcode', () => {
    expect(remoteFoodKey(f({ source: 'usda', sourceId: '111' }))).toBe('usda:111')
  })
})

/* ---------- orchestration: fallback search + barcode chain ---------- */

function provider(id: 'off' | 'usda', results: RemoteFood[], opts: { throws?: boolean } = {}): FoodProvider {
  const fail = () => { throw new Error('provider down') }
  return {
    id,
    label: id,
    search: async () => (opts.throws ? fail() : results),
    lookupBarcode: async (code: string) => (opts.throws ? fail() : results.find(r => r.barcode === code) ?? null),
  }
}
const mk = (source: 'off' | 'usda', sourceId: string, barcode?: string): RemoteFood =>
  ({ source, sourceId, barcode, name: sourceId, kcal100: 1, protein100: 1, carbs100: 1, fat100: 1 })

describe('searchAcross (fallback)', () => {
  it('does NOT query the 2nd provider when the primary is rich', async () => {
    let usdaCalled = false
    const usda: FoodProvider = { ...provider('usda', []), search: async () => { usdaCalled = true; return [] } }
    const off = provider('off', Array.from({ length: 6 }, (_, i) => mk('off', String(i), String(i))))
    const r = await searchAcross([off, usda], 'q')
    expect(r).toHaveLength(6)
    expect(usdaCalled).toBe(false)
  })

  it('falls through and appends deduped when the primary is thin', async () => {
    const off = provider('off', [mk('off', 'a', '111'), mk('off', 'b', '222')])
    const usda = provider('usda', [mk('usda', 'x', '222'), mk('usda', 'y')]) // '222' dup, 'y' new
    const r = await searchAcross([off, usda], 'q')
    expect(r.map(remoteFoodKey)).toEqual(['111', '222', 'usda:y'])
  })

  it('survives a provider that throws (another responds)', async () => {
    const off = provider('off', [], { throws: true })
    const usda = provider('usda', [mk('usda', 'y')])
    const r = await searchAcross([off, usda], 'q')
    expect(r.map(remoteFoodKey)).toEqual(['usda:y'])
  })

  it('resolves [] (no throw) when a provider cleanly returns empty', async () => {
    await expect(searchAcross([provider('off', []), provider('usda', [])], 'q')).resolves.toEqual([])
  })

  it('THROWS when EVERY provider errors (real outage → "unreachable")', async () => {
    const down = [provider('off', [], { throws: true }), provider('usda', [], { throws: true })]
    await expect(searchAcross(down, 'q')).rejects.toThrow()
  })
})

describe('lookupAcross (barcode chain)', () => {
  it('returns the first provider hit and short-circuits', async () => {
    let usdaCalled = false
    const off = provider('off', [mk('off', 'a', '111')])
    const usda: FoodProvider = { ...provider('usda', []), lookupBarcode: async () => { usdaCalled = true; return null } }
    const hit = await lookupAcross([off, usda], '111')
    expect(hit?.source).toBe('off')
    expect(usdaCalled).toBe(false)
  })

  it('falls through to the next provider on a clean miss', async () => {
    const off = provider('off', []) // no match for 999
    const usda = provider('usda', [mk('usda', 'z', '999')])
    const hit = await lookupAcross([off, usda], '999')
    expect(hit?.source).toBe('usda')
  })

  it('returns null when all providers cleanly miss', async () => {
    expect(await lookupAcross([provider('off', []), provider('usda', [])], '999')).toBeNull()
  })

  it('returns null (not throw) when OFF cleanly misses and USDA errors (429)', async () => {
    // The common real case: OFF definitively lacks the EAN; the USDA fallback 429s.
    // Should read as "not found — add a custom food", NOT "unreachable".
    const off = provider('off', []) // clean miss for 999
    const usda = provider('usda', [], { throws: true })
    expect(await lookupAcross([off, usda], '999')).toBeNull()
  })

  it('rethrows only when EVERY provider errored (→ "unreachable")', async () => {
    await expect(lookupAcross([provider('off', [], { throws: true })], '999')).rejects.toThrow()
    const allDown = [provider('off', [], { throws: true }), provider('usda', [], { throws: true })]
    await expect(lookupAcross(allDown, '999')).rejects.toThrow()
  })
})
