import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Sparkles, Loader2, RefreshCw, AlertTriangle, WifiOff } from 'lucide-react'
import { useAiStore } from '../lib/aiStore'
import { GeminiError } from '../lib/gemini'
import type { CoachInsightTone, CoachNote } from '../types'

type Status = 'idle' | 'loading' | 'error'

function toneColor(t: CoachInsightTone): string {
  switch (t) {
    case 'celebratory': return 'text-primary'
    case 'positive': return 'text-accent'
    case 'warning': return 'text-danger'
    default: return 'text-ink'
  }
}
function toneDot(t: CoachInsightTone): string {
  switch (t) {
    case 'celebratory': return 'bg-primary'
    case 'positive': return 'bg-accent'
    case 'warning': return 'bg-danger'
    default: return 'bg-muted'
  }
}

function errMsg(e: unknown): string {
  if (e instanceof GeminiError) {
    switch (e.kind) {
      case 'auth':
      case 'bad-key': return 'Gemini key rejected — update it in Settings.'
      case 'rate-limit': return 'Daily free limit reached — try again later.'
      case 'network': return 'Network error — check your connection.'
      case 'blocked': return 'Gemini couldn’t generate a note — try again.'
      default: return e.message || 'Generation failed — try again.'
    }
  }
  return (e as Error)?.message || 'Generation failed — try again.'
}

const shell = 'mt-4 rounded-2xl border border-edge bg-card p-4 text-left'

export interface AiReportCardProps {
  title: string
  /** Resets per-report UI state (and re-arms one auto-generate) when it changes. */
  resetKey: string | number
  /** undefined = cache still loading; null = no cached note; CoachNote = cached. */
  cachedNote: CoachNote | null | undefined
  /** Fetch a fresh note (gather briefing + call Gemini). */
  generate: () => Promise<CoachNote>
  /** Persist the generated note (device-local cache). */
  save: (note: CoachNote) => Promise<void>
  /** true → generate automatically on first view (finished workout); false → manual button (diet day). */
  autoGenerate: boolean
  /** Gate generation (e.g. a diet day with no logged food). Default true. */
  canGenerate?: boolean
  /** Shown when no key is set. */
  noKeyHint: ReactNode
  /** Label for the manual generate button. */
  generateLabel?: string
  /** Shown when generation isn't possible yet (no key path excluded). */
  emptyHint?: ReactNode
}

export default function AiReportCard({
  title,
  resetKey,
  cachedNote,
  generate,
  save,
  autoGenerate,
  canGenerate = true,
  noKeyHint,
  generateLabel = 'Generate report',
  emptyHint,
}: AiReportCardProps) {
  const apiKey = useAiStore(s => s.apiKey)
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const [online, setOnline] = useState(() => navigator.onLine)
  const generatingRef = useRef(false)
  const attemptedRef = useRef<string | number | null>(null)

  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  // Reset per-report state when the target changes.
  useEffect(() => {
    setStatus('idle')
    setError(null)
    attemptedRef.current = null
  }, [resetKey])

  async function run() {
    if (generatingRef.current) return
    if (!useAiStore.getState().apiKey || !navigator.onLine || !canGenerate) return
    generatingRef.current = true
    setStatus('loading')
    setError(null)
    try {
      const note = await generate()
      await save(note)
      setStatus('idle')
    } catch (e) {
      setError(errMsg(e))
      setStatus('error')
    } finally {
      generatingRef.current = false
    }
  }

  // Auto-generate once per target when enabled and possible.
  useEffect(() => {
    if (!autoGenerate) return
    if (cachedNote === undefined) return // cache still loading
    if (cachedNote) return // already have a note
    if (!apiKey || !online || !canGenerate) return
    if (attemptedRef.current === resetKey) return
    attemptedRef.current = resetKey
    void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoGenerate, cachedNote, apiKey, online, canGenerate, resetKey])

  const canRun = !!apiKey && online && status !== 'loading' && canGenerate

  if (cachedNote) {
    return <NoteView title={title} note={cachedNote} onRegenerate={canRun ? run : undefined} busy={status === 'loading'} />
  }
  // Cache still loading (undefined) — never expose the manual Generate button
  // here, or a tap would fire a wasted call and clobber the note about to load.
  if (cachedNote === undefined) return <LoadingView title={title} />
  if (status === 'loading') return <LoadingView title={title} />
  if (status === 'error') {
    return (
      <div className={shell}>
        <Header title={title} />
        <p className="mt-2 flex items-start gap-1.5 text-sm text-danger">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {error}
        </p>
        {canRun && <ActionButton onClick={run} icon={<RefreshCw size={14} />} label="Try again" />}
      </div>
    )
  }
  if (!apiKey) {
    return (
      <div className={shell}>
        <Header title={title} />
        <p className="mt-2 text-sm text-sub">{noKeyHint}</p>
      </div>
    )
  }
  if (!online) {
    return (
      <div className={shell}>
        <Header title={title} />
        <p className="mt-2 flex items-center gap-1.5 text-sm text-sub">
          <WifiOff size={16} className="shrink-0" /> Offline — connect to generate.
        </p>
      </div>
    )
  }
  if (!canGenerate) {
    if (!emptyHint) return null
    return (
      <div className={shell}>
        <Header title={title} />
        <p className="mt-2 text-sm text-sub">{emptyHint}</p>
      </div>
    )
  }
  if (autoGenerate) return <LoadingView title={title} />
  // Manual mode, ready to generate.
  return (
    <div className={shell}>
      <Header title={title} />
      <ActionButton onClick={run} icon={<Sparkles size={15} />} label={generateLabel} primary />
    </div>
  )
}

function Header({ title }: { title: string }) {
  return (
    <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-sub">
      <Sparkles size={16} className="text-primary" /> {title}
    </p>
  )
}

function LoadingView({ title }: { title: string }) {
  return (
    <div className={shell}>
      <Header title={title} />
      <p className="mt-2 flex items-center gap-2 text-sm text-sub">
        <Loader2 size={16} className="animate-spin" /> Reviewing…
      </p>
    </div>
  )
}

function ActionButton({
  onClick,
  icon,
  label,
  primary,
}: {
  onClick: () => void
  icon: ReactNode
  label: string
  primary?: boolean
}) {
  if (primary) {
    return (
      <button
        onClick={() => void onClick()}
        className="mt-3 flex items-center gap-1.5 rounded-xl bg-primary/15 px-3 py-2 text-sm font-semibold text-primary active:bg-primary/30"
      >
        {icon} {label}
      </button>
    )
  }
  return (
    <button
      onClick={() => void onClick()}
      className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-sub active:text-ink"
    >
      {icon} {label}
    </button>
  )
}

function NoteView({
  title,
  note,
  onRegenerate,
  busy,
}: {
  title: string
  note: CoachNote
  onRegenerate?: () => void
  busy: boolean
}) {
  return (
    <div className={shell}>
      <div className="flex items-start justify-between gap-2">
        <Header title={title} />
        {busy && <Loader2 size={15} className="mt-0.5 shrink-0 animate-spin text-sub" />}
      </div>
      <p className={`mt-2 font-display text-lg font-semibold ${toneColor(note.tone)}`}>{note.headline}</p>
      <ul className="mt-2 space-y-1.5">
        {note.insights.map((ins, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${toneDot(ins.tone)}`} />
            <span>{ins.message}</span>
          </li>
        ))}
      </ul>
      {onRegenerate && !busy && (
        <ActionButton onClick={onRegenerate} icon={<RefreshCw size={13} />} label="Regenerate" />
      )}
    </div>
  )
}
