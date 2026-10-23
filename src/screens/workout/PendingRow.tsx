import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, Sparkles } from 'lucide-react'
import { SCORING } from '../../lib/scoring'
import type { ProgressionSuggestion } from '../../lib/progression'
import { fmtCardioSet, type CardioDraft } from '../../lib/cardio'
import { fmtSetLoad } from '../../lib/load'
import { SET_TYPES, fmtEffort, rirOf, setKind, setTypeBadge, setTypeLabel, type SetKind } from '../../lib/setTypes'
import { useUiStore } from '../../lib/uiStore'
import type { SetRow } from '../../types'
import NumberStepper from '../../components/NumberStepper'
import { t, fmtNum } from '../../i18n'

/** A set type other than warm-up (`isWarmup`) and working (stored as no `setType`). */
export type ExtraSetType = Exclude<SetKind, 'warmup' | 'working'>

/** Effort and set type logged with a set; both absent means a plain working set. */
export interface LogExtra {
  rpe?: number
  setType?: ExtraSetType
}

export interface PendingProps {
  setNumber: number
  initWeight: number
  initReps: number
  bodyweightKg: number
  /** Bodyweight exercise on a stamped session: the weight is ADDED kg, negative = assisted. */
  bodyweightLoad?: boolean
  /** The load the set scores with (lib/load.ts effectiveLoad); defaults to the weight itself. */
  loadOf?: (weightKg: number) => number
  suggestion: ProgressionSuggestion | null
  /** This row's opening values came from the AI plan (F2). */
  aiFilled?: boolean
  /** The program prescribes this set as AMRAP: reps show as "5+" and the set logs as 'amrap'
   * unless the user picks another type. */
  amrap?: boolean
  /** The program's prescription label (src/lib/prescription.ts), shown in place of the suggestion chip. */
  schemeLabel?: string
  platesFor: (w: number) => string | null
  onLog: (weightKg: number, reps: number, isWarmup: boolean, extra: LogExtra) => void
}

export function PendingRow({
  setNumber, initWeight, initReps, bodyweightKg, bodyweightLoad = false, loadOf, suggestion, aiFilled, amrap = false,
  schemeLabel, platesFor, onLog,
}: PendingProps) {
  const [weight, setWeight] = useState(initWeight)
  const [reps, setReps] = useState(initReps)
  const [expanded, setExpanded] = useState(false)
  const [warmup, setWarmup] = useState(false)
  const [confirmHeavy, setConfirmHeavy] = useState(false)
  // Effort and type start empty on every row (no carry-over): the row remounts after each log.
  // A prescribed AMRAP set starts as 'amrap'.
  const [rpe, setRpe] = useState<number | undefined>(undefined)
  const [setType, setSetType] = useState<ExtraSetType | undefined>(amrap ? 'amrap' : undefined)
  const scale = useUiStore(s => s.effortScale)

  // Once the user edits a field, async-arriving prefill/AI values must not clobber
  // it — so we only re-seed fields the user hasn't touched (F2 "auto-fill untouched").
  const touchedW = useRef(false)
  const touchedR = useRef(false)
  const editWeight = (v: number) => { touchedW.current = true; setWeight(v) }
  const editReps = (v: number) => { touchedR.current = true; setReps(v) }
  useEffect(() => { if (!touchedW.current) setWeight(initWeight) }, [initWeight])
  useEffect(() => { if (!touchedR.current) setReps(initReps) }, [initReps])
  // The prescription can arrive after mount (history loads async): follow it until the user picks a type.
  const touchedT = useRef(false)
  const pickType = (v: ExtraSetType | undefined) => { touchedT.current = true; setSetType(v) }
  useEffect(() => { if (!touchedT.current) setSetType(amrap ? 'amrap' : undefined) }, [amrap])

  const tooHeavy = (loadOf ? loadOf(weight) : weight) > bodyweightKg * SCORING.maxWeightBwMult
  // A 'hold' suggestion is advice (last time was near max effort), so it shows even when the row already matches.
  const showSuggestion =
    suggestion !== null && (suggestion.reason === 'hold' || suggestion.weightKg !== weight || suggestion.reps !== reps)
  // No plates on a bodyweight exercise; an assisted set (machine/band) can go down to -bodyweight.
  const plateHint = expanded && !bodyweightLoad ? platesFor(weight) : null
  const minWeight = bodyweightLoad ? -Math.floor(bodyweightKg) : 0

  function submit() {
    if (reps <= 0) return
    if (tooHeavy && !confirmHeavy) {
      setConfirmHeavy(true)
      return
    }
    onLog(weight, reps, warmup, { rpe, setType: warmup ? undefined : setType })
  }
  const kind = setKind({ isWarmup: warmup, setType })
  const repsPlus = kind === 'amrap' ? '+' : ''

  return (
    <div className="rounded-xl border border-primary/40 bg-surface px-3 py-2">
      {showSuggestion && (
        <button
          onClick={() => {
            editWeight(suggestion.weightKg)
            editReps(suggestion.reps)
          }}
          className="num mb-1.5 flex flex-wrap items-center gap-x-1 rounded-xl bg-primary/15 px-2.5 py-1 text-left text-xs font-bold text-primary active:bg-primary/30"
        >
          {/* Load and reason each stay whole; at 320 px the reason drops to its own line. */}
          <span className="whitespace-nowrap">
            {suggestion.reason === 'hold' ? '=' : '↑'} {bodyweightLoad ? fmtSetLoad(suggestion, true) : `${fmtNum(suggestion.weightKg)} kg × ${suggestion.reps}`}
          </span>
          <span className="whitespace-nowrap font-medium opacity-70">
            {suggestion.reason === 'weight-up'
              ? t('workout.pending.newWeight')
              : suggestion.reason === 'hold' ? t('workout.pending.hold') : t('workout.pending.oneMoreRep')}
          </span>
        </button>
      )}
      {schemeLabel && !showSuggestion && (
        <p className="mb-1.5 flex min-w-0">
          <span className="num max-w-full truncate rounded-xl bg-primary/15 px-2.5 py-1 text-xs font-bold text-primary">
            {schemeLabel}
          </span>
        </p>
      )}
      {aiFilled && !showSuggestion && !schemeLabel && (
        <p className="mb-1.5 flex items-center gap-1 text-xs font-semibold text-primary">
          <Sparkles size={12} /> {t('workout.pending.aiSuggested')}
        </p>
      )}
      <div className="flex items-center gap-2">
        <span className="num w-6 text-sm font-semibold text-primary">{setNumber}</span>
        <button
          onClick={() => setExpanded(x => !x)}
          className="num flex-1 py-1 text-left font-display text-xl font-bold active:opacity-70"
          aria-label={t('workout.pending.adjust')}
        >
          {/* An AMRAP set reads "× 5+" (reps = the minimum) instead of carrying the A badge. */}
          {bodyweightLoad
            ? <NoBreakParts text={`${fmtSetLoad({ weightKg: weight, reps }, true)}${repsPlus}`} />
            : `${weight > 0 ? `${fmtNum(weight)} kg` : '— kg'} × ${reps}${repsPlus}`}
          <SetBadges set={{ isWarmup: warmup, setType: setType === 'amrap' ? undefined : setType, rpe }} scale={scale} />
        </button>
        <button
          onClick={() => {
            // Warm-up is its own kind: turning it on drops a chosen drop/failure/AMRAP type.
            if (!warmup) pickType(undefined)
            setWarmup(w => !w)
          }}
          aria-label={t('workout.pending.toggleWarmup')}
          aria-pressed={warmup}
          className={`flex h-10 w-10 items-center justify-center rounded-lg text-sm font-bold ${
            warmup ? 'bg-muted text-ink' : 'bg-muted/30 text-sub'
          }`}
        >
          W
        </button>
        <button
          onClick={submit}
          aria-label={t('workout.pending.logSet')}
          className="flex h-12 w-14 items-center justify-center rounded-xl bg-primary text-bg active:opacity-90"
        >
          <Check size={26} strokeWidth={3} />
        </button>
      </div>
      {expanded && (
        <div className="mt-2 border-t border-edge/50 pt-2">
          <div className="flex flex-wrap justify-around gap-2">
            <NumberStepper label="kg" value={weight} onChange={editWeight} step={2.5} min={minWeight} max={600} compact="narrow" />
            <NumberStepper label={t('workout.shared.reps')} value={reps} onChange={editReps} step={1} min={1} max={100} compact="narrow" />
          </div>
          {plateHint && (
            <p className="num mt-1.5 text-center text-xs text-sub">{t('workout.pending.plates', { plates: plateHint })}</p>
          )}
          <EffortChips value={rpe} scale={scale} onChange={setRpe} />
          <SetTypeChips value={kind} disabled={warmup} onChange={pickType} />
        </div>
      )}
      {bodyweightLoad && weight < 0 && (
        <p className="mt-1 text-xs text-sub">{t('workout.pending.assistedHint')}</p>
      )}
      {tooHeavy && (
        <p className="mt-1 text-xs font-medium text-danger">
          {t('workout.pending.tooHeavy', { mult: SCORING.maxWeightBwMult })}
        </p>
      )}
    </div>
  )
}

/** The next cardio row: minutes, seconds and an optional distance. Logging needs some time. */
export interface CardioPendingProps {
  setNumber: number
  init: CardioDraft
  onLog: (d: CardioDraft) => void
}

export function CardioPendingRow({ setNumber, init, onLog }: CardioPendingProps) {
  const [min, setMin] = useState(Math.floor(init.durationSec / 60))
  const [sec, setSec] = useState(init.durationSec % 60)
  const [km, setKm] = useState(init.distanceM / 1000)
  const [expanded, setExpanded] = useState(false)

  // Like PendingRow: late prefill never overwrites what the user already changed.
  const touched = useRef(false)
  const edit = <T,>(set: (v: T) => void) => (v: T) => { touched.current = true; set(v) }
  useEffect(() => {
    if (touched.current) return
    setMin(Math.floor(init.durationSec / 60))
    setSec(init.durationSec % 60)
    setKm(init.distanceM / 1000)
  }, [init.durationSec, init.distanceM])

  const durationSec = min * 60 + sec
  const distanceM = Math.round(km * 1000)

  function submit() {
    if (durationSec <= 0) {
      setExpanded(true)
      return
    }
    onLog({ durationSec, distanceM })
  }

  return (
    <div className="rounded-xl border border-primary/40 bg-surface px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="num w-6 text-sm font-semibold text-primary">{setNumber}</span>
        <button
          onClick={() => setExpanded(x => !x)}
          className="num min-w-0 flex-1 truncate py-1 text-left font-display text-xl font-bold active:opacity-70"
          aria-label={t('workout.pending.adjustCardio')}
        >
          {fmtCardioSet({ durationSec, distanceM })}
        </button>
        <button
          onClick={submit}
          aria-label={t('workout.pending.logCardio')}
          className="flex h-12 w-14 shrink-0 items-center justify-center rounded-xl bg-primary text-bg active:opacity-90"
        >
          <Check size={26} strokeWidth={3} />
        </button>
      </div>
      {expanded && (
        <div className="mt-2 border-t border-edge/50 pt-2">
          <div className="flex flex-wrap justify-around gap-2">
            <NumberStepper label="min" value={min} onChange={edit(setMin)} step={1} min={0} max={600} compact />
            <NumberStepper label="sec" value={sec} onChange={edit(setSec)} step={15} min={0} max={59} compact />
            <NumberStepper label="km" value={km} onChange={edit(setKm)} step={0.1} min={0} max={300} compact />
          </div>
          {durationSec <= 0 && <p className="mt-1 text-xs font-medium text-danger">{t('workout.pending.needTime')}</p>}
        </div>
      )}
    </div>
  )
}

/** "BW−10 kg × 8" that wraps only before "× 8" at 320 px, never inside the load or between × and reps. */
export function NoBreakParts({ text }: { text: string }) {
  const i = text.lastIndexOf(' × ')
  if (i < 0) return <>{text}</>
  return (
    <>
      <span className="whitespace-nowrap">{text.slice(0, i)}</span>{' '}
      <span className="whitespace-nowrap">{text.slice(i + 1)}</span>
    </>
  )
}

/** RPE 6–10 in 0.5 steps, the values the effort chips offer (shown as RIR 4–0 on the RIR scale). */
const RPE_CHOICES = [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10]

/** Effort chips: "—" (none) then RPE 6…10 or RIR 4…0. Tapping the selected chip clears it. Wraps at 320 px. */
export function EffortChips({
  value, scale, onChange,
}: {
  value: number | undefined
  scale: 'rpe' | 'rir'
  onChange: (rpe: number | undefined) => void
}) {
  const label = scale === 'rir' ? t('workout.pending.rir') : t('workout.pending.rpe')
  return (
    <div className="mt-2">
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-sub">{label}</p>
      <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
        <Chip active={value === undefined} onClick={() => onChange(undefined)} ariaLabel={t('workout.pending.effortNoneLabel')}>
          {t('workout.pending.effortNone')}
        </Chip>
        {RPE_CHOICES.map(v => (
          <Chip key={v} active={value === v} onClick={() => onChange(value === v ? undefined : v)}>
            {fmtNum(scale === 'rir' ? rirOf(v) : v)}
          </Chip>
        ))}
      </div>
    </div>
  )
}

/** Set-type chips (Working, Drop, Failure, AMRAP). Disabled while the set is a warm-up. */
export function SetTypeChips({
  value, disabled, onChange,
}: {
  value: SetKind
  disabled: boolean
  onChange: (type: ExtraSetType | undefined) => void
}) {
  const label = t('workout.pending.setType')
  return (
    <div className="mt-2">
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-sub">{label}</p>
      <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
        {SET_TYPES.map(kind => (
          <Chip
            key={kind}
            active={!disabled && value === kind}
            disabled={disabled}
            onClick={() => onChange(kind === 'working' || value === kind ? undefined : kind)}
          >
            {setTypeLabel(kind)}
          </Chip>
        ))}
      </div>
    </div>
  )
}

function Chip({
  active, disabled, onClick, ariaLabel, children,
}: {
  active: boolean
  disabled?: boolean
  onClick: () => void
  ariaLabel?: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      aria-label={ariaLabel}
      className={`num min-h-[36px] min-w-[36px] shrink-0 whitespace-nowrap rounded-lg px-2.5 text-sm font-semibold disabled:opacity-40 ${
        active ? 'bg-primary/15 text-primary' : 'bg-muted/30 text-sub active:bg-muted/50'
      }`}
    >
      {children}
    </button>
  )
}

/** The effort ("@8" / "RIR 2") and type badge (D / F / A) shown after a set's load; nothing for a plain set. */
export function SetBadges({
  set, scale,
}: {
  set: Pick<SetRow, 'isWarmup' | 'setType' | 'rpe'>
  scale: 'rpe' | 'rir'
}) {
  const effort = fmtEffort(set.rpe, scale)
  const kind = setKind(set)
  const badge = setTypeBadge(kind)
  if (!effort && !badge) return null
  return (
    <>
      {effort && <span className="num ml-2 whitespace-nowrap text-sm font-semibold text-sub">{effort}</span>}
      {badge && (
        <span
          title={setTypeLabel(kind)}
          className="ml-1.5 inline-block whitespace-nowrap rounded-md bg-primary/15 px-1.5 align-middle text-xs font-bold text-primary"
        >
          {/* A plain span cannot carry an aria-label: screen readers get the full name, not the letter. */}
          <span aria-hidden="true">{badge}</span>
          <span className="sr-only">{setTypeLabel(kind)}</span>
        </span>
      )}
    </>
  )
}
