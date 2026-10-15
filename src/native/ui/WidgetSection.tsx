import { useEffect, useState } from 'react'
import { LayoutGrid } from 'lucide-react'
import { getWidgetStatus, pushWidgetState, requestWidgetPin } from '../widget'

/** Settings › Home-screen widget (Android): how many are placed, and "Add to home screen". */
export default function WidgetSection() {
  const [status, setStatus] = useState<{ widgets: number; updatedAt: number } | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  async function refresh() {
    setStatus(await getWidgetStatus())
  }

  useEffect(() => {
    void refresh()
    const onResume = () => void refresh()
    window.addEventListener('gt:resume', onResume)
    return () => window.removeEventListener('gt:resume', onResume)
  }, [])

  async function add() {
    await pushWidgetState() // so the new widget starts with today's numbers
    const ok = await requestWidgetPin()
    setMsg(ok
      ? 'Confirm on the home screen to place it.'
      : 'Your launcher can’t add it from here: long-press the home screen › Widgets › GymTracker.')
  }

  const placed = status?.widgets ?? 0
  return (
    <section className="mb-4 rounded-2xl border border-edge bg-card p-4">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-sub">Home-screen widget</h2>
      <p className="text-sm text-sub">
        Rank, points, streak, this week’s workouts and the next one. It refreshes whenever GymTracker is open.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          onClick={() => void add()}
          className="flex min-h-[44px] items-center gap-2 whitespace-nowrap rounded-xl bg-muted/40 px-4 font-semibold active:bg-muted"
        >
          <LayoutGrid size={18} aria-hidden /> Add to home screen
        </button>
        <span className="text-xs text-sub">{placed === 0 ? 'Not placed yet' : `${placed} placed`}</span>
      </div>
      {msg && <p className="mt-2 text-xs text-sub">{msg}</p>}
    </section>
  )
}
