import { useEffect, useRef } from 'react'

/** Dependency-free canvas confetti burst; skipped under prefers-reduced-motion. */
export default function Confetti({ fire }: { fire: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!fire) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = window.innerWidth * dpr
    canvas.height = window.innerHeight * dpr

    const colors = ['#F97316', '#22C55E', '#3FC1C9', '#E8B93B', '#E8467C']
    const parts = Array.from({ length: 90 }, () => ({
      x: canvas.width / 2 + (Math.random() - 0.5) * canvas.width * 0.35,
      y: canvas.height * 0.28,
      vx: (Math.random() - 0.5) * 14 * dpr,
      vy: (Math.random() * -13 - 4) * dpr,
      size: (4 + Math.random() * 5) * dpr,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      color: colors[Math.floor(Math.random() * colors.length)],
    }))

    let frame = 0
    let raf = 0
    const gravity = 0.35 * dpr
    const tick = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      for (const p of parts) {
        p.x += p.vx
        p.y += p.vy
        p.vy += gravity
        p.rot += p.vr
        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rot)
        ctx.fillStyle = p.color
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6)
        ctx.restore()
      }
      if (++frame < 110) raf = requestAnimationFrame(tick)
      else ctx.clearRect(0, 0, canvas.width, canvas.height)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [fire])

  if (!fire) return null
  return <canvas ref={ref} data-testid="confetti" className="pointer-events-none fixed inset-0 z-[60] h-full w-full" />
}
