/** Open Food Facts search client. Free, no API key, CORS-enabled. */
import { db } from '../db/db'
import type { Id } from '../types'

export interface OffProduct {
  offId: string
  name: string
  brand?: string
  kcal100: number
  protein100: number
  carbs100: number
  fat100: number
  servingG?: number
  servingLabel?: string
}

const FIELDS = 'code,product_name,brands,nutriments,serving_size,serving_quantity'

export async function searchOff(query: string, signal?: AbortSignal): Promise<OffProduct[]> {
  const url =
    'https://world.openfoodfacts.org/cgi/search.pl?search_simple=1&action=process&json=1' +
    `&page_size=25&fields=${FIELDS}&app_name=gymtracker&search_terms=${encodeURIComponent(query)}`
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Open Food Facts search failed (${res.status})`)
  const data = await res.json()
  const products: unknown[] = Array.isArray(data.products) ? data.products : []
  const mapped: OffProduct[] = []
  const seen = new Set<string>()
  for (const p of products) {
    const m = mapProduct(p as Record<string, unknown>)
    if (m && !seen.has(m.offId)) {
      seen.add(m.offId)
      mapped.push(m)
    }
  }
  return mapped
}

/** Direct product lookup by scanned/typed EAN. Returns null when unknown. */
export async function lookupBarcode(code: string, signal?: AbortSignal): Promise<OffProduct | null> {
  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}` +
    `?fields=${FIELDS}&app_name=gymtracker`
  const res = await fetch(url, { signal })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Open Food Facts lookup failed (${res.status})`)
  const data = await res.json()
  if (data.status !== 1 || !data.product) return null
  return mapProduct({ code, ...data.product })
}

/**
 * Insert an OFF product into the local foods table (or return the existing row
 * — a previously cached/user-edited food always wins over fresh API data).
 */
export async function upsertOffProduct(p: OffProduct): Promise<Id> {
  const existing = await db.foods.where('offId').equals(p.offId).first()
  if (existing) return existing.id!
  return db.foods.add({
    source: 'off',
    offId: p.offId,
    name: p.name,
    nameLower: p.name.toLowerCase(),
    brand: p.brand,
    kcal100: p.kcal100,
    protein100: p.protein100,
    carbs100: p.carbs100,
    fat100: p.fat100,
    servingG: p.servingG,
    servingLabel: p.servingLabel,
    userOverridden: false,
    offOriginal: {
      kcal100: p.kcal100,
      protein100: p.protein100,
      carbs100: p.carbs100,
      fat100: p.fat100,
    },
    lastUsedAt: Date.now(),
    useCount: 0,
  })
}

function num(v: unknown): number | undefined {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : undefined
}

function mapProduct(p: Record<string, unknown>): OffProduct | null {
  const offId = typeof p.code === 'string' ? p.code : String(p.code ?? '')
  const name = typeof p.product_name === 'string' ? p.product_name.trim() : ''
  if (!offId || !name) return null

  const n = (p.nutriments ?? {}) as Record<string, unknown>
  let kcal = num(n['energy-kcal_100g'])
  if (kcal === undefined) {
    const kj = num(n['energy_100g'])
    if (kj !== undefined) kcal = kj / 4.184
  }
  if (kcal === undefined) return null

  const brand = typeof p.brands === 'string' && p.brands
    ? p.brands.split(',')[0].trim()
    : undefined

  return {
    offId,
    name,
    brand,
    kcal100: round1(kcal),
    protein100: round1(num(n.proteins_100g) ?? 0),
    carbs100: round1(num(n.carbohydrates_100g) ?? 0),
    fat100: round1(num(n.fat_100g) ?? 0),
    servingG: num(p.serving_quantity),
    servingLabel: typeof p.serving_size === 'string' ? p.serving_size : undefined,
  }
}

function round1(v: number): number {
  return Math.round(v * 10) / 10
}
