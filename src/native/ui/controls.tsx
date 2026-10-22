import { useState } from 'react'
import { AlertTriangle, BellOff, Loader2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { isHHMM } from '../../lib/notifyPrefs'
import type { HHMM } from '../../lib/notifyPrefs'
import { haptic } from '../haptics'
import { openDeviceSettings } from '../deviceSettings'
import { t } from '../../i18n'

/**
 * Small controls shared by the native-only Settings UI. Layout follows ROUTEMAP invariant 13
 * (360 / 320 px): rows wrap, chips and short buttons are `whitespace-nowrap shrink-0`, time
 * inputs are a fixed `w-[6.5rem]`.
 */

/** Visual switch only; the surrounding button carries role="switch". */
export function Switch({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={`relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors ${
        on ? 'bg-primary' : 'bg-muted'
      }`}
    >
      <span
        className={`absolute left-0.5 h-5 w-5 rounded-full bg-ink shadow transition-transform ${on ? 'translate-x-4' : ''}`}
      />
    </span>
  )
}

/**
 * Switch + label (+ hint) as one 44 px tap target. Grows to fill its row; `basis` is the width
 * below which a trailing control (e.g. a TimeInput) wraps onto its own line.
 */
export function SwitchRow({
  label,
  hint,
  on,
  onChange,
  disabled,
  basis = 'basis-40',
}: {
  label: string
  hint?: React.ReactNode
  on: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  basis?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => {
        haptic('tap')
        onChange(!on)
      }}
      className={`flex min-h-[44px] min-w-0 flex-1 items-center gap-2.5 py-1 text-left disabled:opacity-40 ${basis}`}
    >
      <Switch on={on} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold leading-tight">{label}</span>
        {hint && <span className="mt-0.5 block text-xs leading-snug text-sub">{hint}</span>}
      </span>
    </button>
  )
}

/** Two-option segment (title + short subtitle per option), like the rest-alert sound picker. */
export function Segment<T extends string>({
  value,
  options,
  onChange,
  label,
  bg = 'bg-card',
}: {
  value: T
  options: { value: T; title: string; sub: string }[]
  onChange: (v: T) => void
  label: string
  /** Track colour: `bg-card` inside surface cards, `bg-surface` directly in a Settings section. */
  bg?: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className={`grid grid-cols-2 gap-1 rounded-xl p-1 ${bg}`}>
      {options.map(o => {
        const active = value === o.value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={`min-h-[44px] min-w-0 rounded-lg px-2 py-1 text-center ${
              active ? 'bg-primary/15 text-primary' : 'text-sub active:bg-muted/40'
            }`}
          >
            <span className="block whitespace-nowrap text-sm font-semibold">{o.title}</span>
            <span className="block truncate text-xs opacity-80">{o.sub}</span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * `<input type="time">` in 5-minute steps; ignores partial / cleared values. Tapping it opens
 * Android's time picker; the desktop clock icon is hidden so a 12 h "06:00 PM" fits 6.5rem.
 */
export function TimeInput({
  value,
  onChange,
  label,
  disabled,
  className = 'w-[6.5rem]',
}: {
  value: HHMM
  onChange: (v: HHMM) => void
  label: string
  disabled?: boolean
  className?: string
}) {
  return (
    <input
      type="time"
      step={300}
      value={value}
      aria-label={label}
      disabled={disabled}
      onChange={e => {
        const v = e.target.value.slice(0, 5)
        if (isHHMM(v)) onChange(v)
      }}
      className={`num min-h-[40px] shrink-0 rounded-lg bg-card px-2 text-base [color-scheme:dark] disabled:opacity-40 [&::-webkit-calendar-picker-indicator]:hidden ${className}`}
    />
  )
}

/** A compact `<select>` matching TimeInput. */
export function Select<T extends string | number>({
  value,
  options,
  onChange,
  label,
  disabled,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  label: string
  disabled?: boolean
}) {
  return (
    <select
      value={String(value)}
      aria-label={label}
      disabled={disabled}
      onChange={e => {
        const hit = options.find(o => String(o.value) === e.target.value)
        if (hit) onChange(hit.value)
      }}
      className="min-h-[40px] min-w-0 max-w-full shrink-0 rounded-lg bg-card px-2 text-base [color-scheme:dark] disabled:opacity-40"
    >
      {options.map(o => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

/** Runs one async action at a time; `busy` disables its button, errors are swallowed. */
export function useAction(): [boolean, (fn: () => Promise<unknown>) => void] {
  const [busy, setBusy] = useState(false)
  const run = (fn: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true)
    void fn()
      .catch(() => {})
      .finally(() => setBusy(false))
  }
  return [busy, run]
}

/** Short pill button for row actions ("Allow", "Open", "Fix"). */
export function ActionButton({
  children,
  onClick,
  tone = 'primary',
  icon: Icon,
}: {
  children: React.ReactNode
  onClick: () => Promise<unknown> | void
  tone?: 'primary' | 'quiet' | 'danger'
  icon?: LucideIcon
}) {
  const [busy, run] = useAction()
  const cls = {
    primary: 'bg-primary/15 text-primary active:bg-primary/30',
    quiet: 'bg-muted/40 text-ink active:bg-muted',
    danger: 'bg-danger/15 text-danger active:bg-danger/25',
  }[tone]
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => run(async () => onClick())}
      className={`flex min-h-[36px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-sm font-semibold disabled:opacity-50 ${cls}`}
    >
      {busy ? <Loader2 size={14} className="animate-spin" /> : Icon && <Icon size={14} />}
      {children}
    </button>
  )
}

/** Red row: what is broken, why it matters, how to fix it. */
export function IssueRow({
  title,
  hint,
  children,
  tone = 'danger',
}: {
  title: string
  hint?: React.ReactNode
  children?: React.ReactNode
  tone?: 'danger' | 'info'
}) {
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2.5 ${
        tone === 'danger' ? 'bg-danger/10' : 'bg-surface'
      }`}
    >
      <div className="flex min-w-0 flex-1 basis-40 items-start gap-2">
        <AlertTriangle size={16} className={`mt-0.5 shrink-0 ${tone === 'danger' ? 'text-danger' : 'text-sub'}`} />
        <div className="min-w-0">
          <p className={`text-sm font-semibold leading-tight ${tone === 'danger' ? 'text-danger' : ''}`}>{title}</p>
          {hint && <p className="mt-0.5 text-xs leading-snug text-sub">{hint}</p>}
        </div>
      </div>
      {children && <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>}
    </div>
  )
}

/** "Muted in Android · Open" chip → that channel's system settings page. */
export function MutedChip({ channelId, label }: { channelId: string; label?: string }) {
  const [busy, run] = useAction()
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => run(() => openDeviceSettings('channel', channelId))}
      className="flex min-h-[32px] shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-danger/15 px-2.5 text-xs font-semibold text-danger active:bg-danger/25 disabled:opacity-50"
    >
      <BellOff size={12} /> {label ?? t('native.controls.mutedInAndroid')} · {t('native.actions.open')}
    </button>
  )
}
