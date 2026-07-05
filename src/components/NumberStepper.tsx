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
}

/** Tap-first number input: big +/- targets, tap the value for keyboard entry. */
export default function NumberStepper({ value, onChange, step, min = 0, max = 9999, unit, label }: Props) {
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
          className="flex h-11 w-11 items-center justify-center rounded-xl bg-muted/40 active:bg-muted"
        >
          <Minus size={18} />
        </button>
        {editing ? (
          <input
            autoFocus
            inputMode="decimal"
            defaultValue={display}
            onChange={e => setText(e.target.value)}
            onBlur={commit}
            onKeyDown={e => e.key === 'Enter' && commit()}
            className="num w-16 rounded-lg bg-card py-2 text-center text-base font-semibold"
          />
        ) : (
          <button
            onClick={() => {
              setText(display)
              setEditing(true)
            }}
            className="num min-w-[64px] rounded-lg px-1 py-2 text-center font-display text-xl font-semibold active:bg-muted/40"
          >
            {display}
            {unit && <span className="ml-0.5 text-sm font-normal text-sub">{unit}</span>}
          </button>
        )}
        <button
          onClick={() => onChange(clamp(Math.round((value + step) * 100) / 100))}
          aria-label={`Increase ${label ?? 'value'}`}
          className="flex h-11 w-11 items-center justify-center rounded-xl bg-muted/40 active:bg-muted"
        >
          <Plus size={18} />
        </button>
      </div>
    </div>
  )
}
