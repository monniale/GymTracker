/**
 * Single-choice segmented control (web + native), styled like the native settings `Segment`.
 * Options wrap onto a second line on narrow phones instead of squeezing their labels.
 */
export default function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  ariaLabel: string
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="flex flex-wrap gap-1 rounded-xl border border-edge bg-card p-1">
      {options.map(o => {
        const active = value === o.value
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={`min-h-[44px] flex-1 whitespace-nowrap rounded-lg px-3 py-1 text-center text-sm font-semibold ${
              active ? 'bg-primary/15 text-primary' : 'text-sub active:bg-muted/40'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
