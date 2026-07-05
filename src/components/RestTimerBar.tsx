import { useEffect, useRef } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { X, TimerReset } from 'lucide-react'
import { db } from '../db/db'
import { useAppStore } from '../store'
import { useNow } from '../lib/hooks'
import { beep } from '../lib/audio'
import { fmtDuration } from '../lib/dates'

export default function RestTimerBar() {
  const rest = useAppStore(s => s.rest)
  const adjustRest = useAppStore(s => s.adjustRest)
  const clearRest = useAppStore(s => s.clearRest)
  const settings = useLiveQuery(() => db.settings.get(1))
  const now = useNow(250)
  const firedFor = useRef<number | null>(null)

  const remainingMs = rest ? rest.endsAt - now : 0
  const done = rest !== null && remainingMs <= 0

  useEffect(() => {
    if (!rest || !done) return
    if (firedFor.current !== rest.endsAt) {
      firedFor.current = rest.endsAt
      if (settings?.soundEnabled) beep()
    }
    const id = setTimeout(clearRest, 4000)
    return () => clearTimeout(id)
  }, [rest, done, settings?.soundEnabled, clearRest])

  if (!rest) return null

  const frac = Math.min(1, Math.max(0, remainingMs / (rest.totalSec * 1000)))

  return (
    <div className="relative border-t border-edge bg-card">
      <div
        className="absolute inset-x-0 top-0 h-0.5 origin-left bg-primary transition-transform duration-200"
        style={{ transform: `scaleX(${frac})` }}
      />
      <div className="mx-auto flex max-w-lg items-center gap-2 px-4 py-2">
        <TimerReset size={20} className={done ? 'text-accent' : 'text-primary'} aria-hidden />
        {done ? (
          <span className="flex-1 font-display text-xl font-semibold text-accent">
            Rest over — go!
          </span>
        ) : (
          <span className="num flex-1 font-display text-2xl font-bold">
            {fmtDuration(remainingMs)}
          </span>
        )}
        <button
          onClick={() => adjustRest(-15)}
          className="num min-h-[44px] rounded-lg bg-muted/40 px-3 font-semibold text-sub active:bg-muted"
        >
          −15s
        </button>
        <button
          onClick={() => adjustRest(15)}
          className="num min-h-[44px] rounded-lg bg-muted/40 px-3 font-semibold text-sub active:bg-muted"
        >
          +15s
        </button>
        <button
          onClick={clearRest}
          aria-label="Skip rest"
          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-sub active:bg-muted"
        >
          <X size={20} />
        </button>
      </div>
    </div>
  )
}
