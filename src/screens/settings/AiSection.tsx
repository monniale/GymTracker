import { useState } from 'react'
import { Sparkles, Loader2, ExternalLink, ShieldAlert } from 'lucide-react'
import { useAiStore, AI_MODELS } from '../../lib/aiStore'
import { validateKey, GeminiError } from '../../lib/gemini'

export default function AiSection() {
  const connected = !!useAiStore(s => s.apiKey)
  return (
    <section className="mb-4 rounded-2xl border border-edge bg-card p-4">
      <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-sub">
        <Sparkles size={14} className={connected ? 'text-accent' : ''} /> AI Coach
      </h2>
      {connected ? <ConnectedView /> : <ConnectView />}
    </section>
  )
}

function ModelSelect() {
  const model = useAiStore(s => s.model)
  const setModel = useAiStore(s => s.setModel)
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-sub">Model</span>
      <select
        value={model}
        onChange={e => setModel(e.target.value)}
        className="min-h-[48px] w-full rounded-xl bg-surface px-3 text-base"
      >
        {AI_MODELS.map(m => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function PrivacyNote() {
  return (
    <p className="mt-3 flex items-start gap-1.5 rounded-xl bg-muted/20 p-2.5 text-xs leading-relaxed text-sub">
      <ShieldAlert size={14} className="mt-0.5 shrink-0" />
      <span>
        Your workout stats (exercises, weights, reps, bodyweight) are sent to Google to write the note.
        On the free tier Google may use this data to improve their models. The key stays on this device
        only and is never synced.
      </span>
    </p>
  )
}

function ConnectedView() {
  const clear = useAiStore(s => s.clear)
  function disconnect() {
    if (!window.confirm('Remove the Gemini key from this device? Cached coach notes stay.')) return
    clear()
  }
  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold text-accent">Connected</p>
        <p className="mt-0.5 text-xs text-sub">A coaching note is generated when you finish a workout.</p>
      </div>
      <ModelSelect />
      <PrivacyNote />
      <button onClick={disconnect} className="py-2 text-xs font-medium text-danger">
        Remove key
      </button>
    </div>
  )
}

function ConnectView() {
  const setKey = useAiStore(s => s.setKey)
  const model = useAiStore(s => s.model)
  const [key, setKeyInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onConnect() {
    setBusy(true)
    setError(null)
    try {
      await validateKey(key.trim(), model)
      setKey(key.trim())
    } catch (e) {
      setError(
        e instanceof GeminiError && (e.kind === 'auth' || e.kind === 'bad-key')
          ? 'That key was rejected. Check you copied it correctly.'
          : (e as Error).message,
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <ol className="list-inside list-decimal space-y-1 text-xs leading-relaxed text-sub">
        <li>
          Open{' '}
          <a
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 text-primary"
          >
            Google AI Studio <ExternalLink size={11} />
          </a>{' '}
          and sign in with a Google account (free, no card).
        </li>
        <li>Click “Create API key”, then copy it.</li>
        <li>Paste it below (it stays on this device only).</li>
      </ol>

      <ModelSelect />

      <label className="block">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-sub">Gemini API key</span>
        <input
          type="password"
          value={key}
          onChange={e => setKeyInput(e.target.value)}
          placeholder="AIza…"
          className="num min-h-[48px] w-full rounded-xl bg-surface px-3 text-base"
          autoCapitalize="none"
          autoCorrect="off"
        />
      </label>

      <button
        onClick={onConnect}
        disabled={busy || key.trim().length < 20}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-3.5 font-display text-lg font-bold text-bg active:opacity-90 disabled:opacity-40"
      >
        {busy && <Loader2 size={18} className="animate-spin" />} Connect
      </button>

      {error && <p className="text-xs text-danger">{error}</p>}

      <PrivacyNote />
    </div>
  )
}
