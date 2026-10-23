import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Download, Link2, Play, Square, Trash2 } from 'lucide-react'
import Sheet from '../../components/Sheet'
import NumberStepper from '../../components/NumberStepper'
import { db, deleteWithTombstone } from '../../db/db'
import { addDays, localDateStr, mondayOf } from '../../lib/dates'
import { useLocalToday } from '../../lib/hooks'
import { exerciseDisplayName } from '../../lib/exerciseNames'
import { currentWeek, schemeLabel } from '../../lib/prescription'
import { installPreset, type PresetFile } from '../../lib/programs'
import {
  ShareLinkError, encodeShareLink, exportProgram, shareLinkUrl, type ShareFile,
} from '../../lib/shareTemplate'
import { isNative } from '../../native/platform'
import { t, tp, useT } from '../../i18n'
import type { Lang } from '../../i18n'
import type { Id, Program, TemplateItem } from '../../types'

/** A preset's text in the UI language (English fallback); plain strings pass through. */
export function loc(text: string | { en: string; it?: string } | undefined, lang: Lang): string {
  if (text === undefined) return ''
  if (typeof text === 'string') return text
  return (lang === 'it' && text.it) || text.en
}

/** The preset's level in the UI language; an unknown level shows as written. */
export function levelLabel(level: string | undefined): string {
  if (level === 'beginner') return t('programs.level.beginner')
  if (level === 'intermediate') return t('programs.level.intermediate')
  if (level === 'advanced') return t('programs.level.advanced')
  return level ?? ''
}

/**
 * One line of the weekly layout: "5×5 · Linear +2.5 kg", "3×8–12", "65 % ×5 · 75 % ×5 · 85 % ×5+".
 * Percent and staged items carry their sets in the scheme label (src/lib/prescription.ts).
 */
export function itemSummary(item: Omit<TemplateItem, 'exerciseId'>, week = 1): string {
  const s = item.scheme
  const label = schemeLabel(item as TemplateItem, week)
  if (s?.kind === 'percent' || (s?.kind === 'linear' && (s.stages?.length ?? 0) > 0)) return label
  const range = item.targetRepsMax !== undefined && item.targetRepsMax > item.targetReps
    ? `${item.targetReps}–${item.targetRepsMax}`
    : String(item.targetReps)
  const base = `${item.targetSets}×${range}`
  return s?.kind === 'linear' ? `${base} · ${label}` : base
}

/** The share-link copy for a ShareLinkError code (else the raw message). */
export function shareErrorText(e: unknown): string {
  if (e instanceof ShareLinkError) return t(`programs.share.errors.${e.code}`)
  return t('programs.share.failed', { error: (e as Error)?.message ?? String(e) })
}

function fileNameFor(name: string, kind: 'template' | 'program'): string {
  const slug = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return `${slug || kind}.gymtracker-${kind}.json`
}

/** Opens the share sheet on a JSON file (Android: the native share sheet; web: Web Share, else a download). */
async function shareJsonFile(fileName: string, json: string, dialogTitle: string): Promise<void> {
  if (isNative) {
    const { shareTextFile } = await import('../../native/files')
    await shareTextFile(fileName, json, dialogTitle)
    return
  }
  const file = new File([json], fileName, { type: 'application/json' })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: dialogTitle })
      return
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return
      // Not allowed here (no user activation left): fall back to a download.
    }
  }
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Shares a link: Web Share when the browser has it (not the Android WebView), else the clipboard. */
async function shareLinkText(url: string, name: string): Promise<'shared' | 'copied'> {
  const text = t('programs.share.linkText', { name })
  if (!isNative && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: text, text, url })
      return 'shared'
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return 'shared'
      // Not allowed here: fall back to the clipboard.
    }
  }
  await navigator.clipboard.writeText(url)
  return 'copied'
}

/** Long links get cut by some messengers: the UI suggests the file past this length. */
const LONG_LINK = 2000

/** "Share link" + "Share file" for a template or a program (src/lib/shareTemplate.ts). */
export function ShareActions({ kind, name, load }: { kind: 'template' | 'program'; name: string; load: () => Promise<ShareFile> }) {
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function run(fn: () => Promise<string | null>) {
    setBusy(true)
    setMsg(null)
    try {
      setMsg(await fn())
    } catch (e) {
      setMsg(shareErrorText(e))
    } finally {
      setBusy(false)
    }
  }

  const link = () => run(async () => {
    const url = shareLinkUrl(await encodeShareLink(await load()))
    const how = await shareLinkText(url, name)
    const long = url.length > LONG_LINK ? t('programs.share.longLink') : null
    return how === 'copied' ? [t('programs.share.copied'), long].filter(Boolean).join(' ') : long
  })
  const file = () => run(async () => {
    const json = JSON.stringify(await load(), null, 2)
    await shareJsonFile(fileNameFor(name, kind), json, t(kind === 'program' ? 'programs.share.dialogProgram' : 'programs.share.dialogTemplate'))
    return null
  })

  const btn = 'flex min-h-[44px] min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl bg-muted/40 px-2 text-sm font-semibold active:bg-muted disabled:opacity-60'
  return (
    <div>
      <div className="flex gap-2">
        <button type="button" onClick={() => void link()} disabled={busy} className={btn}>
          <Link2 size={16} className="shrink-0" aria-hidden /> <span className="truncate">{t('programs.share.link')}</span>
        </button>
        <button type="button" onClick={() => void file()} disabled={busy} className={btn}>
          <Download size={16} className="shrink-0" aria-hidden /> <span className="truncate">{t('programs.share.file')}</span>
        </button>
      </div>
      {msg && <p className="mt-1.5 text-xs text-sub" role="status">{msg}</p>}
    </div>
  )
}

type Target = { kind: 'preset'; preset: PresetFile } | { kind: 'program'; id: Id }

/**
 * A preset (description, weekly layout, Install) or an installed program (weekly layout of its
 * templates; Start / Stop / current week / Share / Delete). One program is active at a time:
 * Start stops any other running one. Deleting a program keeps its templates.
 */
export default function ProgramDetailSheet({ target, installedCount = 0, onClose }: {
  target: Target
  /** Programs already installed from this preset (preset target only). */
  installedCount?: number
  onClose: () => void
}) {
  return target.kind === 'preset'
    ? <PresetDetail preset={target.preset} installedCount={installedCount} onClose={onClose} />
    : <ProgramDetail id={target.id} onClose={onClose} />
}

function PresetDetail({ preset, installedCount, onClose }: { preset: PresetFile; installedCount: number; onClose: () => void }) {
  const { lang } = useT()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function install() {
    setBusy(true)
    setError(null)
    try {
      // installPreset starts the new program this week; one runs at a time, so stop the others.
      const pid = await installPreset(preset.id, lang)
      await db.transaction('rw', db.programs, async () => {
        const now = Date.now()
        for (const p of await db.programs.toArray()) {
          if (String(p.id) !== String(pid) && isRunning(p)) await db.programs.update(p.id!, { endedAt: now, updatedAt: now })
        }
      })
      onClose()
      navigate('/workout')
    } catch (e) {
      setError(t('programs.detail.installFailed', { error: (e as Error).message }))
      setBusy(false)
    }
  }

  return (
    <Sheet open onClose={onClose} title={loc(preset.name, lang)}>
      <p className="mb-1 flex flex-wrap gap-x-2 text-xs font-semibold uppercase tracking-wide text-sub">
        <span className="whitespace-nowrap">{levelLabel(preset.level)}</span>
        <span className="whitespace-nowrap">{tp('programs.screen.daysPerWeek', preset.daysPerWeek)}</span>
      </p>
      <p className="mb-4 text-sm">{loc(preset.description, lang)}</p>

      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-sub">{t('programs.detail.layout')}</h3>
      <div className="mb-4 space-y-2">
        {preset.templates.map((tpl, i) => (
          <div key={i} className="rounded-xl border border-edge bg-card p-3">
            <p className="mb-1 truncate font-display text-lg font-semibold">{loc(tpl.name, lang)}</p>
            <ul className="space-y-0.5 text-sm">
              {tpl.items.map((it, j) => (
                <li key={j} className="flex min-w-0 flex-wrap gap-x-1.5">
                  <span className="min-w-0 truncate font-medium">{exerciseDisplayName(it.exercise.name)}</span>
                  <span className="num text-sub">{itemSummary(it)}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {installedCount > 0 && <p className="mb-2 text-xs text-sub">{t('programs.detail.alreadyInstalled')}</p>}
      <button
        onClick={() => void install()}
        disabled={busy}
        className="min-h-[48px] w-full rounded-xl bg-primary font-display text-lg font-bold text-bg active:opacity-90 disabled:opacity-60"
      >
        {busy ? t('programs.detail.installing') : installedCount > 0 ? t('programs.detail.installAgain') : t('programs.detail.install')}
      </button>
      <p className="mt-1.5 text-center text-xs text-sub">{t('programs.detail.installHint')}</p>
      {error && <p className="mt-1.5 text-center text-xs text-danger">{error}</p>}
    </Sheet>
  )
}

/** Active = started (`cycleStartDate`) and not stopped (`endedAt`), as `activeProgram` reads it. */
export function isRunning(p: Pick<Program, 'cycleStartDate' | 'endedAt'>): boolean {
  return !!p.cycleStartDate && p.endedAt === undefined
}

function ProgramDetail({ id, onClose }: { id: Id; onClose: () => void }) {
  const today = useLocalToday()
  const [error, setError] = useState<string | null>(null)
  const data = useLiveQuery(async () => {
    const program = await db.programs.get(id)
    if (!program) return null
    const templates = await db.templates.bulkGet(program.templateIds)
    const exIds = [...new Set(templates.flatMap(tpl => tpl?.items.map(i => i.exerciseId) ?? []))]
    const exercises = await db.exercises.bulkGet(exIds)
    return { program, templates, exMap: new Map(exercises.flatMap(e => (e ? [[e.id!, e] as const] : []))) }
  }, [id])
  // Deleted here or by a sync from another device: close the sheet.
  useEffect(() => {
    if (data === null) onClose()
  }, [data, onClose])

  if (!data) return null
  const { program, templates, exMap } = data
  const running = isRunning(program)
  const week = currentWeek(program, today)

  async function act(fn: () => Promise<unknown>) {
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(t('programs.detail.failed', { error: (e as Error).message }))
    }
  }

  // Week 1 = this Monday; one running program at a time, so starting one stops the others.
  const start = () => act(() => db.transaction('rw', db.programs, async () => {
    const now = Date.now()
    const others = (await db.programs.toArray()).filter(p => String(p.id) !== String(id) && isRunning(p))
    for (const p of others) await db.programs.update(p.id!, { endedAt: now, updatedAt: now })
    await db.programs.update(id, { cycleStartDate: mondayOf(localDateStr()), endedAt: undefined, updatedAt: now })
  }))
  const stop = () => {
    if (!window.confirm(t('programs.detail.confirmStop', { name: program.name }))) return
    void act(() => db.programs.update(id, { endedAt: Date.now(), updatedAt: Date.now() }))
  }
  // "Set week N": the cycle started N − 1 weeks before this Monday.
  const setWeek = (n: number) => act(() =>
    db.programs.update(id, { cycleStartDate: addDays(mondayOf(today), -7 * (n - 1)), updatedAt: Date.now() }))
  const remove = () => {
    if (!window.confirm(t('programs.detail.confirmDelete', { name: program.name }))) return
    void act(async () => {
      await deleteWithTombstone('programs', id)
      onClose()
    })
  }

  return (
    <Sheet open onClose={onClose} title={program.name}>
      <p className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-sub">
        {running && (
          <span className="shrink-0 whitespace-nowrap rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-primary">
            {t('programs.screen.active')}
          </span>
        )}
        {running && program.cycleWeeks
          ? <span className="whitespace-nowrap">{t('programs.screen.weekOf', { n: week, total: program.cycleWeeks })}</span>
          : !running && <span className="whitespace-nowrap">{t('programs.screen.stopped')}</span>}
        <span className="whitespace-nowrap">{tp('programs.screen.workouts', program.templateIds.length)}</span>
      </p>
      {program.notes && <p className="mb-3 text-sm">{program.notes}</p>}

      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-sub">{t('programs.detail.layout')}</h3>
      <div className="mb-4 space-y-2">
        {program.templateIds.map((tid, i) => {
          const tpl = templates[i]
          return (
            <div key={String(tid)} className="rounded-xl border border-edge bg-card p-3">
              <p className={`mb-1 truncate font-display text-lg font-semibold ${tpl ? '' : 'text-sub'}`}>
                {tpl ? tpl.name : t('programs.detail.missingWorkout')}
              </p>
              {tpl && tpl.items.length === 0 && <p className="text-sm text-sub">{t('programs.detail.empty')}</p>}
              {tpl && (
                <ul className="space-y-0.5 text-sm">
                  {tpl.items.map((it, j) => {
                    const ex = exMap.get(it.exerciseId)
                    return (
                      <li key={j} className="flex min-w-0 flex-wrap gap-x-1.5">
                        <span className="min-w-0 truncate font-medium">{ex ? exerciseDisplayName(ex.name) : '…'}</span>
                        <span className="num text-sub">{itemSummary(it, week)}</span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )
        })}
      </div>

      <div className="space-y-3">
        {running ? (
          <>
            {program.cycleWeeks !== undefined && program.cycleWeeks > 1 && (
              <div className="flex justify-center">
                <NumberStepper
                  compact
                  label={t('programs.detail.setWeek')}
                  value={week}
                  onChange={v => void setWeek(Math.round(v))}
                  step={1}
                  min={1}
                  max={program.cycleWeeks}
                />
              </div>
            )}
            <button
              onClick={stop}
              className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-muted/40 font-semibold active:bg-muted"
            >
              <Square size={16} className="shrink-0" aria-hidden /> {t('programs.detail.stop')}
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => void start()}
              className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-primary font-display text-lg font-bold text-bg active:opacity-90"
            >
              <Play size={18} fill="currentColor" className="shrink-0" aria-hidden /> {t('programs.detail.start')}
            </button>
            <p className="text-center text-xs text-sub">{t('programs.detail.startHint')}</p>
          </>
        )}

        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-sub">{t('programs.detail.share')}</p>
          <ShareActions kind="program" name={program.name} load={() => exportProgram(id)} />
        </div>

        {error && <p className="text-center text-xs text-danger">{error}</p>}

        <button onClick={remove} className="flex w-full items-center justify-center gap-1.5 py-3 text-sm font-medium text-danger">
          <Trash2 size={16} className="shrink-0" aria-hidden /> {t('programs.detail.delete')}
        </button>
      </div>
    </Sheet>
  )
}
