import { useState } from 'react'
import { Cloud, CloudOff, RefreshCw, Loader2, ExternalLink, AlertTriangle, FlaskConical } from 'lucide-react'
import { useSyncStore, syncNow, previewConnection, connect, type ConnectPreview, type BootstrapChoice } from '../../lib/sync'
import { fmtDateTime } from '../../lib/dates'
import { useUiStore } from '../../lib/uiStore'
import { useCloudStore } from '../../lib/cloudSync'
import { cloudConfigured } from '../../lib/supabaseConfig'
import Sheet from '../../components/Sheet'
import { t, tp } from '../../i18n'

/** Not translated: the suggested repo name and GitHub's own link labels. */
const DEFAULT_REPO = 'gymtracker-data'
const NEW_REPO_LINK = 'github.com/new'
const TOKENS_LINK = 'settings/tokens'
const TOKEN_PLACEHOLDER = 'github_pat_…'

export default function SyncSection() {
  const store = useSyncStore()
  const connected = !!store.token && !!store.repo
  // Demo data must never reach a sync repo: lib/sync.ts refuses too, this only explains why.
  const demoLoaded = useUiStore(s => s.demoLoaded)

  return (
    <section className="mb-4 rounded-2xl border border-edge bg-card p-4">
      <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-sub">
        {connected ? <Cloud size={14} className="text-accent" /> : <CloudOff size={14} />}
        {t('settings.sync.title')}
      </h2>
      {connected && <ConnectedView demoLoaded={demoLoaded} />}
      {!connected && (demoLoaded ? <DemoNotice /> : <ConnectView />)}
    </section>
  )
}

function DemoNotice({ connected = false }: { connected?: boolean }) {
  return (
    <p className="flex items-start gap-1.5 text-sm text-sub">
      <FlaskConical size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden />
      {t(connected ? 'settings.sync.demoNoticeConnected' : 'settings.sync.demoNotice')}
    </p>
  )
}

function ConnectedView({ demoLoaded }: { demoLoaded: boolean }) {
  const store = useSyncStore()
  const cloudOn = useCloudStore(s => s.session !== null) && cloudConfigured()

  async function disconnect() {
    if (!window.confirm(t('settings.sync.disconnectConfirm'))) return
    store.disconnect()
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">
            {store.owner}/{store.repo}
          </p>
          <p className="truncate text-xs text-sub">
            {demoLoaded
              ? t('settings.sync.demoPaused')
              : store.syncing
                ? t('settings.sync.syncing')
                : store.lastSyncAt
                  ? t('settings.sync.lastSync', { time: fmtDateTime(store.lastSyncAt) })
                  : t('settings.sync.never')}
          </p>
        </div>
        <button
          onClick={() => void syncNow('manual')}
          disabled={store.syncing || demoLoaded}
          className="flex min-h-[44px] shrink-0 items-center gap-2 whitespace-nowrap rounded-xl bg-primary/15 px-4 text-sm font-semibold text-primary active:bg-primary/30 disabled:opacity-50"
        >
          {store.syncing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          {t('settings.sync.syncNow')}
        </button>
      </div>
      {demoLoaded && (
        <div className="mt-2">
          <DemoNotice connected />
        </div>
      )}
      {store.lastError && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-danger">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {store.lastError}
        </p>
      )}
      <p className="mt-2 text-xs text-sub">
        {cloudOn ? t('settings.cloud.githubBackup') : t('settings.sync.auto')}{' '}
        <span className="num">{store.deviceId.slice(0, 8)}</span>
      </p>
      <button onClick={disconnect} className="mt-1 py-2 text-xs font-medium text-danger">
        {t('settings.sync.disconnect')}
      </button>
    </div>
  )
}

function ConnectView() {
  const [repo, setRepo] = useState(DEFAULT_REPO)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<ConnectPreview | null>(null)

  async function onConnect() {
    setBusy(true)
    setError(null)
    try {
      const p = await previewConnection(token.trim(), repo.trim())
      if (!p.repoPrivate) {
        setError(t('settings.sync.publicRepo', { repo: `${p.owner}/${repo.trim()}` }))
        return
      }
      if (p.remoteExists && p.localMeaningful) {
        setPreview(p) // both sides have data -> ask
        return
      }
      await finish(p.remoteExists ? 'use-remote' : 'overwrite-remote')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function finish(choice: BootstrapChoice) {
    setBusy(true)
    setError(null)
    try {
      const outcome = await connect(token.trim(), repo.trim(), choice)
      if (outcome === 'error') {
        setError(useSyncStore.getState().lastError ?? t('settings.sync.failed'))
        useSyncStore.getState().disconnect()
      }
      setPreview(null)
    } catch (e) {
      setError((e as Error).message)
      useSyncStore.getState().disconnect()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <ol className="list-inside list-decimal space-y-1 text-xs leading-relaxed text-sub">
        <li>
          {t('settings.sync.step1Before')} <b className="text-ink">{t('settings.sync.step1Private')}</b>{' '}
          {t('settings.sync.step1After')} <span className="num">{DEFAULT_REPO}</span>{' '}
          <a
            href="https://github.com/new?name=gymtracker-data&visibility=private"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 text-primary"
          >
            {NEW_REPO_LINK} <ExternalLink size={11} />
          </a>
        </li>
        <li>
          {t('settings.sync.step2Before')}{' '}
          <a
            href="https://github.com/settings/personal-access-tokens/new"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 text-primary"
          >
            {TOKENS_LINK} <ExternalLink size={11} />
          </a>
          {t('settings.sync.step2Repos')} <span className="num">{DEFAULT_REPO}</span>
          {t('settings.sync.step2Permission')} <b className="text-ink">{t('settings.sync.step2Contents')}</b>
          {t('settings.sync.step2After')}
        </li>
        <li>{t('settings.sync.step3')}</li>
      </ol>

      <label className="block">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-sub">{t('settings.sync.repoName')}</span>
        <input
          value={repo}
          onChange={e => setRepo(e.target.value)}
          className="num min-h-[48px] w-full rounded-xl bg-surface px-3 text-base"
          autoCapitalize="none"
          autoCorrect="off"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-sub">{t('settings.sync.token')}</span>
        <input
          type="password"
          value={token}
          onChange={e => setToken(e.target.value)}
          placeholder={TOKEN_PLACEHOLDER}
          className="num min-h-[48px] w-full rounded-xl bg-surface px-3 text-base"
          autoCapitalize="none"
          autoCorrect="off"
        />
      </label>

      <button
        onClick={onConnect}
        disabled={busy || token.trim().length < 20 || repo.trim().length === 0}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-3.5 font-display text-lg font-bold text-bg active:opacity-90 disabled:opacity-40"
      >
        {busy && <Loader2 size={18} className="animate-spin" />} {t('settings.sync.connect')}
      </button>

      {error && <p className="text-xs text-danger">{error}</p>}

      {preview && (
        <Sheet open onClose={() => setPreview(null)} title={t('settings.sync.conflictTitle')}>
          <p className="mb-3 text-sm text-sub">
            {preview.remoteSummary && preview.remoteSummary.exportedAt > 0
              ? t('settings.sync.conflictBodySummary', {
                  sessions: tp('settings.sync.sessions', preview.remoteSummary.sessions),
                  foodLogs: tp('settings.sync.foodLogs', preview.remoteSummary.foodLogs),
                  date: fmtDateTime(preview.remoteSummary.exportedAt),
                })
              : t('settings.sync.conflictBody')}
          </p>
          <div className="space-y-2">
            <button
              onClick={() => finish('merge')}
              className="w-full rounded-2xl bg-primary py-3.5 font-display text-lg font-bold text-bg active:opacity-90"
            >
              {t('settings.sync.merge')}
            </button>
            <button
              onClick={() => finish('use-remote')}
              className="w-full rounded-2xl bg-muted/40 py-3.5 font-display text-lg font-bold active:bg-muted"
            >
              {t('settings.sync.useRemote')}
            </button>
            <button
              onClick={() => finish('overwrite-remote')}
              className="w-full rounded-2xl border border-danger/40 py-3 font-display text-base font-bold text-danger active:bg-danger/10"
            >
              {t('settings.sync.overwriteRemote')}
            </button>
          </div>
        </Sheet>
      )}
    </div>
  )
}
