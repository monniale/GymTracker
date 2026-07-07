import { useState } from 'react'
import { Cloud, CloudOff, RefreshCw, Loader2, ExternalLink, AlertTriangle } from 'lucide-react'
import { useSyncStore, syncNow, previewConnection, connect, type ConnectPreview, type BootstrapChoice } from '../../lib/sync'
import { fmtDateTime } from '../../lib/dates'
import Sheet from '../../components/Sheet'

export default function SyncSection() {
  const store = useSyncStore()
  const connected = !!store.token && !!store.repo

  return (
    <section className="mb-4 rounded-2xl border border-edge bg-card p-4">
      <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-sub">
        {connected ? <Cloud size={14} className="text-accent" /> : <CloudOff size={14} />}
        GitHub Sync
      </h2>
      {connected ? <ConnectedView /> : <ConnectView />}
    </section>
  )
}

function ConnectedView() {
  const store = useSyncStore()

  async function disconnect() {
    if (!window.confirm('Disconnect sync? Data stays on this device and on GitHub; only the link is removed.')) return
    store.disconnect()
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">
            {store.owner}/{store.repo}
          </p>
          <p className="text-xs text-sub">
            {store.syncing
              ? 'Syncing…'
              : store.lastSyncAt
                ? `Last sync: ${fmtDateTime(store.lastSyncAt)}`
                : 'Not synced yet'}
          </p>
        </div>
        <button
          onClick={() => void syncNow('manual')}
          disabled={store.syncing}
          className="flex min-h-[44px] items-center gap-2 rounded-xl bg-primary/15 px-4 text-sm font-semibold text-primary active:bg-primary/30 disabled:opacity-50"
        >
          {store.syncing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          Sync now
        </button>
      </div>
      {store.lastError && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-danger">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {store.lastError}
        </p>
      )}
      <p className="mt-2 text-xs text-sub">
        Backs up automatically a few seconds after changes and on every app open. Device ID:{' '}
        <span className="num">{store.deviceId.slice(0, 8)}</span>
      </p>
      <button onClick={disconnect} className="mt-1 py-2 text-xs font-medium text-danger">
        Disconnect
      </button>
    </div>
  )
}

function ConnectView() {
  const [repo, setRepo] = useState('gymtracker-data')
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
        setError(`⚠ ${p.owner}/${repo.trim()} is PUBLIC — your health data would be readable by anyone. Make it private first (repo Settings → Danger zone → Change visibility).`)
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
        setError(useSyncStore.getState().lastError ?? 'Sync failed')
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
          Create a <b className="text-ink">private</b> repo named <span className="num">gymtracker-data</span>{' '}
          <a
            href="https://github.com/new?name=gymtracker-data&visibility=private"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 text-primary"
          >
            github.com/new <ExternalLink size={11} />
          </a>
        </li>
        <li>
          Create a fine-grained token —{' '}
          <a
            href="https://github.com/settings/personal-access-tokens/new"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 text-primary"
          >
            settings/tokens <ExternalLink size={11} />
          </a>
          : Only select repositories → <span className="num">gymtracker-data</span>, permission{' '}
          <b className="text-ink">Contents: Read and write</b>, expiration “No expiration”.
        </li>
        <li>Paste the token below (it stays on this device only).</li>
      </ol>

      <label className="block">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-sub">Repository name</span>
        <input
          value={repo}
          onChange={e => setRepo(e.target.value)}
          className="num min-h-[48px] w-full rounded-xl bg-surface px-3 text-base"
          autoCapitalize="none"
          autoCorrect="off"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-sub">Fine-grained token</span>
        <input
          type="password"
          value={token}
          onChange={e => setToken(e.target.value)}
          placeholder="github_pat_…"
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
        {busy && <Loader2 size={18} className="animate-spin" />} Connect
      </button>

      {error && <p className="text-xs text-danger">{error}</p>}

      {preview && (
        <Sheet open onClose={() => setPreview(null)} title="Both sides have data">
          <p className="mb-3 text-sm text-sub">
            The cloud already holds a snapshot
            {preview.remoteSummary && preview.remoteSummary.exportedAt > 0 && (
              <> ({preview.remoteSummary.sessions} sessions, {preview.remoteSummary.foodLogs} food logs,
              saved {fmtDateTime(preview.remoteSummary.exportedAt)})</>
            )}
            , and this device has its own data. How should they combine?
          </p>
          <div className="space-y-2">
            <button
              onClick={() => finish('merge')}
              className="w-full rounded-2xl bg-primary py-3.5 font-display text-lg font-bold text-bg active:opacity-90"
            >
              Merge both (recommended)
            </button>
            <button
              onClick={() => finish('use-remote')}
              className="w-full rounded-2xl bg-muted/40 py-3.5 font-display text-lg font-bold active:bg-muted"
            >
              Use cloud data (replace this device)
            </button>
            <button
              onClick={() => finish('overwrite-remote')}
              className="w-full rounded-2xl border border-danger/40 py-3 font-display text-base font-bold text-danger active:bg-danger/10"
            >
              Overwrite cloud with this device
            </button>
          </div>
        </Sheet>
      )}
    </div>
  )
}
