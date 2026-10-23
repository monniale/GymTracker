import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Plus, Trash2 } from 'lucide-react'
import Sheet from '../../components/Sheet'
import NumberStepper from '../../components/NumberStepper'
import { db } from '../../db/db'
import { deriveTrainingMax } from '../../lib/prescription'
import { t } from '../../i18n'
import type { Exercise, PrescribedSet, ProgressionScheme, TemplateItem } from '../../types'

type Kind = 'double' | 'linear' | 'percent'
type Stage = { sets: number; reps: number; amrapLast?: boolean }

const DEFAULT_PCT_SETS: PrescribedSet[] = [
  { pct: 0.65, reps: 5 },
  { pct: 0.75, reps: 5 },
  { pct: 0.85, reps: 5, amrap: true },
]

const pctOf = (s: PrescribedSet) => Math.round((s.pct ?? 0) * 1000) / 10
const clone = (sets: PrescribedSet[]) => sets.map(s => ({ ...s }))

/** Chip button: never wraps or shrinks (invariant 13); rows of them sit in a flex-wrap line. */
export function chipCls(active: boolean): string {
  return `flex min-h-[32px] shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 text-xs font-semibold ${
    active ? 'border-primary/40 bg-primary/15 text-primary' : 'border-edge bg-bg text-sub'
  }`
}

interface Props {
  item: TemplateItem
  exercise?: Exercise
  onClose: () => void
  /** The whole new item (keys left out are removed) and the exercise's new training max, if changed. */
  onSave: (item: TemplateItem, trainingMaxKg?: number) => void
}

/**
 * Pick a template item's progression scheme (src/lib/prescription.ts) and edit its numbers:
 * linear step / fails before a deload / deload size / optional stages (GZCLP); percent of the
 * training max with a per-set plan, constant or per week (5/3/1). Mounted only while open, so the
 * draft starts from the item each time. `rpe` is reserved and not offered.
 */
export default function SchemeSheet({ item, exercise, onClose, onSave }: Props) {
  const scheme = item.scheme
  const initialKind: Kind = scheme?.kind === 'linear' || scheme?.kind === 'percent' ? scheme.kind : 'double'
  const [kind, setKind] = useState<Kind>(initialKind)

  const lin = scheme?.kind === 'linear' ? scheme : undefined
  const [stepKg, setStepKg] = useState(lin?.stepKg ?? exercise?.progressionStepKg ?? 2.5)
  const [failsToDeload, setFailsToDeload] = useState(lin?.failsToDeload ?? 3)
  const [deloadPct, setDeloadPct] = useState(Math.round((lin?.deloadPct ?? 0.1) * 100))
  const [stages, setStages] = useState<Stage[] | undefined>(lin?.stages?.map(s => ({ ...s })))

  const pct = scheme?.kind === 'percent' ? scheme : undefined
  const [tmStepKg, setTmStepKg] = useState(pct?.tmStepKg ?? 2.5)
  const [byWeek, setByWeek] = useState<PrescribedSet[][] | undefined>(item.setsByWeek?.map(clone))
  const [sets, setSets] = useState<PrescribedSet[]>(clone(item.sets?.length ? item.sets : DEFAULT_PCT_SETS))
  const [week, setWeek] = useState(0)
  const [tm, setTm] = useState(exercise?.trainingMaxKg ?? 0)

  const exId = exercise?.id
  const history = useLiveQuery(
    async () => (exId === undefined ? [] : db.sets.where('[exerciseId+completedAt]').between([exId, 0], [exId, Infinity]).toArray()),
    [exId],
  )
  const derived = history && kind === 'percent' ? deriveTrainingMax(history) : undefined

  const kindChanged = kind !== initialKind
  const curSets = byWeek ? byWeek[Math.min(week, byWeek.length - 1)] : sets
  const setCurSets = (next: PrescribedSet[]) => {
    if (byWeek) setByWeek(byWeek.map((w, i) => (i === Math.min(week, byWeek.length - 1) ? next : w)))
    else setSets(next)
  }

  function save() {
    const {
      scheme: _s, sets: _sets, setsByWeek: _w, progress: _p, ...base
    } = item
    const next: TemplateItem = { ...base }
    let nextScheme: ProgressionScheme | undefined
    if (kind === 'linear') {
      nextScheme = { kind: 'linear', stepKg, failsToDeload, deloadPct: deloadPct / 100, ...(stages?.length ? { stages } : {}) }
    } else if (kind === 'percent') {
      nextScheme = {
        kind: 'percent', basis: 'tm', tmStepKg,
        ...(pct?.tmBumpByReps ? { tmBumpByReps: pct.tmBumpByReps } : {}),
      }
      if (byWeek?.length) next.setsByWeek = byWeek
      else next.sets = sets
      next.targetSets = (byWeek?.[0] ?? sets).length || next.targetSets
    } else if (scheme?.kind === 'rpe') {
      nextScheme = scheme
    }
    if (nextScheme) next.scheme = nextScheme
    // A non-percent scheme keeps an explicit plan only when it has no percentages.
    if (kind !== 'percent') {
      if (_sets?.length && !_sets.some(s => s.pct !== undefined)) next.sets = _sets
      if (_w?.length && !_w.some(w => w.some(s => s.pct !== undefined))) next.setsByWeek = _w
    }
    // Same scheme kind: keep the progression state; a new kind starts fresh.
    if (_p && !kindChanged) next.progress = _p
    const tmChanged = kind === 'percent' && tm > 0 && tm !== (exercise?.trainingMaxKg ?? 0)
    onSave(next, tmChanged ? tm : undefined)
    onClose()
  }

  const KINDS: { k: Kind; label: string }[] = [
    { k: 'double', label: t('programs.schemeSheet.double') },
    { k: 'linear', label: t('programs.schemeSheet.linear') },
    { k: 'percent', label: t('programs.schemeSheet.percent') },
  ]

  return (
    <Sheet open onClose={onClose} title={t('programs.schemeSheet.title')}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-muted/30 p-1" role="radiogroup" aria-label={t('programs.schemeSheet.title')}>
          {KINDS.map(({ k, label }) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => setKind(k)}
              className={`min-h-[40px] min-w-0 truncate rounded-lg px-1 text-sm font-semibold ${
                kind === k ? 'bg-card text-ink shadow' : 'text-sub'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <p className="text-sm text-sub">
          {kind === 'double' ? t('programs.schemeSheet.doubleHint')
            : kind === 'linear' ? t('programs.schemeSheet.linearHint')
              : t('programs.schemeSheet.percentHint')}
        </p>

        {kind === 'linear' && (
          <>
            <div className="flex flex-wrap items-end justify-around gap-x-1 gap-y-2">
              <NumberStepper compact label={t('programs.schemeSheet.stepKg')} value={stepKg} onChange={setStepKg} step={0.5} min={0.5} max={25} unit="kg" />
              <NumberStepper compact label={t('programs.schemeSheet.failsToDeload')} value={failsToDeload} onChange={v => setFailsToDeload(Math.round(v))} step={1} min={1} max={10} />
              <NumberStepper compact label={t('programs.schemeSheet.deloadPct')} value={deloadPct} onChange={v => setDeloadPct(Math.round(v))} step={5} min={5} max={50} unit="%" />
            </div>
            <p className="text-xs text-sub">{t('programs.schemeSheet.deloadHint', { n: failsToDeload, pct: deloadPct })}</p>

            <div>
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  aria-pressed={!!stages}
                  onClick={() => setStages(stages ? undefined : [{ sets: item.targetSets, reps: item.targetReps }])}
                  className={chipCls(!!stages)}
                >
                  {t('programs.schemeSheet.stages')}
                </button>
              </div>
              {stages && (
                <div className="space-y-2">
                  <p className="text-xs text-sub">{t('programs.schemeSheet.stagesHint')}</p>
                  {stages.map((st, i) => (
                    <div key={i} className="rounded-xl border border-edge p-2">
                      <div className="mb-1 flex flex-wrap items-center gap-1.5">
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{t('programs.schemeSheet.stageN', { n: i + 1 })}</span>
                        <button
                          type="button"
                          aria-pressed={!!st.amrapLast}
                          onClick={() => setStages(stages.map((s, j) => (j === i ? { sets: s.sets, reps: s.reps, ...(s.amrapLast ? {} : { amrapLast: true }) } : s)))}
                          className={chipCls(!!st.amrapLast)}
                        >
                          {t('programs.schemeSheet.lastAmrap')}
                        </button>
                        {stages.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setStages(stages.filter((_, j) => j !== i))}
                            aria-label={t('programs.schemeSheet.removeStage', { n: i + 1 })}
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-danger active:bg-muted/40"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                      <div className="flex flex-wrap items-end justify-around gap-x-1 gap-y-2">
                        <NumberStepper compact label={t('programs.schemeSheet.sets')} value={st.sets} onChange={v => setStages(stages.map((s, j) => (j === i ? { ...s, sets: Math.round(v) } : s)))} step={1} min={1} max={15} />
                        <NumberStepper compact label={t('programs.schemeSheet.reps')} value={st.reps} onChange={v => setStages(stages.map((s, j) => (j === i ? { ...s, reps: Math.round(v) } : s)))} step={1} min={1} max={30} />
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setStages([...stages, { ...stages[stages.length - 1] }])}
                    className="flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-edge text-sm font-medium text-sub active:bg-muted/30"
                  >
                    <Plus size={16} /> {t('programs.schemeSheet.addStage')}
                  </button>
                </div>
              )}
            </div>
          </>
        )}

        {kind === 'percent' && (
          <>
            <div className="flex flex-wrap items-end justify-around gap-x-1 gap-y-2">
              <NumberStepper compact label={t('programs.schemeSheet.trainingMax')} value={tm} onChange={setTm} step={2.5} min={0} max={500} unit="kg" />
              <NumberStepper compact label={t('programs.schemeSheet.tmStepKg')} value={tmStepKg} onChange={setTmStepKg} step={0.5} min={0} max={25} unit="kg" />
            </div>
            {derived !== undefined && derived !== tm && (
              <button
                type="button"
                onClick={() => setTm(derived)}
                className="flex min-h-[40px] w-full items-center justify-center rounded-xl bg-muted/40 px-3 text-center text-sm font-semibold active:bg-muted"
              >
                {t('programs.schemeSheet.useBest', { kg: derived })}
              </button>
            )}
            {pct?.tmBumpByReps && <p className="text-xs text-sub">{t('programs.schemeSheet.bumpTable')}</p>}

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                aria-pressed={!!byWeek}
                onClick={() => {
                  if (byWeek) {
                    setSets(clone(byWeek[0] ?? DEFAULT_PCT_SETS))
                    setByWeek(undefined)
                  } else {
                    setByWeek([clone(sets)])
                  }
                  setWeek(0)
                }}
                className={chipCls(!!byWeek)}
              >
                {t('programs.schemeSheet.byWeek')}
              </button>
            </div>

            {byWeek && (
              <div className="flex flex-wrap items-center gap-1.5" role="tablist">
                {byWeek.map((_, i) => (
                  <button key={i} type="button" role="tab" aria-selected={i === week} onClick={() => setWeek(i)} className={chipCls(i === week)}>
                    {t('programs.schemeSheet.weekN', { n: i + 1 })}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setByWeek([...byWeek, clone(curSets)])
                    setWeek(byWeek.length)
                  }}
                  aria-label={t('programs.schemeSheet.addWeek')}
                  className={chipCls(false)}
                >
                  <Plus size={14} />
                </button>
                {byWeek.length > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      setByWeek(byWeek.filter((_, i) => i !== week))
                      setWeek(Math.max(0, week - 1))
                    }}
                    aria-label={t('programs.schemeSheet.removeWeek', { n: week + 1 })}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-danger active:bg-muted/40"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            )}

            <PctSetsEditor sets={curSets} onChange={setCurSets} />
          </>
        )}

        {kindChanged && item.progress && <p className="text-xs text-sub">{t('programs.schemeSheet.resetsProgress')}</p>}

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="min-h-[48px] flex-1 rounded-xl bg-muted/40 font-semibold active:bg-muted">
            {t('common.cancel')}
          </button>
          <button onClick={save} className="min-h-[48px] flex-1 rounded-xl bg-primary font-display text-lg font-bold text-bg active:opacity-90">
            {t('common.save')}
          </button>
        </div>
      </div>
    </Sheet>
  )
}

/** One week's sets: % of TM and reps per set, AMRAP flag. Two compact steppers fit 320 px. */
function PctSetsEditor({ sets, onChange }: { sets: PrescribedSet[]; onChange: (s: PrescribedSet[]) => void }) {
  const patch = (i: number, p: Partial<PrescribedSet>) => onChange(sets.map((s, j) => (j === i ? { ...s, ...p } : s)))
  return (
    <div className="space-y-2">
      {sets.map((s, i) => (
        <div key={i} className="rounded-xl border border-edge p-2">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{t('programs.schemeSheet.setN', { n: i + 1 })}</span>
            <button
              type="button"
              aria-pressed={!!s.amrap}
              onClick={() => {
                const { amrap: _a, ...rest } = s
                onChange(sets.map((x, j) => (j === i ? (s.amrap ? rest : { ...rest, amrap: true }) : x)))
              }}
              className={chipCls(!!s.amrap)}
            >
              {t('programs.schemeSheet.amrap')}
            </button>
            {sets.length > 1 && (
              <button
                type="button"
                onClick={() => onChange(sets.filter((_, j) => j !== i))}
                aria-label={t('programs.schemeSheet.removeSet', { n: i + 1 })}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-danger active:bg-muted/40"
              >
                <Trash2 size={16} />
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-end justify-around gap-x-1 gap-y-2">
            <NumberStepper compact label={t('programs.schemeSheet.pct')} value={pctOf(s)} onChange={v => patch(i, { pct: Math.round(v * 10) / 1000 })} step={2.5} min={20} max={110} unit="%" />
            <NumberStepper compact label={t('programs.schemeSheet.reps')} value={s.reps} onChange={v => patch(i, { reps: Math.round(v) })} step={1} min={1} max={30} />
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={() => {
          const last = sets[sets.length - 1] ?? DEFAULT_PCT_SETS[0]
          onChange([...sets, { ...(last.pct !== undefined ? { pct: last.pct } : {}), reps: last.reps }])
        }}
        className="flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-edge text-sm font-medium text-sub active:bg-muted/30"
      >
        <Plus size={16} /> {t('programs.schemeSheet.addSet')}
      </button>
    </div>
  )
}
