import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { mergeNotifyPrefs, mergeRestAlert } from './notifyPrefs'
import type { NotifyPrefs, RestAlertPrefs } from './notifyPrefs'

/** Outcome of one reminder re-plan (src/native/notifications.ts). Runtime only, never persisted. */
export interface ResyncResult {
  at: number
  reason: string
  scheduled: number
  cancelled: number
  cleaned: number
  exact: boolean
  horizon?: number
  skipped?: 'web' | 'permission' | 'disabled'
  error?: string
}

/**
 * Device-local notification / haptics settings (Android). Persisted to localStorage
 * ('gymtracker-notify') like `aiStore`/`useSyncStore`: never Dexie, so never synced or backed up
 * (ROUTEMAP invariant 3). Every write and every rehydration goes through `mergeNotifyPrefs` /
 * `mergeRestAlert`, so nested defaults added later reach existing installs (zustand's default
 * persist merge is shallow).
 */
export interface NotifyStore {
  prefs: NotifyPrefs
  rest: RestAlertPrefs
  haptics: boolean
  permissionAsked: boolean
  restoreDismissed: boolean
  samsungNeverSleepingDone: boolean
  planStamp: string | null
  /** Runtime only (excluded from persistence). */
  lastResync: ResyncResult | null
  setPrefs: (update: (p: NotifyPrefs) => NotifyPrefs) => void
  setRest: (patch: Partial<RestAlertPrefs>) => void
  setHaptics: (v: boolean) => void
  markPermissionAsked: () => void
  setRestoreDismissed: (v: boolean) => void
  setSamsungNeverSleepingDone: (v: boolean) => void
  setPlanStamp: (s: string) => void
  setLastResync: (r: ResyncResult) => void
}

type Persisted = Pick<
  NotifyStore,
  'prefs' | 'rest' | 'haptics' | 'permissionAsked' | 'restoreDismissed' | 'samsungNeverSleepingDone' | 'planStamp'
>

const flag = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d)

export const useNotifyStore = create<NotifyStore>()(
  persist(
    set => ({
      prefs: mergeNotifyPrefs(undefined),
      rest: mergeRestAlert(undefined),
      haptics: true,
      permissionAsked: false,
      restoreDismissed: false,
      samsungNeverSleepingDone: false,
      planStamp: null,
      lastResync: null,
      setPrefs: update => set(s => ({ prefs: mergeNotifyPrefs(update(s.prefs)) })),
      setRest: patch => set(s => ({ rest: mergeRestAlert({ ...s.rest, ...patch }) })),
      setHaptics: v => set({ haptics: v }),
      markPermissionAsked: () => set({ permissionAsked: true }),
      setRestoreDismissed: v => set({ restoreDismissed: v }),
      setSamsungNeverSleepingDone: v => set({ samsungNeverSleepingDone: v }),
      setPlanStamp: s => set({ planStamp: s }),
      setLastResync: r => set({ lastResync: r }),
    }),
    {
      name: 'gymtracker-notify',
      version: 1,
      partialize: (s): Persisted => ({
        prefs: s.prefs,
        rest: s.rest,
        haptics: s.haptics,
        permissionAsked: s.permissionAsked,
        restoreDismissed: s.restoreDismissed,
        samsungNeverSleepingDone: s.samsungNeverSleepingDone,
        planStamp: s.planStamp,
      }),
      merge: (persisted, current) => {
        const p = (typeof persisted === 'object' && persisted !== null ? persisted : {}) as Partial<Record<keyof Persisted, unknown>>
        return {
          ...current,
          prefs: mergeNotifyPrefs(p.prefs),
          rest: mergeRestAlert(p.rest),
          haptics: flag(p.haptics, current.haptics),
          permissionAsked: flag(p.permissionAsked, current.permissionAsked),
          restoreDismissed: flag(p.restoreDismissed, current.restoreDismissed),
          samsungNeverSleepingDone: flag(p.samsungNeverSleepingDone, current.samsungNeverSleepingDone),
          planStamp: typeof p.planStamp === 'string' ? p.planStamp : current.planStamp,
        }
      },
    },
  ),
)
