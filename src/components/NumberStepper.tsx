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
  /** Smaller touch targets. `true`: always (rows of 3+ steppers). `'narrow'`:
   * only on phones under 380px wide (360px Androids), where two regular
   * steppers no longer fit side by side; regular size above that. */
  compact?: boolean | 'narrow'
}

const SIZE = {
  regular: { btn: 'h-11 w-11 rounded-xl', value: 'min-w-[64px] px-1 text-xl', input: 'w-16' },
  compact: { btn: 'h-9 w-9 rounded-lg', value: 'min-w-[44px] px-0.5 text-lg', input: 'w-12' },
  narrow: {
    btn: 'h-9 w-9 rounded-lg min-[380px]:h-11 min-[380px]:w-11 min-[380px]:rounded-xl',
    value: 'min-w-[44px] px-0.5 text-lg min-[380px]:min-w-[64px] min-[380px]:px-1 min-[380px]:text-xl',
    input: 'w-12 min-[380px]:w-16',
  },
}

/** Tap-first number input: big +/- targets, tap the value for keyboard entry. */
export default function NumberStepper({ value, onChange, step, min = 0, max = 9999, unit, label, compact }: Props) {
  const size = SIZE[compact === 'narrow' ? 'narrow' : compact ? 'compact' : 'regular']
  const btnCls = `flex shrink-0 items-center justify-center bg-muted/40 active:bg-muted ${size.btn}`
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
      {label && <span className="whitespace-nowrap text-xs font-medium uppercase tracking-wide text-sub">{label}</span>}
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
            className={`num rounded-lg bg-card py-2 text-center text-base font-semibold ${size.input}`}
          />
        ) : (
          <button
            onClick={() => {
              setText(display)
              setEditing(true)
            }}
            className={`num whitespace-nowrap rounded-lg py-2 text-center font-display font-semibold active:bg-muted/40 ${size.value}`}
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
