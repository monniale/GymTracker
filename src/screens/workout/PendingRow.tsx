import { useEffect, useRef, useState } from 'react'
import { Check, Sparkles } from 'lucide-react'
import { SCORING } from '../../lib/scoring'
import type { ProgressionSuggestion } from '../../lib/progression'
import { fmtCardioSet, type CardioDraft } from '../../lib/cardio'
import { fmtSetLoad } from '../../lib/load'
import NumberStepper from '../../components/NumberStepper'
import { t, fmtNum } from '../../i18n'

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
  platesFor: (w: number) => string | null
  onLog: (weightKg: number, reps: number, isWarmup: boolean) => void
}

export function PendingRow({
  setNumber, initWeight, initReps, bodyweightKg, bodyweightLoad = false, loadOf, suggestion, aiFilled, platesFor, onLog,
}: PendingProps) {
  const [weight, setWeight] = useState(initWeight)
  const [reps, setReps] = useState(initReps)
  const [expanded, setExpanded] = useState(false)
  const [warmup, setWarmup] = useState(false)
  const [confirmHeavy, setConfirmHeavy] = useState(false)

  // Once the user edits a field, async-arriving prefill/AI values must not clobber
  // it — so we only re-seed fields the user hasn't touched (F2 "auto-fill untouched").
  const touchedW = useRef(false)
  const touchedR = useRef(false)
  const editWeight = (v: number) => { touchedW.current = true; setWeight(v) }
  const editReps = (v: number) => { touchedR.current = true; setReps(v) }
  useEffect(() => { if (!touchedW.current) setWeight(initWeight) }, [initWeight])
  useEffect(() => { if (!touchedR.current) setReps(initReps) }, [initReps])

  const tooHeavy = (loadOf ? loadOf(weight) : weight) > bodyweightKg * SCORING.maxWeightBwMult
  const showSuggestion =
    suggestion !== null && (suggestion.weightKg !== weight || suggestion.reps !== reps)
  // No plates on a bodyweight exercise; an assisted set (machine/band) can go down to -bodyweight.
  const plateHint = expanded && !bodyweightLoad ? platesFor(weight) : null
  const minWeight = bodyweightLoad ? -Math.floor(bodyweightKg) : 0

  function submit() {
    if (reps <= 0) return
    if (tooHeavy && !confirmHeavy) {
      setConfirmHeavy(true)
      return
    }
    onLog(weight, reps, warmup)
  }

  return (
    <div className="rounded-xl border border-primary/40 bg-surface px-3 py-2">
      {showSuggestion && (
        <button
          onClick={() => {
            editWeight(suggestion.weightKg)
            editReps(suggestion.reps)
          }}
          className="num mb-1.5 flex items-center gap-1 rounded-full bg-primary/15 px-2.5 py-1 text-xs font-bold text-primary active:bg-primary/30"
        >
          ↑ {bodyweightLoad ? fmtSetLoad(suggestion, true) : `${fmtNum(suggestion.weightKg)} kg × ${suggestion.reps}`}
          <span className="font-medium opacity-70">
            {suggestion.reason === 'weight-up' ? t('workout.pending.newWeight') : t('workout.pending.oneMoreRep')}
          </span>
        </button>
      )}
      {aiFilled && !showSuggestion && (
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
          {bodyweightLoad
            ? <NoBreakParts text={fmtSetLoad({ weightKg: weight, reps }, true)} />
            : `${weight > 0 ? `${fmtNum(weight)} kg` : '— kg'} × ${reps}`}
        </button>
        <button
          onClick={() => setWarmup(w => !w)}
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
function NoBreakParts({ text }: { text: string }) {
  const i = text.lastIndexOf(' × ')
  if (i < 0) return <>{text}</>
  return (
    <>
      <span className="whitespace-nowrap">{text.slice(0, i)}</span>{' '}
      <span className="whitespace-nowrap">{text.slice(i + 1)}</span>
    </>
  )
}
