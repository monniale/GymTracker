import { useEffect, useMemo, useState } from 'react'
import { muscleGroupLabel } from '../../lib/equipment'
import { AlertTriangle, Loader2 } from 'lucide-react'
import Sheet from '../../components/Sheet'
import { fmtDate } from '../../lib/dates'
import { parseHistoryCsv, DEFAULT_IMPORT_OPTIONS, type ImportOptions } from '../../lib/importHistory'
import { previewImport, applyImport, type ImportPreview } from '../../lib/importApply'
import { haptic } from '../../native/haptics'
import { exerciseDisplayName } from '../../lib/exerciseNames'
import { t, tp } from '../../i18n'

const APP_NAME = { strong: 'Strong', hevy: 'Hevy' } as const

/** Preview of a Strong/Hevy CSV before anything is written, then the import itself. */
export default function ImportHistorySheet({ text, onClose, onDone }: {
  text: string
  onClose: () => void
  onDone: (message: string) => void
}) {
  const [opts, setOpts] = useState<ImportOptions>(DEFAULT_IMPORT_OPTIONS)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const parsed = useMemo(() => {
    try {
      return { ok: parseHistoryCsv(text, opts) } as const
    } catch (e) {
      return { error: (e as Error).message } as const
    }
  }, [text, opts])

  useEffect(() => {
    let live = true
    setPreview(null)
    if ('ok' in parsed && parsed.ok) {
      previewImport(parsed.ok).then(p => live && setPreview(p)).catch(e => live && setError((e as Error).message))
    }
    return () => {
      live = false
    }
  }, [parsed])

  async function run() {
    if (!('ok' in parsed) || !parsed.ok || busy) return
    haptic('tap')
    setBusy(true)
    setError(null)
    try {
      const r = await applyImport(parsed.ok)
      onDone(
        r.workouts === 0
          ? t('settings.importHistory.doneNothing')
          : tp('settings.importHistory.doneImported', r.workouts, { sets: tp('units.sets', r.sets) })
            + (r.exercisesCreated ? tp('settings.importHistory.doneExercises', r.exercisesCreated) : '')
            + (r.pointsAdded ? tp('settings.importHistory.donePoints', r.pointsAdded) : '')
            + (r.duplicates ? tp('settings.importHistory.doneSkipped', r.duplicates) : '')
            + t('settings.importHistory.doneEnd'),
      )
    } catch (e) {
      setError(t('settings.data.importFailed', { error: (e as Error).message }))
      setBusy(false)
    }
  }

  const strong = 'ok' in parsed && parsed.ok?.format === 'strong'

  return (
    <Sheet open onClose={onClose} title={t('settings.importHistory.title')}>
      {'error' in parsed ? (
        <p className="flex items-start gap-1.5 text-sm text-danger">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {parsed.error}
        </p>
      ) : (
        <div className="space-y-4">
          {strong && (
            <div className="space-y-2">
              <p className="text-xs text-sub">{t('settings.importHistory.units')}</p>
              <UnitToggle
                label={t('settings.importHistory.weight')}
                options={[['kg', 'kg'], ['lb', 'lb']]}
                value={opts.weightUnit}
                onChange={v => setOpts(o => ({ ...o, weightUnit: v as ImportOptions['weightUnit'] }))}
              />
              <UnitToggle
                label={t('settings.importHistory.distance')}
                options={[['km', 'km'], ['mi', t('settings.importHistory.miles')]]}
                value={opts.distanceUnit}
                onChange={v => setOpts(o => ({ ...o, distanceUnit: v as ImportOptions['distanceUnit'] }))}
              />
            </div>
          )}

          {!preview ? (
            <p className="flex items-center gap-2 text-sm text-sub">
              <Loader2 size={16} className="animate-spin" /> {t('settings.importHistory.reading')}
            </p>
          ) : (
            <>
              <div className="rounded-xl bg-card p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-sub">{t('settings.importHistory.export', { app: APP_NAME[preview.format] })}</p>
                <p className="num mt-1 font-display text-2xl font-bold">
                  {tp('units.workouts', preview.workouts)}
                </p>
                {preview.firstDate && preview.lastDate && (
                  <p className="num text-sm text-sub">
                    {fmtDate(preview.firstDate)} – {fmtDate(preview.lastDate)} · {tp('units.sets', preview.sets)}
                    {preview.cardioSets > 0 ? ` ${t('settings.importHistory.cardio', { n: preview.cardioSets })}` : ''}
                  </p>
                )}
                {preview.duplicates > 0 && (
                  <p className="mt-1 text-sm text-sub">
                    {tp('settings.importHistory.duplicates', preview.duplicates)}
                  </p>
                )}
              </div>

              {preview.matched.length > 0 && (
                <NameList
                  title={t('settings.importHistory.matched', { n: preview.matched.length })}
                  rows={preview.matched.map(m => [m.raw, exerciseDisplayName(m.name)])}
                />
              )}
              {preview.toCreate.length > 0 && (
                <NameList
                  title={t('settings.importHistory.newExercises', { n: preview.toCreate.length })}
                  rows={preview.toCreate.map(c => [c.raw, muscleGroupLabel(c.muscleGroup)])}
                />
              )}
              {preview.warnings.map(w => (
                <p key={w} className="flex items-start gap-1.5 text-sm text-sub">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {w}
                </p>
              ))}
              <p className="text-xs text-sub">
                {t('settings.importHistory.scoring')}
              </p>
              {error && <p className="text-sm text-danger">{error}</p>}
              <button
                onClick={() => void run()}
                disabled={busy || preview.workouts === 0}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-3.5 font-display text-lg font-bold text-bg active:opacity-90 disabled:opacity-40"
              >
                {busy && <Loader2 size={18} className="animate-spin" aria-hidden />}
                {preview.workouts === 0
                  ? t('settings.importHistory.nothingNew')
                  : busy
                    ? t('settings.importHistory.importing')
                    : tp('settings.importHistory.importN', preview.workouts)}
              </button>
            </>
          )}
        </div>
      )}
    </Sheet>
  )
}

function UnitToggle({ label, options, value, onChange }: {
  label: string
  options: [string, string][]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 shrink-0 text-sm text-sub">{label}</span>
      <div className="flex flex-1 rounded-xl bg-card p-1" role="group" aria-label={t('settings.importHistory.unitAria', { label })}>
        {options.map(([v, text]) => (
          <button
            key={v}
            onClick={() => onChange(v)}
            aria-pressed={value === v}
            className={`min-h-[36px] flex-1 rounded-lg text-sm font-semibold ${value === v ? 'bg-muted text-ink' : 'text-sub'}`}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  )
}

function NameList({ title, rows }: { title: string; rows: [string, string][] }) {
  const [open, setOpen] = useState(false)
  const shown = open ? rows : rows.slice(0, 5)
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-sub">{title}</p>
      <ul className="space-y-1">
        {shown.map(([a, b]) => (
          <li key={a} className="flex items-center gap-2 text-sm">
            <span className="min-w-0 flex-1 truncate">{a}</span>
            <span className="min-w-0 max-w-[45%] shrink-0 truncate text-right capitalize text-sub">{b}</span>
          </li>
        ))}
      </ul>
      {rows.length > 5 && (
        <button onClick={() => setOpen(o => !o)} className="mt-1 text-xs font-semibold text-primary">
          {open ? t('common.showLess') : t('settings.importHistory.showAll', { n: rows.length })}
        </button>
      )}
    </div>
  )
}
