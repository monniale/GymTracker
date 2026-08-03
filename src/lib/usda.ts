/**
 * USDA FoodData Central (FDC) provider. Free US-government database, strong on
 * generic/whole foods where Open Food Facts is thin. Browser-direct (CORS: the
 * api.data.gov gateway sends `access-control-allow-origin: *`).
 *
 * KEY: read from `.env` (VITE_USDA_KEY), falling back to DEMO_KEY (~30 req/hr/IP;
 * a real free key from https://fdc.nal.usda.gov/api-key-signup gives 1,000/hr).
 * IMPORTANT — this is a *static* app: Vite inlines VITE_* vars into the built JS
 * at build time, so the key is still present in the public bundle and readable by
 * anyone who inspects the deployed site. The `.env` only keeps it out of the
 * source repo / git history (and lets CI inject it as a secret). That is
 * acceptable ONLY because a data.gov key is free and rate-limited PER CALLER IP —
 * a scraped key cannot cost anything. Never route a billable/account key (e.g.
 * the Gemini key, which stays device-local) through this path.
 */
import type { FoodProvider, RemoteFood } from '../types'

const USDA_API_KEY = import.meta.env.VITE_USDA_KEY || 'DEMO_KEY'
const ENDPOINT = 'https://api.nal.usda.gov/fdc/v1/foods/search'
// Foundation + SR Legacy are the whole-foods value-add; Branded rounds out US products.
const DATA_TYPES = 'Foundation,SR Legacy,Branded'

interface FdcNutrient {
  nutrientNumber?: string
  unitName?: string
  value?: number
}
interface FdcFood {
  fdcId?: number
  description?: string
  dataType?: string
  brandName?: string
  brandOwner?: string
  gtinUpc?: string
  servingSize?: number
  servingSizeUnit?: string
  householdServingFullText?: string
  foodNutrients?: FdcNutrient[]
}

async function fdcSearch(query: string, signal?: AbortSignal): Promise<FdcFood[]> {
  const url =
    `${ENDPOINT}?api_key=${USDA_API_KEY}&query=${encodeURIComponent(query)}` +
    `&pageSize=25&dataType=${encodeURIComponent(DATA_TYPES)}`
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`USDA FoodData Central failed (${res.status})`)
  const data = await res.json()
  return Array.isArray(data.foods) ? (data.foods as FdcFood[]) : []
}

export async function searchUsda(query: string, signal?: AbortSignal): Promise<RemoteFood[]> {
  const foods = await fdcSearch(query, signal)
  const mapped: RemoteFood[] = []
  const seen = new Set<string>()
  for (const f of foods) {
    const m = mapFdc(f)
    if (m && !seen.has(m.sourceId)) {
      seen.add(m.sourceId)
      mapped.push(m)
    }
  }
  return mapped
}

/** Canonical GTIN for cross-format matching: digits only, leading zeros removed,
 * so a UPC-12, its zero-padded EAN-13, and a GTIN-14 of the same item compare
 * equal (zxing yields a 13-digit EAN for a UPC-A symbol; FDC stores UPC-12/GTIN-14). */
export function canonicalGtin(code: string): string {
  return code.replace(/\D/g, '').replace(/^0+/, '')
}

/** FDC has no barcode endpoint: search by the code and keep a canonical gtin match. */
export async function lookupUsdaBarcode(code: string, signal?: AbortSignal): Promise<RemoteFood | null> {
  const target = canonicalGtin(code)
  if (!target) return null
  const foods = await fdcSearch(code, signal)
  const hit = foods.find(f => typeof f.gtinUpc === 'string' && canonicalGtin(f.gtinUpc) === target)
  if (!hit) return null
  const m = mapFdc(hit)
  // Cache under the SCANNED code so the key matches OFF's EAN-13 representation
  // (dedups a USDA-resolved scan against the same product later found in OFF).
  return m ? { ...m, barcode: code } : null
}

export const usdaProvider: FoodProvider = {
  id: 'usda',
  label: 'USDA',
  search: searchUsda,
  lookupBarcode: lookupUsdaBarcode,
}

// Energy in kcal: Foundation foods report Atwater (957/958), SR/Branded report 208.
const ENERGY_KCAL_NUMS = ['208', '957', '958']

function kcalPer100(nutrients: FdcNutrient[]): number | undefined {
  for (const num of ENERGY_KCAL_NUMS) {
    const n = nutrients.find(
      x => x.nutrientNumber === num && (x.unitName ?? '').toUpperCase() === 'KCAL' && Number.isFinite(x.value),
    )
    if (n) return n.value
  }
  const kj = nutrients.find(x => x.nutrientNumber === '268' && Number.isFinite(x.value))
  return kj ? (kj.value as number) / 4.184 : undefined
}

function macroPer100(nutrients: FdcNutrient[], num: string): number {
  const n = nutrients.find(x => x.nutrientNumber === num && Number.isFinite(x.value))
  return n ? (n.value as number) : 0
}

export function mapFdc(food: FdcFood): RemoteFood | null {
  const name = (food.description ?? '').trim()
  if (!name || food.fdcId === undefined) return null
  const nutrients = food.foodNutrients ?? []
  const kcal = kcalPer100(nutrients)
  if (kcal === undefined) return null // no usable energy → drop

  const brandRaw = food.brandName || food.brandOwner
  const gtin = typeof food.gtinUpc === 'string' && food.gtinUpc.trim() ? food.gtinUpc.trim() : undefined

  return {
    source: 'usda',
    sourceId: String(food.fdcId),
    barcode: gtin,
    name,
    brand: brandRaw ? String(brandRaw).trim() : undefined,
    kcal100: round1(kcal),
    protein100: round1(macroPer100(nutrients, '203')),
    carbs100: round1(macroPer100(nutrients, '205')),
    fat100: round1(macroPer100(nutrients, '204')),
    // FDC serving unit is 'g' or the UN/ECE code 'GRM'.
    servingG:
      ['g', 'grm'].includes(food.servingSizeUnit?.toLowerCase() ?? '') && Number.isFinite(food.servingSize)
        ? food.servingSize
        : undefined,
    servingLabel: food.householdServingFullText || undefined,
  }
}

function round1(v: number): number {
  return Math.round(v * 10) / 10
}
