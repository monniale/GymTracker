import { useState } from 'react'
import { FlaskConical, Loader2 } from 'lucide-react'
import { useUiStore } from '../lib/uiStore'
import { clearDemoData } from '../lib/demoData'
import { t } from '../i18n'

/**
 * Slim "Demo data loaded · Clear" bar shown at the top of WorkoutHome and DietDay while the demo
 * backup (lib/demoData.ts) is what the database holds. Renders nothing otherwise.
 */
export default function DemoBanner() {
  const demoLoaded = useUiStore(s => s.demoLoaded)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!demoLoaded) return null

  async function onClear() {
    if (!window.confirm(t('components.demo.confirm'))) return
    setBusy(true)
    setError(null)
    try {
      await clearDemoData()
    } catch (e) {
      setError(t('components.demo.error', { error: (e as Error).message }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mb-4 rounded-2xl border border-accent/40 bg-accent/10 px-3 py-1.5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          <FlaskConical size={16} className="shrink-0 text-accent" aria-hidden />
          <span className="truncate">{t('components.demo.banner')}</span>
        </p>
        <button
          onClick={() => void onClear()}
          disabled={busy}
          className="flex min-h-[44px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl px-3 text-sm font-semibold text-accent active:bg-accent/20 disabled:opacity-50"
        >
          {busy && <Loader2 size={16} className="animate-spin" />}
          {t('components.demo.clear')}
        </button>
      </div>
      {error && <p className="pb-1 text-xs text-danger">{error}</p>}
    </div>
  )
}
