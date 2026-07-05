/** Open Food Facts search client. Free, no API key, CORS-enabled. */

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
