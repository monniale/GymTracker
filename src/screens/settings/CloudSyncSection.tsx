import { useEffect, useState } from 'react'
import { Cloud, CloudOff, RefreshCw, Loader2, AlertTriangle, FlaskConical } from 'lucide-react'
import { db } from '../../db/db'
import { outboxSize } from '../../db/outbox'
import {
  useCloudStore, cloudSignIn, cloudVerify, cloudSignOut, cloudSyncNow, cloudHasData, cloudInitialSync,
  activePendingSignIn, cancelPendingSignIn,
  type InitialChoice,
} from '../../lib/cloudSync'
import { cloudConfigured } from '../../lib/supabaseConfig'
import { fmtDateTime } from '../../lib/dates'
import { useUiStore } from '../../lib/uiStore'
import Sheet from '../../components/Sheet'
import { t, tp } from '../../i18n'

/** Settings › Cloud sync (Supabase): email-code sign-in, status, sync now, sign out. Hidden when the build has no project. */
export default function CloudSyncSection() {
  const session = useCloudStore(s => s.session)
  const demoLoaded = useUiStore(s => s.demoLoaded)
  if (!cloudConfigured()) return null

  return (
    <section className="mb-4 rounded-2xl border border-edge bg-card p-4">
      <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-sub">
        {session ? <Cloud size={14} className="text-accent" /> : <CloudOff size={14} />}
        {t('settings.cloud.title')}
      </h2>
      {session && <SignedInView demoLoaded={demoLoaded} />}
      {!session && (demoLoaded ? <DemoNotice /> : <SignInView />)}
    </section>
  )
}

function DemoNotice() {
  return (
    <p className="flex items-start gap-1.5 text-sm text-sub">
      <FlaskConical size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden />
      {t('settings.cloud.demoNotice')}
    </p>
  )
}

function SignedInView({ demoLoaded }: { demoLoaded: boolean }) {
  const store = useCloudStore()
  // The outbox lives outside React: re-read it on every sync state change.
  const [pending, setPending] = useState(outboxSize)
  useEffect(() => setPending(outboxSize()), [store.syncing, store.lastSyncAt])

  async function signOut() {
    if (!window.confirm(t('settings.cloud.signOutConfirm'))) return
    await cloudSignOut()
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">
            {t('settings.cloud.signedInAs', { email: store.session?.user.email ?? '' })}
          </p>
          <p className="truncate text-xs text-sub">
            {demoLoaded
              ? t('settings.cloud.demoPaused')
              : store.syncing
                ? t('settings.cloud.syncing')
                : store.lastSyncAt
                  ? t('settings.cloud.lastSync', { time: fmtDateTime(store.lastSyncAt) })
                  : t('settings.cloud.never')}
            {pending > 0 && !store.syncing && ` · ${tp('settings.cloud.pending', pending)}`}
          </p>
        </div>
        <button
          onClick={() => void cloudSyncNow('manual')}
          disabled={store.syncing || demoLoaded}
          className="flex min-h-[44px] shrink-0 items-center gap-2 whitespace-nowrap rounded-xl bg-primary/15 px-4 text-sm font-semibold text-primary active:bg-primary/30 disabled:opacity-50"
        >
          {store.syncing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          {t('settings.cloud.syncNow')}
        </button>
      </div>
      {store.lastError && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-danger">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {store.lastError}
        </p>
      )}
      <button onClick={() => void signOut()} className="mt-1 py-2 text-xs font-medium text-danger">
        {t('settings.cloud.signOut')}
      </button>
    </div>
  )
}

function SignInView() {
  // A sign-in sent earlier (another tab, a trip to the mail app, an app restart) resumes at the code step.
  const [email, setEmail] = useState(() => activePendingSignIn()?.email ?? '')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(() => activePendingSignIn() !== null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [choice, setChoice] = useState(false)

  async function sendCode() {
    setBusy(true)
    setError(null)
    try {
      await cloudSignIn(email)
      setSent(true)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function signIn() {
    setBusy(true)
    setError(null)
    try {
      await cloudVerify(email, code)
      // Data on both sides → ask; else the right choice is obvious.
      const [sessions, foodLogs] = await Promise.all([db.sessions.count(), db.foodLogs.count()])
      const localData = sessions > 0 || foodLogs > 0
      if (localData && (await cloudHasData())) setChoice(true)
      else await cloudInitialSync(localData ? 'merge' : 'use-cloud')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function finish(pick: InitialChoice) {
    setChoice(false)
    await cloudInitialSync(pick)
  }

  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())

  return (
    <div className="space-y-3">
      <p className="text-sm text-sub">{t('settings.cloud.intro')}</p>
      <label className="block">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-sub">{t('settings.cloud.email')}</span>
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          disabled={sent}
          onChange={e => setEmail(e.target.value)}
          className="min-h-[48px] w-full rounded-xl bg-surface px-3 text-base disabled:opacity-60"
        />
      </label>
      {!sent ? (
        <button
          onClick={() => void sendCode()}
          disabled={busy || !validEmail}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-3.5 font-display text-lg font-bold text-bg active:opacity-90 disabled:opacity-40"
        >
          {busy && <Loader2 size={18} className="animate-spin" />} {busy ? t('settings.cloud.sending') : t('settings.cloud.sendCode')}
        </button>
      ) : (
        <>
          <p className="text-xs text-sub">{t('settings.cloud.codeSent', { email: email.trim() })}</p>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-sub">{t('settings.cloud.code')}</span>
            <input
              type="text"
              autoComplete="one-time-code"
              value={code}
              onChange={e => setCode(e.target.value)}
              placeholder={t('settings.cloud.codePlaceholder')}
              className={`min-h-[48px] w-full rounded-xl bg-surface px-3 ${/^[\d\s]*$/.test(code) ? 'num text-xl tracking-[0.3em]' : 'text-sm'}`}
            />
          </label>
          <p className="text-xs text-sub">{t('settings.cloud.codeHint')}</p>
          <button
            onClick={() => void signIn()}
            disabled={busy || code.trim().length < 6}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-3.5 font-display text-lg font-bold text-bg active:opacity-90 disabled:opacity-40"
          >
            {busy && <Loader2 size={18} className="animate-spin" />} {t('settings.cloud.signIn')}
          </button>
          <button
            onClick={() => { cancelPendingSignIn(); setSent(false); setCode(''); setError(null) }}
            className="w-full py-2 text-xs font-medium text-sub active:text-ink"
          >
            {t('settings.cloud.changeEmail')}
          </button>
        </>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}

      {choice && (
        <Sheet open onClose={() => void finish('merge')} title={t('settings.cloud.conflictTitle')}>
          <p className="mb-3 text-sm text-sub">{t('settings.cloud.conflictBody')}</p>
          <div className="space-y-2">
            <button
              onClick={() => void finish('merge')}
              className="w-full rounded-2xl bg-primary py-3.5 font-display text-lg font-bold text-bg active:opacity-90"
            >
              {t('settings.cloud.merge')}
            </button>
            <button
              onClick={() => void finish('use-cloud')}
              className="w-full rounded-2xl bg-muted/40 py-3.5 font-display text-lg font-bold active:bg-muted"
            >
              {t('settings.cloud.useCloud')}
            </button>
            <button
              onClick={() => void finish('overwrite-cloud')}
              className="w-full rounded-2xl border border-danger/40 py-3 font-display text-base font-bold text-danger active:bg-danger/10"
            >
              {t('settings.cloud.overwriteCloud')}
            </button>
          </div>
        </Sheet>
      )}
    </div>
  )
}
