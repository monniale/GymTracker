import { useState } from 'react'
import { Sparkles, Loader2, ExternalLink, ShieldAlert } from 'lucide-react'
import { useAiStore } from '../../lib/aiStore'
import { listModels, pickDefaultModel, fallbackModels, GeminiError } from '../../lib/gemini'
import { t } from '../../i18n'

/** Not translated: Google's product name and the key prefix. */
const AI_STUDIO = 'Google AI Studio'
const KEY_PLACEHOLDER = 'AIza…'

export default function AiSection() {
  const connected = !!useAiStore(s => s.apiKey)
  return (
    <section className="mb-4 rounded-2xl border border-edge bg-card p-4">
      <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-sub">
        <Sparkles size={14} className={connected ? 'text-accent' : ''} /> {t('settings.ai.title')}
      </h2>
      {connected ? <ConnectedView /> : <ConnectView />}
    </section>
  )
}

function ModelSelect() {
  const model = useAiStore(s => s.model)
  const models = useAiStore(s => s.models)
  const setModel = useAiStore(s => s.setModel)
  const options = models.length ? models : model ? [{ id: model, label: model }] : []
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-sub">{t('settings.ai.model')}</span>
      <select
        value={model}
        onChange={e => setModel(e.target.value)}
        className="min-h-[48px] w-full rounded-xl bg-surface px-3 text-base"
      >
        {options.map(m => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
    </label>
  )
}

/** Which free models a failed call retries on (the chain `aiRequestOpts` sends). */
function FallbackNote() {
  const model = useAiStore(s => s.model)
  const models = useAiStore(s => s.models)
  const chain = fallbackModels(models, model)
  if (chain.length === 0) return null
  const label = (id: string) => models.find(m => m.id === id)?.label ?? id
  return (
    <p className="text-xs leading-relaxed text-sub">
      {t('settings.ai.fallbackBefore')}{' '}
      {chain.map((id, i) => (
        <span key={id}>
          {i > 0 && (i === chain.length - 1 ? t('settings.ai.fallbackAndThen') : t('settings.ai.fallbackThen'))}
          <span className="font-semibold text-ink">{label(id)}</span>
        </span>
      ))}{' '}
      {t('settings.ai.fallbackAfter')}
    </p>
  )
}

function PrivacyNote() {
  return (
    <p className="mt-3 flex items-start gap-1.5 rounded-xl bg-muted/20 p-2.5 text-xs leading-relaxed text-sub">
      <ShieldAlert size={14} className="mt-0.5 shrink-0" />
      <span>{t('settings.ai.privacy')}</span>
    </p>
  )
}

function ConnectedView() {
  const clear = useAiStore(s => s.clear)
  function disconnect() {
    if (!window.confirm(t('settings.ai.removeConfirm'))) return
    clear()
  }
  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold text-accent">{t('settings.ai.connected')}</p>
        <p className="mt-0.5 text-xs text-sub">
          {t('settings.ai.connectedHint')}
        </p>
      </div>
      <ModelSelect />
      <FallbackNote />
      <PrivacyNote />
      <button onClick={disconnect} className="py-2 text-xs font-medium text-danger">
        {t('settings.ai.removeKey')}
      </button>
    </div>
  )
}

function ConnectView() {
  const connect = useAiStore(s => s.connect)
  const [key, setKeyInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onConnect() {
    setBusy(true)
    setError(null)
    try {
      const models = await listModels(key.trim())
      if (models.length === 0) {
        setError(t('settings.ai.noModels'))
        return
      }
      connect(key.trim(), models, pickDefaultModel(models))
    } catch (e) {
      setError(
        e instanceof GeminiError && (e.kind === 'auth' || e.kind === 'bad-key')
          ? t('settings.ai.rejected')
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
          {t('settings.ai.step1Before')}{' '}
          <a
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 text-primary"
          >
            {AI_STUDIO} <ExternalLink size={11} />
          </a>{' '}
          {t('settings.ai.step1After')}
        </li>
        <li>{t('settings.ai.step2')}</li>
        <li>{t('settings.ai.step3')}</li>
      </ol>

      <label className="block">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-sub">{t('settings.ai.keyLabel')}</span>
        <input
          type="password"
          value={key}
          onChange={e => setKeyInput(e.target.value)}
          placeholder={KEY_PLACEHOLDER}
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
        {busy && <Loader2 size={18} className="animate-spin" />} {t('settings.ai.connect')}
      </button>

      {error && <p className="text-xs text-danger">{error}</p>}

      <PrivacyNote />
    </div>
  )
}
