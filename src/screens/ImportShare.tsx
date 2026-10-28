import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Check, ChevronLeft, FileUp, Plus } from 'lucide-react'
import { db } from '../db/db'
import { exerciseDisplayName } from '../lib/exerciseNames'
import {
  PROGRAM_SCHEMA, ShareLinkError, applyShareImport, decodeShareInput, decodeShareLink, previewShareImport, type ShareFile,
} from '../lib/shareTemplate'
import { isNative } from '../native/platform'
import { t } from '../i18n'

function invalidText(e: unknown): string {
  if (e instanceof ShareLinkError) return t(`programs.share.errors.${e.code}`)
  return t('programs.import.invalid', { error: (e as Error)?.message ?? String(e) })
}

/**
 * `/import`: a shared template or program (src/lib/shareTemplate.ts). Opens from a share link
 * (`#/import?t=…`, read with HashRouter's search params), else takes a pasted link / file JSON or
 * a picked file. Shows which exercises are already known and which get added, then imports and
 * opens the template editor (one template) or Programs (a program). Not a native route (it writes).
 */
export default function ImportShare() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const param = params.get('t')
  const [file, setFile] = useState<ShareFile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [text, setText] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const exercises = useLiveQuery(() => db.exercises.toArray())

  useEffect(() => {
    if (!param) return
    let live = true
    setError(null)
    decodeShareLink(param)
      .then(f => live && setFile(f))
      .catch(e => live && setError(invalidText(e)))
    return () => {
      live = false
    }
  }, [param])

  const preview = useMemo(() => (file && exercises ? previewShareImport(file, exercises) : null), [file, exercises])

  async function read(input: string) {
    setError(null)
    try {
      setFile(await decodeShareInput(input))
    } catch (e) {
      setError(invalidText(e))
    }
  }

  async function doImport() {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const { templateIds, programId } = await applyShareImport(file)
      if (programId !== undefined) navigate('/workout/programs', { replace: true, state: { programId } })
      else if (templateIds.length > 0) navigate(`/workout/template/${templateIds[0]}`, { replace: true })
      else navigate('/workout', { replace: true })
    } catch (e) {
      setError(t('programs.import.failed', { error: (e as Error).message }))
      setBusy(false)
    }
  }

  function reset() {
    setFile(null)
    setError(null)
    setText('')
    if (param) setParams({}, { replace: true })
  }

  return (
    <div className="pt-4">
      <div className="mb-4 flex items-center gap-2">
        <Link
          to="/workout"
          aria-label={t('common.back')}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sub active:bg-muted/40"
        >
          <ChevronLeft size={24} />
        </Link>
        <h1 className="min-w-0 truncate font-display text-3xl font-bold">{t('programs.import.title')}</h1>
      </div>

      {!file && !param && (
        <div className="space-y-3">
          <p className="text-sm text-sub">{t('programs.import.hint')}</p>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder={t('programs.import.paste')}
            aria-label={t('programs.import.paste')}
            rows={4}
            className="w-full rounded-xl border border-edge bg-card p-3 text-sm"
          />
          <div className="flex gap-2">
            <button
              onClick={() => void read(text)}
              disabled={text.trim() === ''}
              className="min-h-[48px] min-w-0 flex-1 truncate rounded-xl bg-primary px-2 font-semibold text-bg active:opacity-90 disabled:opacity-50"
            >
              {t('programs.import.read')}
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              className="flex min-h-[48px] min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl bg-muted/40 px-2 font-semibold active:bg-muted"
            >
              <FileUp size={18} className="shrink-0" aria-hidden /> <span className="truncate">{t('programs.import.pickFile')}</span>
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            // Same rule as the backup import: Android pickers mislabel .json; the content is validated.
            accept={isNative ? undefined : 'application/json,.json'}
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (!f) return
              f.text().then(read).catch(err => setError(invalidText(err)))
            }}
          />
        </div>
      )}

      {!file && param && !error && <p className="py-6 text-center text-sm text-sub">{t('programs.import.reading')}</p>}

      {file && preview && (
        <div className="space-y-4">
          {file.schema === PROGRAM_SCHEMA && (
            <p className="font-display text-xl font-semibold">{t('programs.import.program', { name: file.name })}</p>
          )}
          <div>
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-sub">{t('programs.import.workouts')}</h2>
            <div className="space-y-2">
              {preview.templates.map((tpl, i) => (
                <div key={i} className="rounded-xl border border-edge bg-card p-3">
                  <p className="mb-1 truncate font-display text-lg font-semibold">{tpl.name}</p>
                  <ul className="space-y-0.5 text-sm">
                    {tpl.items.map((it, j) => (
                      <li key={j} className="flex min-w-0 items-center gap-1.5">
                        {it.status === 'known'
                          ? <Check size={14} className="shrink-0 text-primary" aria-label={t('programs.import.known')} />
                          : <Plus size={14} className="shrink-0 text-sub" aria-label={t('programs.import.toCreate')} />}
                        <span className="min-w-0 truncate">{exerciseDisplayName(it.name)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-sub">
            <span className="flex items-center gap-1 whitespace-nowrap">
              <Check size={14} className="shrink-0 text-primary" aria-hidden /> {t('programs.import.known')}: <span className="num font-semibold text-ink">{preview.known}</span>
            </span>
            <span className="flex items-center gap-1 whitespace-nowrap">
              <Plus size={14} className="shrink-0" aria-hidden /> {t('programs.import.toCreate')}: <span className="num font-semibold text-ink">{preview.toCreate}</span>
            </span>
          </div>
          <button
            onClick={() => void doImport()}
            disabled={busy}
            className="min-h-[48px] w-full rounded-xl bg-primary font-display text-lg font-bold text-bg active:opacity-90 disabled:opacity-60"
          >
            {busy ? t('programs.import.importing') : t('programs.import.importBtn')}
          </button>
          <button onClick={reset} className="w-full py-2 text-center text-sm font-medium text-sub">
            {t('programs.import.other')}
          </button>
        </div>
      )}

      {error && (
        <div className="mt-3 space-y-2">
          <p className="text-sm text-danger" role="alert">{error}</p>
          {param && !file && (
            <button onClick={reset} className="w-full py-2 text-center text-sm font-medium text-sub">
              {t('programs.import.other')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
