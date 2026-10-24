import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ReleaseInfo } from '../lib/updateCheck'

export type UpdateErrorKind = 'rate-limit' | 'network' | 'http'

/** One manual check: the latest release (null = none published yet), or why it failed. */
export type UpdateCheckResult =
  | { latest: ReleaseInfo | null }
  | { error: UpdateErrorKind; status?: number }

/**
 * Last result of the manual "Check for updates" (Settings › Updates, Android only). Persisted to
 * localStorage ('gymtracker-update') like the other device-local stores: never Dexie, so never
 * synced or backed up (ROUTEMAP invariant 3). Lives under src/native/ so the Pages build never
 * carries it. A failed check keeps the last good `latest`, so a known update stays visible offline.
 */
export interface UpdateStore {
  /** Time of the last check attempt (ms), successful or not. */
  lastCheckAt: number | null
  /** Latest release from the last successful check; null = none published (or never checked). */
  latest: ReleaseInfo | null
  /** Why the last check failed; null when it succeeded. */
  error: UpdateErrorKind | null
  /** HTTP status of a failed check (0 when there was none). */
  errorStatus: number
  save: (result: UpdateCheckResult, at?: number) => void
}

type Persisted = Pick<UpdateStore, 'lastCheckAt' | 'latest' | 'error' | 'errorStatus'>

const ERROR_KINDS: readonly UpdateErrorKind[] = ['rate-limit', 'network', 'http']

/** A persisted ReleaseInfo, or null when the stored value is missing or malformed. */
export function asReleaseInfo(v: unknown): ReleaseInfo | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Record<string, unknown>
  const s = (k: string) => typeof r[k] === 'string'
  if (!s('tag') || !s('versionName') || !s('apkUrl') || !s('htmlUrl') || !s('publishedAt')) return null
  if (typeof r.versionCode !== 'number' || !Number.isSafeInteger(r.versionCode)) return null
  return {
    tag: r.tag as string,
    versionName: r.versionName as string,
    versionCode: r.versionCode,
    apkUrl: r.apkUrl as string,
    ...(typeof r.idsigUrl === 'string' ? { idsigUrl: r.idsigUrl } : {}),
    htmlUrl: r.htmlUrl as string,
    publishedAt: r.publishedAt as string,
  }
}

/** Rehydration: validates every persisted field (corrupt or older-shape storage falls back to the defaults). */
export function mergePersisted<T extends Persisted>(persisted: unknown, current: T): T {
  const p = (typeof persisted === 'object' && persisted !== null ? persisted : {}) as Partial<
    Record<keyof Persisted, unknown>
  >
  return {
    ...current,
    lastCheckAt: typeof p.lastCheckAt === 'number' && Number.isFinite(p.lastCheckAt) ? p.lastCheckAt : null,
    latest: asReleaseInfo(p.latest),
    error: ERROR_KINDS.includes(p.error as UpdateErrorKind) ? (p.error as UpdateErrorKind) : null,
    errorStatus: typeof p.errorStatus === 'number' && Number.isFinite(p.errorStatus) ? p.errorStatus : 0,
  }
}

export const useUpdateStore = create<UpdateStore>()(
  persist(
    set => ({
      lastCheckAt: null,
      latest: null,
      error: null,
      errorStatus: 0,
      save: (result, at = Date.now()) =>
        set(
          'error' in result
            ? { lastCheckAt: at, error: result.error, errorStatus: result.status ?? 0 }
            : { lastCheckAt: at, latest: result.latest, error: null, errorStatus: 0 },
        ),
    }),
    {
      name: 'gymtracker-update',
      version: 1,
      partialize: (s): Persisted => ({
        lastCheckAt: s.lastCheckAt,
        latest: s.latest,
        error: s.error,
        errorStatus: s.errorStatus,
      }),
      merge: mergePersisted,
    },
  ),
)
