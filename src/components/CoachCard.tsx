import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Sparkles, Loader2, RefreshCw, AlertTriangle, WifiOff } from 'lucide-react'
import { db, withSyncTrackingSuspended } from '../db/db'
import { useAiStore } from '../lib/aiStore'
import { gatherWorkoutBriefing, formatBriefing } from '../lib/coachBriefing'
import { generateCoachNote, GeminiError } from '../lib/gemini'
import type { CoachInsightTone, CoachNote, Id } from '../types'

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
      case 'blocked': return 'Gemini couldn’t generate a note for this session.'
      default: return e.message || 'Coaching failed — try again.'
    }
  }
  return (e as Error)?.message || 'Coaching failed — try again.'
}

const shell = 'mt-4 rounded-2xl border border-edge bg-card p-4 text-left'

export default function CoachCard({ sessionId }: { sessionId: Id }) {
  const apiKey = useAiStore(s => s.apiKey)
  // undefined = cache still loading; null = loaded, no note; row = cached note.
  const cached = useLiveQuery(
    async () => (await db.coachNotes.get(sessionId)) ?? null,
    [sessionId],
  )
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const [online, setOnline] = useState(() => navigator.onLine)
  const generatingRef = useRef(false)
  const attemptedRef = useRef<Id | null>(null)

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

  // Reset per-session UI state when navigating between summaries.
  useEffect(() => {
    setStatus('idle')
    setError(null)
    attemptedRef.current = null
  }, [sessionId])

  async function generate() {
    if (generatingRef.current) return
    const key = useAiStore.getState().apiKey
    const model = useAiStore.getState().model
    if (!key || !navigator.onLine) return
    generatingRef.current = true
    setStatus('loading')
    setError(null)
    try {
      const briefing = await gatherWorkoutBriefing(sessionId)
      if (!briefing) {
        setStatus('idle')
        return
      }
      const note = await generateCoachNote(formatBriefing(briefing), { apiKey: key, model })
      await withSyncTrackingSuspended(() =>
        db.coachNotes.put({ sessionId, note, model, generatedAt: Date.now() }),
      )
      setStatus('idle')
    } catch (e) {
      setError(errMsg(e))
      setStatus('error')
    } finally {
      generatingRef.current = false
    }
  }

  // Auto-generate once per session when a note is missing and generation is possible.
  useEffect(() => {
    if (cached === undefined) return // cache still loading
    if (cached) return // already have a note
    if (!apiKey || !online) return
    if (attemptedRef.current === sessionId) return
    attemptedRef.current = sessionId
    void generate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cached, apiKey, online, sessionId])

  const canGenerate = !!apiKey && online && status !== 'loading'

  if (cached) {
    return <NoteView note={cached.note} onRegenerate={canGenerate ? generate : undefined} busy={status === 'loading'} />
  }
  if (status === 'loading') return <LoadingView />
  if (status === 'error') {
    return (
      <div className={shell}>
        <Header />
        <p className="mt-2 flex items-start gap-1.5 text-sm text-danger">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {error}
        </p>
        {canGenerate && <RegenButton onClick={generate} label="Try again" />}
      </div>
    )
  }
  if (!apiKey) {
    return (
      <div className={shell}>
        <Header />
        <p className="mt-2 text-sm text-sub">
          Get an AI coaching note on every workout.{' '}
          <Link to="/settings" className="font-semibold text-primary">
            Add a free Gemini key
          </Link>{' '}
          in Settings.
        </p>
      </div>
    )
  }
  if (!online) {
    return (
      <div className={shell}>
        <Header />
        <p className="mt-2 flex items-center gap-1.5 text-sm text-sub">
          <WifiOff size={16} className="shrink-0" /> Offline — your coach note will generate when you reconnect.
        </p>
      </div>
    )
  }
  return <LoadingView />
}

function Header() {
  return (
    <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-sub">
      <Sparkles size={16} className="text-primary" /> Coach’s note
    </p>
  )
}

function LoadingView() {
  return (
    <div className={shell}>
      <Header />
      <p className="mt-2 flex items-center gap-2 text-sm text-sub">
        <Loader2 size={16} className="animate-spin" /> Reviewing your session…
      </p>
    </div>
  )
}

function RegenButton({ onClick, label = 'Regenerate' }: { onClick: () => void; label?: string }) {
  return (
    <button
      onClick={() => void onClick()}
      className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-sub active:text-ink"
    >
      <RefreshCw size={13} /> {label}
    </button>
  )
}

function NoteView({
  note,
  onRegenerate,
  busy,
}: {
  note: CoachNote
  onRegenerate?: () => void
  busy: boolean
}) {
  return (
    <div className={shell}>
      <div className="flex items-start justify-between gap-2">
        <Header />
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
      {onRegenerate && !busy && <RegenButton onClick={onRegenerate} />}
    </div>
  )
}
