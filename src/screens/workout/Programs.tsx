import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft, ChevronRight, Import, Loader2 } from 'lucide-react'
import { db } from '../../db/db'
import { useLocalToday } from '../../lib/hooks'
import { currentWeek } from '../../lib/prescription'
import { loadPrograms, type PresetFile } from '../../lib/programs'
import ProgramDetailSheet, { isRunning, levelLabel, loc } from './ProgramDetailSheet'
import { t, tp, useT } from '../../i18n'
import type { Id } from '../../types'

type Open = { kind: 'preset'; preset: PresetFile } | { kind: 'program'; id: Id } | null

/**
 * `/workout/programs`: my installed programs (active badge, week N of M) and the bundled presets
 * (`public/programs.json`, built from scripts/programs/*.json). A card opens ProgramDetailSheet.
 * `location.state.programId` (from ImportShare) opens that program at once.
 */
export default function Programs() {
  const { lang } = useT()
  const navigate = useNavigate()
  const location = useLocation()
  const today = useLocalToday()
  const programs = useLiveQuery(() => db.programs.toArray())
  const [presets, setPresets] = useState<PresetFile[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [open, setOpen] = useState<Open>(() => {
    const id = (location.state as { programId?: Id } | null)?.programId
    return id !== undefined ? { kind: 'program', id } : null
  })

  // Drop the one-shot `programId` so Back / a reload does not open the sheet again.
  useEffect(() => {
    if ((location.state as { programId?: Id } | null)?.programId !== undefined) {
      navigate(location.pathname, { replace: true, state: null })
    }
  }, [])

  const load = useCallback(() => {
    setLoadError(false)
    loadPrograms()
      .then(setPresets)
      .catch(() => setLoadError(true))
  }, [])
  useEffect(load, [load])

  // Running program first, then the newest.
  const mine = [...(programs ?? [])].sort((a, b) =>
    Number(isRunning(b)) - Number(isRunning(a)) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  const installedOf = (presetId: string) => (programs ?? []).filter(p => p.presetId === presetId).length

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
        <h1 className="min-w-0 truncate font-display text-3xl font-bold">{t('programs.screen.title')}</h1>
      </div>

      {mine.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-sub">{t('programs.screen.mine')}</h2>
          <div className="space-y-2">
            {mine.map(p => {
              const running = isRunning(p)
              return (
                <button
                  key={String(p.id)}
                  onClick={() => setOpen({ kind: 'program', id: p.id! })}
                  className="flex w-full items-center gap-3 rounded-2xl border border-edge bg-card p-4 text-left active:bg-muted/30"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-display text-xl font-semibold">{p.name}</span>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-sub">
                      {running && (
                        <span className="shrink-0 whitespace-nowrap rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-primary">
                          {t('programs.screen.active')}
                        </span>
                      )}
                      {running && p.cycleWeeks
                        ? <span className="whitespace-nowrap">{t('programs.screen.weekOf', { n: currentWeek(p, today), total: p.cycleWeeks })}</span>
                        : !running && <span className="whitespace-nowrap">{t('programs.screen.stopped')}</span>}
                      <span className="whitespace-nowrap">{tp('programs.screen.workouts', p.templateIds.length)}</span>
                    </span>
                  </span>
                  <ChevronRight size={20} className="shrink-0 text-sub" />
                </button>
              )
            })}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-sub">{t('programs.screen.presets')}</h2>
        {loadError ? (
          <div className="rounded-2xl border border-edge bg-card p-4 text-center">
            <p className="mb-2 text-sm text-sub">{t('programs.screen.loadFailed')}</p>
            <button onClick={load} className="min-h-[44px] rounded-xl bg-muted/40 px-4 font-semibold active:bg-muted">
              {t('programs.screen.retry')}
            </button>
          </div>
        ) : !presets ? (
          <p className="flex items-center justify-center gap-2 py-6 text-sm text-sub">
            <Loader2 size={16} className="shrink-0 animate-spin" aria-hidden /> {t('programs.screen.loading')}
          </p>
        ) : (
          <div className="space-y-2">
            {presets.map(preset => {
              const installed = installedOf(preset.id) > 0
              return (
                <button
                  key={preset.id}
                  onClick={() => setOpen({ kind: 'preset', preset })}
                  className="flex w-full items-center gap-3 rounded-2xl border border-edge bg-card p-4 text-left active:bg-muted/30"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-display text-xl font-semibold">{loc(preset.name, lang)}</span>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-semibold uppercase tracking-wide text-sub">
                      <span className="whitespace-nowrap">{levelLabel(preset.level)}</span>
                      <span className="whitespace-nowrap">{tp('programs.screen.daysPerWeek', preset.daysPerWeek)}</span>
                      {installed && (
                        <span className="shrink-0 whitespace-nowrap rounded-full bg-muted/60 px-2 py-0.5 text-[10px] font-bold text-sub">
                          {t('programs.screen.installed')}
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-sm text-sub">{loc(preset.description, lang)}</span>
                  </span>
                  <ChevronRight size={20} className="shrink-0 text-sub" />
                </button>
              )
            })}
          </div>
        )}
      </section>

      <button
        onClick={() => navigate('/import')}
        className="mt-6 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-edge px-3 text-center font-medium text-sub active:bg-muted/30"
      >
        <Import size={18} className="shrink-0" aria-hidden /> <span className="min-w-0 truncate">{t('programs.screen.importShared')}</span>
      </button>

      {open && (
        <ProgramDetailSheet
          target={open}
          installedCount={open.kind === 'preset' ? installedOf(open.preset.id) : 0}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  )
}
