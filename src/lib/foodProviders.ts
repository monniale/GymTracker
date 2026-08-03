/**
 * Food-database registry + orchestrator. Providers are tried in order:
 *  - text SEARCH is fallback — query the primary; only hit the rest when it's
 *    thin, then append deduped results (the user's chosen behaviour);
 *  - BARCODE is a fallback chain — first provider with a hit wins.
 * Adding a database is a one-line registry change; nothing else needs to know
 * how many sources exist.
 */
import { db } from '../db/db'
import { offProvider } from './off'
import { usdaProvider } from './usda'
import type { FoodProvider, Id, RemoteFood } from '../types'

/** Registry order = priority. Open Food Facts first (keyless, barcode-strong),
 * then USDA (free key, whole-foods-strong). */
export const PROVIDERS: FoodProvider[] = [offProvider, usdaProvider]

/** Below this many primary results, fall back to the next database(s). */
const THIN = 5

/** Stable cross-provider identity: the barcode when known, else source+id. Used
 * for dedup and as the Dexie `offId` cache key (barcode stays raw so OFF rows
 * are backward-compatible and a USDA branded gtin dedups against OFF for free). */
export function remoteFoodKey(p: RemoteFood): string {
  return p.barcode ?? `${p.source}:${p.sourceId}`
}

/** Tracks whether ANY provider responded (even with an empty result / clean miss)
 * vs. every one erroring — so a total outage can be surfaced as "unreachable"
 * while a genuine empty from a reachable provider is reported as "no results". */
class ProviderRun {
  anyOk = false
  lastErr: unknown = null
}

async function safeSearch(run: ProviderRun, p: FoodProvider, query: string, signal?: AbortSignal): Promise<RemoteFood[]> {
  try {
    const r = await p.search(query, signal)
    run.anyOk = true
    return r
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    run.lastErr = e // one provider being down must not sink the others
    return []
  }
}

/** Search across an ordered provider list: query the first; only fall through to
 * the rest when it's thin, then append deduped. Throws only when EVERY provider
 * errored (so a real outage surfaces, not a misleading "no results"). Injectable. */
export async function searchAcross(
  providers: FoodProvider[],
  query: string,
  signal?: AbortSignal,
): Promise<RemoteFood[]> {
  if (providers.length === 0) return []
  const run = new ProviderRun()
  const primary = await safeSearch(run, providers[0], query, signal)
  if (primary.length >= THIN) return primary

  const seen = new Set(primary.map(remoteFoodKey))
  const merged = [...primary]
  for (const provider of providers.slice(1)) {
    for (const item of await safeSearch(run, provider, query, signal)) {
      const key = remoteFoodKey(item)
      if (!seen.has(key)) {
        seen.add(key)
        merged.push(item)
      }
    }
  }
  if (!run.anyOk && run.lastErr) throw run.lastErr
  return merged
}

/** Try each provider in order until one resolves the barcode (first hit wins).
 * Returns null when at least one provider cleanly responded (→ "not found");
 * rethrows only when EVERY provider errored (→ "unreachable"). This keeps a
 * plain OFF miss showing "add a custom food" even if the USDA fallback 429s. */
export async function lookupAcross(
  providers: FoodProvider[],
  code: string,
  signal?: AbortSignal,
): Promise<RemoteFood | null> {
  const run = new ProviderRun()
  for (const provider of providers) {
    try {
      const hit = await provider.lookupBarcode(code, signal)
      run.anyOk = true
      if (hit) return hit
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e
      run.lastErr = e
    }
  }
  if (!run.anyOk && run.lastErr) throw run.lastErr
  return null
}

/** Search the registered databases (fallback). */
export const searchFoods = (query: string, signal?: AbortSignal): Promise<RemoteFood[]> =>
  searchAcross(PROVIDERS, query, signal)

/** Look up a barcode across the registered databases (first hit wins). */
export const lookupBarcodeChained = (code: string, signal?: AbortSignal): Promise<RemoteFood | null> =>
  lookupAcross(PROVIDERS, code, signal)

/**
 * Cache a remote product into db.foods, or return the existing row (a locally
 * cached / user-edited food always wins over fresh API data). Deduped by the
 * generalized `offId` key so the same barcode never doubles up across sources.
 */
export async function upsertRemoteFood(p: RemoteFood): Promise<Id> {
  const offId = remoteFoodKey(p)
  const existing = await db.foods.where('offId').equals(offId).first()
  if (existing) return existing.id!
  return db.foods.add({
    source: p.source,
    offId,
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
