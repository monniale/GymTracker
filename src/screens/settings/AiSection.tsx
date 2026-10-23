import { useState } from 'react'
import { Sparkles, Loader2, ExternalLink, ShieldAlert, Info } from 'lucide-react'
import { useAiStore } from '../../lib/aiStore'
import { fallbackModels } from '../../lib/gemini'
import {
  AiError, BASE_URL_PRESETS, LOCAL_KEY, PROVIDERS, isLocalBaseUrl, usesServerFallback, type AiModel, type AiProviderId,
} from '../../lib/ai/provider'
import SegmentedControl from '../../components/SegmentedControl'
import { t } from '../../i18n'

/** Not translated: product names, hosts and the key prefixes. */
const AI_STUDIO = 'Google AI Studio'
const KEY_PLACEHOLDER = 'AIza…'
const GEMINI = 'Gemini'
const CLAUDE = 'Claude'
const ANTHROPIC_KEY_PLACEHOLDER = 'sk-ant-…'
const OPENAI_KEY_PLACEHOLDER = 'sk-…'
const URL_PLACEHOLDER = 'https://…/v1'
const MODEL_PLACEHOLDER = 'llama3.2'
const ANTHROPIC_CONSOLE = 'https://platform.claude.com/settings/keys'
const ANTHROPIC_HOST = 'api.anthropic.com'
const PRESET_NAMES: Record<PresetId, string> = {
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
  groq: 'Groq',
  mistral: 'Mistral',
  ollama: 'Ollama',
  lmstudio: 'LM Studio',
  custom: '',
}

/** Above this many models the picker gets a text filter (OpenRouter lists hundreds). */
const FILTER_OVER = 30

type PresetId = (typeof BASE_URL_PRESETS)[number]['id']

const inputCls = 'min-h-[48px] w-full min-w-0 rounded-xl bg-surface px-3 text-base'
const labelCls = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-sub'

function presetLabel(id: PresetId): string {
  if (id === 'custom') return t('settings.ai.presetCustom')
  const p = BASE_URL_PRESETS.find(x => x.id === id)
  return p?.local ? t('settings.ai.presetLocal', { name: PRESET_NAMES[id] }) : PRESET_NAMES[id]
}

function presetFor(url: string): PresetId {
  const clean = url.trim().replace(/\/+$/, '')
  return BASE_URL_PRESETS.find(p => p.id !== 'custom' && p.url === clean)?.id ?? 'custom'
}

/** Host shown in the privacy note and the connected line; the raw text when it is not a URL. */
function hostOf(url: string): string {
  try {
    return new URL(url.trim()).host || url
  } catch {
    return url.trim()
  }
}

function providerLabel(id: AiProviderId): string {
  return id === 'gemini' ? GEMINI : id === 'anthropic' ? CLAUDE : t('settings.ai.providerOpenai')
}

/** Copy for a failed connect: a rejected key gets the friendly line, everything else its own message. */
function connectError(e: unknown): string {
  if (e instanceof AiError && (e.kind === 'auth' || e.kind === 'bad-key')) return t('settings.ai.rejected')
  return (e as Error)?.message || t('components.aiReport.errGeneric')
}

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
  const [filter, setFilter] = useState('')
  const all: AiModel[] = models.length ? models : model ? [{ id: model, label: model }] : []
  const q = filter.trim().toLowerCase()
  // The chosen model always stays in the list, so the select never shows a value it lacks.
  const options = q ? all.filter(m => m.id === model || m.id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q)) : all
  return (
    <div className="space-y-2">
      <label className="block">
        <span className={labelCls}>{t('settings.ai.model')}</span>
        <select value={model} onChange={e => setModel(e.target.value)} className={inputCls}>
          {options.map(m => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      {all.length > FILTER_OVER && (
        <input
          type="search"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder={t('settings.ai.filterModels')}
          aria-label={t('settings.ai.filterModels')}
          className={inputCls}
          autoCapitalize="none"
          autoCorrect="off"
        />
      )}
    </div>
  )
}

/**
 * What a failed call retries on: Gemini's free chain (what `aiRequestOpts` sends), else one retry
 * (plus, on the Claude models that have it, Anthropic's server-side refusal fallback).
 */
function FallbackNote() {
  const provider = useAiStore(s => s.provider)
  const model = useAiStore(s => s.model)
  const models = useAiStore(s => s.models)
  if (provider !== 'gemini') {
    const claudeFallback = provider === 'anthropic' && usesServerFallback(model)
    return <p className="text-xs leading-relaxed text-sub">{t(claudeFallback ? 'settings.ai.fallbackClaude' : 'settings.ai.fallbackSingle')}</p>
  }
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

function PrivacyNote({ provider, baseUrl }: { provider: AiProviderId; baseUrl: string }) {
  // An empty or cleared Base URL names no server: say so rather than naming one the user never chose.
  const host = hostOf(baseUrl)
  const text =
    provider === 'gemini'
      ? t('settings.ai.privacy')
      : provider === 'anthropic'
        ? t('settings.ai.privacyAnthropic')
        : isLocalBaseUrl(baseUrl)
          ? t('settings.ai.privacyLocal')
          : host
            ? t('settings.ai.privacyOpenai', { host })
            : t('settings.ai.privacyCustom')
  return (
    <p className="mt-3 flex items-start gap-1.5 rounded-xl bg-muted/20 p-2.5 text-xs leading-relaxed text-sub">
      <ShieldAlert size={14} className="mt-0.5 shrink-0" />
      <span className="min-w-0 break-words">{text}</span>
    </p>
  )
}

/** Local or custom servers: CORS has to let this app in, and neither the web app nor Android can reach plain http on the LAN. */
function LocalServerHints() {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return (
    <div className="flex items-start gap-1.5 rounded-xl bg-muted/20 p-2.5 text-xs leading-relaxed text-sub">
      <Info size={14} className="mt-0.5 shrink-0" />
      <div className="min-w-0 space-y-1 break-words">
        <p>{t('settings.ai.corsHint', { origin })}</p>
        <p>{t('settings.ai.mixedContent')}</p>
      </div>
    </div>
  )
}

function ConnectedView() {
  const provider = useAiStore(s => s.provider)
  const baseUrl = useAiStore(s => s.baseUrl)
  const clear = useAiStore(s => s.clear)
  function disconnect() {
    if (!window.confirm(t('settings.ai.removeConfirm'))) return
    clear()
  }
  const host = provider === 'openai' ? hostOf(baseUrl) : provider === 'anthropic' ? ANTHROPIC_HOST : ''
  return (
    <div className="space-y-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-accent">{t('settings.ai.connected')}</p>
        <p className="mt-0.5 truncate text-xs text-ink">
          <span className="font-semibold">{providerLabel(provider)}</span>
          {host && <span className="text-sub"> · {host}</span>}
        </p>
        <p className="mt-0.5 text-xs text-sub">{t('settings.ai.connectedHint')}</p>
      </div>
      <ModelSelect />
      <FallbackNote />
      <PrivacyNote provider={provider} baseUrl={baseUrl} />
      <button onClick={disconnect} className="py-2 text-xs font-medium text-danger">
        {t('settings.ai.removeKey')}
      </button>
    </div>
  )
}

function ConnectView() {
  const storedProvider = useAiStore(s => s.provider)
  const [provider, setProvider] = useState<AiProviderId>(storedProvider)
  const options: { value: AiProviderId; label: string }[] = [
    { value: 'gemini', label: GEMINI },
    { value: 'openai', label: t('settings.ai.providerOpenai') },
    { value: 'anthropic', label: CLAUDE },
  ]
  return (
    <div className="space-y-3">
      <SegmentedControl value={provider} options={options} onChange={setProvider} ariaLabel={t('settings.ai.provider')} />
      {provider === 'gemini' && <GeminiConnect />}
      {provider === 'openai' && <OpenAiConnect />}
      {provider === 'anthropic' && <AnthropicConnect />}
    </div>
  )
}

/**
 * Shared connect flow: list the key's models through the provider module (loaded on demand),
 * then store the connection. `onListFailed` lets the OpenAI-compatible form offer a typed model id.
 */
function useConnect(provider: AiProviderId) {
  const connect = useAiStore(s => s.connect)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(key: string, baseUrl: string, noModels: string, onListFailed?: (e: unknown) => void) {
    setBusy(true)
    setError(null)
    try {
      const p = await PROVIDERS[provider]()
      const models = await p.listModels(key, baseUrl || undefined)
      if (models.length === 0) {
        setError(noModels)
        onListFailed?.(new AiError(noModels, 'other'))
        return
      }
      connect(provider, key, models, p.pickDefaultModel(models), baseUrl)
    } catch (e) {
      setError(connectError(e))
      onListFailed?.(e)
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, run, setError }
}

function ConnectButton({ busy, disabled, onClick, label }: { busy: boolean; disabled: boolean; onClick: () => void; label?: string }) {
  return (
    <button
      onClick={onClick}
      disabled={busy || disabled}
      className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-3.5 font-display text-lg font-bold text-bg active:opacity-90 disabled:opacity-40"
    >
      {busy && <Loader2 size={18} className="animate-spin" />} {label ?? t('settings.ai.connect')}
    </button>
  )
}

function KeyInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="block">
      <span className={labelCls}>{label}</span>
      <input
        type="password"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={`num ${inputCls}`}
        autoCapitalize="none"
        autoCorrect="off"
      />
    </label>
  )
}

function GeminiConnect() {
  const [key, setKeyInput] = useState('')
  const { busy, error, run } = useConnect('gemini')
  return (
    <>
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

      <KeyInput label={t('settings.ai.keyLabel')} value={key} onChange={setKeyInput} placeholder={KEY_PLACEHOLDER} />

      <ConnectButton
        busy={busy}
        disabled={key.trim().length < 20}
        onClick={() => run(key.trim(), '', t('settings.ai.noModels'))}
      />

      {error && <p className="text-xs text-danger">{error}</p>}

      <PrivacyNote provider="gemini" baseUrl="" />
    </>
  )
}

function OpenAiConnect() {
  const stored = useAiStore(s => (s.provider === 'openai' ? s.baseUrl : ''))
  const connect = useAiStore(s => s.connect)
  const [preset, setPreset] = useState<PresetId>(stored ? presetFor(stored) : 'openai')
  const [url, setUrl] = useState(stored || BASE_URL_PRESETS[0].url)
  const [key, setKeyInput] = useState('')
  const [manual, setManual] = useState<string | null>(null)
  const { busy, error, run, setError } = useConnect('openai')

  const local = isLocalBaseUrl(url)
  const effectiveKey = key.trim() || (local ? LOCAL_KEY : '')
  const showHints = preset === 'custom' || BASE_URL_PRESETS.some(p => p.id === preset && p.local) || local

  function choosePreset(id: PresetId) {
    setPreset(id)
    const p = BASE_URL_PRESETS.find(x => x.id === id)
    if (p && id !== 'custom') setUrl(p.url)
    setManual(null)
    setError(null)
  }

  function onConnect() {
    setManual(null)
    // A model list that fails for any reason but a rejected key: let the user type the model id.
    run(effectiveKey, url.trim(), t('settings.ai.noModelsOther'), e => {
      if (!(e instanceof AiError && (e.kind === 'auth' || e.kind === 'bad-key'))) setManual('')
    })
  }

  function connectManual() {
    const id = (manual ?? '').trim()
    if (!id) return
    connect('openai', effectiveKey, [{ id, label: id }], id, url.trim())
  }

  return (
    <>
      <label className="block">
        <span className={labelCls}>{t('settings.ai.preset')}</span>
        <select value={preset} onChange={e => choosePreset(e.target.value as PresetId)} className={inputCls}>
          {BASE_URL_PRESETS.map(p => (
            <option key={p.id} value={p.id}>
              {presetLabel(p.id)}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className={labelCls}>{t('settings.ai.baseUrl')}</span>
        <input
          type="url"
          value={url}
          onChange={e => {
            setUrl(e.target.value)
            setPreset(presetFor(e.target.value))
            setManual(null)
          }}
          placeholder={URL_PLACEHOLDER}
          className={`num ${inputCls}`}
          autoCapitalize="none"
          autoCorrect="off"
          inputMode="url"
        />
      </label>

      <KeyInput
        label={local ? t('settings.ai.keyOptional') : t('settings.ai.openaiKeyLabel')}
        value={key}
        onChange={v => {
          setKeyInput(v)
          setManual(null)
        }}
        placeholder={OPENAI_KEY_PLACEHOLDER}
      />

      <ConnectButton busy={busy} disabled={!url.trim() || !effectiveKey} onClick={onConnect} />

      {error && <p className="break-words text-xs text-danger">{error}</p>}

      {manual !== null && (
        <div className="space-y-2">
          <p className="text-xs leading-relaxed text-sub">{t('settings.ai.manualModelHint')}</p>
          <label className="block">
            <span className={labelCls}>{t('settings.ai.manualModel')}</span>
            <input
              type="text"
              value={manual}
              onChange={e => setManual(e.target.value)}
              placeholder={MODEL_PLACEHOLDER}
              className={`num ${inputCls}`}
              autoCapitalize="none"
              autoCorrect="off"
            />
          </label>
          <button
            onClick={connectManual}
            disabled={!manual.trim()}
            className="w-full rounded-2xl border border-primary py-3 text-sm font-semibold text-primary active:opacity-80 disabled:opacity-40"
          >
            {t('settings.ai.useModel')}
          </button>
        </div>
      )}

      {showHints && <LocalServerHints />}

      <PrivacyNote provider="openai" baseUrl={url} />
    </>
  )
}

function AnthropicConnect() {
  const [key, setKeyInput] = useState('')
  const { busy, error, run } = useConnect('anthropic')
  return (
    <>
      <p className="text-xs leading-relaxed text-sub">
        {t('settings.ai.consoleBefore')}{' '}
        <a href={ANTHROPIC_CONSOLE} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-primary">
          {t('settings.ai.consoleLink')} <ExternalLink size={11} />
        </a>{' '}
        {t('settings.ai.consoleAfter')}
      </p>

      <KeyInput label={t('settings.ai.anthropicKeyLabel')} value={key} onChange={setKeyInput} placeholder={ANTHROPIC_KEY_PLACEHOLDER} />

      <ConnectButton
        busy={busy}
        disabled={key.trim().length < 20}
        onClick={() => run(key.trim(), '', t('settings.ai.noModelsOther'))}
      />

      {error && <p className="break-words text-xs text-danger">{error}</p>}

      <PrivacyNote provider="anthropic" baseUrl="" />
    </>
  )
}
