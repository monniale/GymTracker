import { useEffect, useRef, useState } from 'react'
import { Download, ExternalLink, Loader2, RefreshCw } from 'lucide-react'
import { getAppInfo } from '../appInfo'
import { useUpdateStore } from '../updateStore'
import type { UpdateErrorKind, UpdateStore } from '../updateStore'
import { useAction } from './controls'
import { fetchLatestRelease, updateView, UpdateCheckError } from '../../lib/updateCheck'
import type { UpdateView } from '../../lib/updateCheck'
import { fmtDateTime } from '../../lib/dates'
import { t } from '../../i18n'

/**
 * Settings › Updates (Android): installed version, a manual "Check for updates" against the
 * repo's latest GitHub release, and a download link for a newer APK. The check is manual only
 * (the unauthenticated API allows 60 requests/hour/IP): on mount the cached last result shows.
 * Only the versionCode is compared; `older`/`same` both mean up to date. No result shows until the
 * installed versionCode has loaded, so a cached release never flashes as an update. A manual check
 * announces its result through a polite live region (the cached result shown on mount does not).
 */
export default function UpdateSection() {
  const [info, setInfo] = useState<{ version: string; build: string } | null>(null)
  const { lastCheckAt, latest, error, errorStatus, save } = useUpdateStore()
  const [busy, run] = useAction()
  const abortRef = useRef<AbortController | null>(null)
  const [announce, setAnnounce] = useState('')

  useEffect(() => {
    let alive = true
    void getAppInfo().then(i => {
      if (alive) setInfo(i)
    })
    return () => {
      alive = false
      abortRef.current?.abort()
    }
  }, [])

  function check() {
    run(async () => {
      const ctl = new AbortController()
      abortRef.current = ctl
      // Cleared first so the same result twice in a row is announced again.
      setAnnounce('')
      try {
        save({ latest: await fetchLatestRelease(fetch, ctl.signal) })
      } catch (e) {
        if (ctl.signal.aborted) return
        if (e instanceof UpdateCheckError) save({ error: e.kind, status: e.status })
        else save({ error: 'network' })
      }
      const s = useUpdateStore.getState()
      setAnnounce(resultLine(updateView(info, s.latest), s))
    })
  }

  const view = updateView(info, latest)
  const isDebug = info?.version.endsWith('-debug') ?? false
  const showRelease = view === 'available' || view === 'unknown'

  return (
    <section className="mb-4 rounded-2xl border border-edge bg-card p-4">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-sub">{t('native.update.title')}</h2>
      {info && (
        <p className="truncate text-sm">
          {t('native.update.installed', {
            version: info.build ? t('native.update.versionCode', { name: info.version, code: info.build }) : info.version,
          })}
        </p>
      )}
      {isDebug && <p className="mt-0.5 text-xs text-sub">{t('native.update.debug')}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          type="button"
          disabled={busy}
          onClick={check}
          className="flex min-h-[48px] shrink-0 items-center gap-2 whitespace-nowrap rounded-xl bg-muted/40 px-4 font-semibold active:bg-muted disabled:opacity-50"
        >
          {busy ? (
            <Loader2 size={18} className="animate-spin" aria-hidden />
          ) : (
            <RefreshCw size={18} aria-hidden />
          )}
          {busy ? t('native.update.checking') : t('native.update.check')}
        </button>
        <span className="min-w-0 text-xs text-sub">
          {lastCheckAt === null
            ? t('native.update.neverChecked')
            : t('native.update.lastChecked', { time: fmtDateTime(lastCheckAt) })}
        </span>
      </div>

      <p role="status" className="sr-only">
        {announce}
      </p>

      {lastCheckAt !== null && view !== 'pending' && (
        <div className="mt-3 space-y-2">
          {error ? (
            <p className="text-sm text-danger">{errorText(error, errorStatus)}</p>
          ) : latest === null ? (
            <p className="text-sm text-sub">{t('native.update.noRelease')}</p>
          ) : (
            !showRelease && <p className="text-sm font-semibold text-primary">{t('native.update.upToDate')}</p>
          )}
          {showRelease && latest && (
            <>
              <p className="text-sm font-semibold">
                {view === 'available'
                  ? t('native.update.available', { name: latest.versionName, code: latest.versionCode })
                  : t('native.update.latestUnknown', { name: latest.versionName, code: latest.versionCode })}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={latest.apkUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex min-h-[44px] shrink-0 items-center gap-2 whitespace-nowrap rounded-xl bg-primary/15 px-4 font-semibold text-primary active:bg-primary/30"
                >
                  <Download size={18} aria-hidden /> {t('native.update.download')}
                </a>
                {latest.htmlUrl && (
                  <a
                    href={latest.htmlUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex min-h-[44px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl px-3 text-sm font-semibold text-primary active:bg-muted/40"
                  >
                    {t('native.update.notes')} <ExternalLink size={14} aria-hidden />
                  </a>
                )}
              </div>
            </>
          )}
        </div>
      )}

      <p className="mt-3 text-xs leading-snug text-sub">{t('native.update.hint')}</p>
    </section>
  )
}

/** The main result line, as the manual check announces it. */
function resultLine(view: UpdateView, s: Pick<UpdateStore, 'latest' | 'error' | 'errorStatus'>): string {
  if (s.error) return errorText(s.error, s.errorStatus)
  if (view === 'pending') return ''
  if (!s.latest) return t('native.update.noRelease')
  if (view === 'available') return t('native.update.available', { name: s.latest.versionName, code: s.latest.versionCode })
  if (view === 'unknown') return t('native.update.latestUnknown', { name: s.latest.versionName, code: s.latest.versionCode })
  return t('native.update.upToDate')
}

function errorText(kind: UpdateErrorKind, status: number): string {
  if (kind === 'rate-limit') return t('native.update.errorRateLimit')
  if (kind === 'network') return t('native.update.errorNetwork')
  return t('native.update.errorHttp', { status })
}
