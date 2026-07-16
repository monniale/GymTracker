import { useState } from 'react'
import { Minus, Plus } from 'lucide-react'

interface Props {
  value: number
  onChange: (v: number) => void
  step: number
  min?: number
  max?: number
  unit?: string
  label?: string
  /** Smaller touch targets for rows of 3+ steppers on narrow phones. */
  compact?: boolean
}

/** Tap-first number input: big +/- targets, tap the value for keyboard entry. */
export default function NumberStepper({ value, onChange, step, min = 0, max = 9999, unit, label, compact }: Props) {
  const btnCls = compact
    ? 'flex h-9 w-9 items-center justify-center rounded-lg bg-muted/40 active:bg-muted'
    : 'flex h-11 w-11 items-center justify-center rounded-xl bg-muted/40 active:bg-muted'
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')

  const clamp = (v: number) => Math.min(max, Math.max(min, v))
  const commit = () => {
    const parsed = parseFloat(text.replace(',', '.'))
    if (Number.isFinite(parsed)) onChange(clamp(parsed))
    setEditing(false)
  }
  const display = Number.isInteger(value) ? String(value) : value.toFixed(1)

  return (
    <div className="flex flex-col items-center gap-1">
      {label && <span className="text-xs font-medium uppercase tracking-wide text-sub">{label}</span>}
      <div className="flex items-center gap-1">
        <button
          onClick={() => onChange(clamp(Math.round((value - step) * 100) / 100))}
          aria-label={`Decrease ${label ?? 'value'}`}
          className={btnCls}
        >
          <Minus size={compact ? 16 : 18} />
        </button>
        {editing ? (
          <input
            autoFocus
            inputMode="decimal"
            defaultValue={display}
            onFocus={e => e.target.select()}
            onChange={e => setText(e.target.value)}
            onBlur={commit}
            onKeyDown={e => e.key === 'Enter' && commit()}
            className={`num rounded-lg bg-card py-2 text-center text-base font-semibold ${compact ? 'w-12' : 'w-16'}`}
          />
        ) : (
          <button
            onClick={() => {
              setText(display)
              setEditing(true)
            }}
            className={`num rounded-lg py-2 text-center font-display font-semibold active:bg-muted/40 ${
              compact ? 'min-w-[44px] px-0.5 text-lg' : 'min-w-[64px] px-1 text-xl'
            }`}
          >
            {display}
            {unit && <span className="ml-0.5 text-sm font-normal text-sub">{unit}</span>}
          </button>
        )}
        <button
          onClick={() => onChange(clamp(Math.round((value + step) * 100) / 100))}
          aria-label={`Increase ${label ?? 'value'}`}
          className={btnCls}
        >
          <Plus size={compact ? 16 : 18} />
        </button>
      </div>
    </div>
  )
}
