import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import Sheet from '../../components/Sheet'
import { fmtDate } from '../../lib/dates'
import { parseHistoryCsv, DEFAULT_IMPORT_OPTIONS, type ImportOptions } from '../../lib/importHistory'
import { previewImport, applyImport, type ImportPreview } from '../../lib/importApply'
import { haptic } from '../../native/haptics'

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
          ? 'Nothing new to import: every workout in the file is already here.'
          : `Imported ${r.workouts} workout${r.workouts === 1 ? '' : 's'} (${r.sets} sets)`
            + `${r.exercisesCreated ? `, ${r.exercisesCreated} new exercise${r.exercisesCreated === 1 ? '' : 's'}` : ''}`
            + `${r.pointsAdded ? `, +${r.pointsAdded} rank points this season` : ''}`
            + `${r.duplicates ? `; ${r.duplicates} already here were skipped` : ''}.`,
      )
    } catch (e) {
      setError(`Import failed: ${(e as Error).message}`)
      setBusy(false)
    }
  }

  const strong = 'ok' in parsed && parsed.ok?.format === 'strong'

  return (
    <Sheet open onClose={onClose} title="Import workout history">
      {'error' in parsed ? (
        <p className="flex items-start gap-1.5 text-sm text-danger">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {parsed.error}
        </p>
      ) : (
        <div className="space-y-4">
          {strong && (
            <div className="space-y-2">
              <p className="text-xs text-sub">Strong exports use the units set in Strong. Pick the ones you used:</p>
              <UnitToggle
                label="Weight"
                options={[['kg', 'kg'], ['lb', 'lb']]}
                value={opts.weightUnit}
                onChange={v => setOpts(o => ({ ...o, weightUnit: v as ImportOptions['weightUnit'] }))}
              />
              <UnitToggle
                label="Distance"
                options={[['km', 'km'], ['mi', 'miles']]}
                value={opts.distanceUnit}
                onChange={v => setOpts(o => ({ ...o, distanceUnit: v as ImportOptions['distanceUnit'] }))}
              />
            </div>
          )}

          {!preview && error ? (
            <p className="flex items-start gap-1.5 text-sm text-danger">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {error}
            </p>
          ) : !preview ? (
            <p className="flex items-center gap-2 text-sm text-sub">
              <Loader2 size={16} className="animate-spin" /> Reading the file…
            </p>
          ) : (
            <>
              <div className="rounded-xl bg-card p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-sub">{APP_NAME[preview.format]} export</p>
                <p className="num mt-1 font-display text-2xl font-bold">
                  {preview.workouts} workout{preview.workouts === 1 ? '' : 's'}
                </p>
                {preview.firstDate && preview.lastDate && (
                  <p className="num text-sm text-sub">
                    {fmtDate(preview.firstDate)} – {fmtDate(preview.lastDate)} · {preview.sets} sets
                    {preview.cardioSets > 0 ? ` (${preview.cardioSets} cardio)` : ''}
                  </p>
                )}
                {preview.duplicates > 0 && (
                  <p className="mt-1 text-sm text-sub">
                    {preview.duplicates} workout{preview.duplicates === 1 ? ' is' : 's are'} already here and will be skipped.
                  </p>
                )}
              </div>

              {preview.matched.length > 0 && (
                <NameList title={`Matched to your exercises (${preview.matched.length})`} rows={preview.matched.map(m => [m.raw, m.name])} />
              )}
              {preview.toCreate.length > 0 && (
                <NameList title={`New exercises (${preview.toCreate.length})`} rows={preview.toCreate.map(c => [c.raw, c.muscleGroup])} />
              )}
              {preview.warnings.map(w => (
                <p key={w} className="flex items-start gap-1.5 text-sm text-sub">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {w}
                </p>
              ))}
              <p className="text-xs text-sub">
                Imported workouts get scored like yours: only those in the current season add rank points. Your streak is not changed.
              </p>
              {error && <p className="text-sm text-danger">{error}</p>}
              <button
                onClick={() => void run()}
                disabled={busy || preview.workouts === 0}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-3.5 font-display text-lg font-bold text-bg active:opacity-90 disabled:opacity-40"
              >
                {busy && <Loader2 size={18} className="animate-spin" aria-hidden />}
                {preview.workouts === 0 ? 'Nothing new to import' : busy ? 'Importing…' : `Import ${preview.workouts} workout${preview.workouts === 1 ? '' : 's'}`}
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
      <div className="flex flex-1 rounded-xl bg-card p-1" role="group" aria-label={`${label} unit`}>
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
          {open ? 'Show less' : `Show all ${rows.length}`}
        </button>
      )}
    </div>
  )
}
