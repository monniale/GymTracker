import type { ReactNode } from 'react'

interface Props {
  /** Drawing size in px; also the rendered size unless `boxSize` is given. */
  size?: number
  /** CSS width/height of the ring, e.g. a clamp() so it shrinks on narrow phones. */
  boxSize?: string
  stroke?: number
  progress: number // 0..1 (values > 1 are clamped visually)
  color: string
  children?: ReactNode
}

export default function ProgressRing({ size = 72, boxSize, stroke = 7, progress, color, children }: Props) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const p = Math.min(1, Math.max(0, progress))
  return (
    <div
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: boxSize ?? size, height: boxSize ?? size }}
    >
      <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#2A3442" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - p)}
          className="transition-[stroke-dashoffset] duration-300"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  )
}
