import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface RestTimer {
  endsAt: number
  totalSec: number
}

interface StopwatchState {
  startedAt: number | null
  accMs: number
}

interface AppStore {
  activeSessionId: number | null
  setActiveSessionId: (id: number | null) => void

  rest: RestTimer | null
  startRest: (sec: number) => void
  adjustRest: (deltaSec: number) => void
  clearRest: () => void

  stopwatch: StopwatchState
  toggleStopwatch: () => void
  resetStopwatch: () => void
}

/**
 * Ephemeral-but-crash-safe state. Persisted to localStorage so an in-progress
 * session and a running rest timer survive an app relaunch (all real data
 * lives in Dexie).
 */
export const useAppStore = create<AppStore>()(
  persist(
    (set, get) => ({
      activeSessionId: null,
      setActiveSessionId: id => set({ activeSessionId: id }),

      rest: null,
      startRest: sec => set({ rest: { endsAt: Date.now() + sec * 1000, totalSec: sec } }),
      adjustRest: deltaSec => {
        const rest = get().rest
        if (!rest) return
        const endsAt = Math.max(Date.now() + 1000, rest.endsAt + deltaSec * 1000)
        set({ rest: { endsAt, totalSec: Math.max(5, rest.totalSec + deltaSec) } })
      },
      clearRest: () => set({ rest: null }),

      stopwatch: { startedAt: null, accMs: 0 },
      toggleStopwatch: () => {
        const { startedAt, accMs } = get().stopwatch
        if (startedAt === null) {
          set({ stopwatch: { startedAt: Date.now(), accMs } })
        } else {
          set({ stopwatch: { startedAt: null, accMs: accMs + (Date.now() - startedAt) } })
        }
      },
      resetStopwatch: () => set({ stopwatch: { startedAt: null, accMs: 0 } }),
    }),
    { name: 'gymtracker-app' },
  ),
)
