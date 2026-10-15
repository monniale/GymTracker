import { useEffect, useRef } from 'react'
import type { RankTier } from '../lib/ranks'

/**
 * Canvas particle aura behind a rank emblem. One theme per rank; the sub-tier
 * (III < II < I) scales density. Champion is the showpiece: flames, orbiting
 * sparks, a rotating ray crown and periodic shockwaves. Skipped under
 * prefers-reduced-motion, paused while the page is hidden.
 */

type Kind = 'ember' | 'glint' | 'dust' | 'ice' | 'mote' | 'prism' | 'flame' | 'orbit' | 'ring'

interface P {
  kind: Kind
  x: number
  y: number
  vx: number
  vy: number
  life: number
  max: number
  size: number
  rot: number
  vr: number
  hue: number
  a: number // orbit angle / ring radius base
  r: number // orbit radius
}

interface Theme {
  /** Particle kinds and relative spawn weights. */
  mix: Partial<Record<Kind, number>>
  /** Spawns per second at the lowest sub-tier. */
  rate: number
  /** Colours (hsl hue values or hex). */
  colors: string[]
  rays?: boolean
  rings?: boolean
}

const THEMES: Record<string, Theme> = {
  Copper: { mix: { ember: 1 }, rate: 3, colors: ['#D96B43', '#9A5B3C', '#F2A36B'] },
  Bronze: { mix: { ember: 3, glint: 1 }, rate: 5, colors: ['#E0993A', '#B0762C', '#FFD08A'] },
  Silver: { mix: { glint: 3, dust: 1 }, rate: 6, colors: ['#FFFFFF', '#D9DEE8', '#B8BCC4'] },
  Gold: { mix: { dust: 3, glint: 2 }, rate: 8, colors: ['#FFE08A', '#E8B93B', '#FFF3C4'] },
  Platinum: { mix: { ice: 3, glint: 1 }, rate: 8, colors: ['#9DF3F7', '#3FC1C9', '#E6FDFF'] },
  Emerald: { mix: { mote: 3, orbit: 1 }, rate: 9, colors: ['#7BFFB2', '#3DDC84', '#C8FFE0'] },
  Diamond: { mix: { prism: 3, glint: 2, orbit: 1 }, rate: 11, colors: ['#B9B9FF', '#7F7FD5', '#FFFFFF'] },
  Champion: {
    mix: { flame: 9, ember: 3, orbit: 1 },
    rate: 48,
    colors: ['#FFB02E', '#FF7A18', '#FF4A1C', '#FFD23F'],
    rays: true,
    rings: true,
  },
}

const SUB_SCALE: Record<string, number> = { III: 0.7, II: 1, I: 1.35, '': 1 }

function weighted(mix: Partial<Record<Kind, number>>): Kind {
  const entries = Object.entries(mix) as [Kind, number][]
  let t = Math.random() * entries.reduce((s, [, w]) => s + w, 0)
  for (const [k, w] of entries) if ((t -= w) <= 0) return k
  return entries[0][0]
}

function spawn(kind: Kind, w: number, h: number, theme: Theme): P {
  const cx = w / 2
  const cy = h / 2
  const R = Math.min(w, h) / 2
  const base: P = { kind, x: cx, y: cy, vx: 0, vy: 0, life: 0, max: 60, size: 2, rot: 0, vr: 0, hue: 0, a: 0, r: 0 }
  const around = () => {
    const ang = Math.random() * Math.PI * 2
    const rad = R * (0.25 + Math.random() * 0.6)
    return { x: cx + Math.cos(ang) * rad, y: cy + Math.sin(ang) * rad * 0.9 }
  }
  switch (kind) {
    case 'ember': {
      base.x = cx + (Math.random() - 0.5) * R * 1.1
      base.y = cy + R * (0.2 + Math.random() * 0.5)
      base.vx = (Math.random() - 0.5) * 0.3
      base.vy = -(0.35 + Math.random() * 0.7)
      base.max = 90 + Math.random() * 70
      base.size = 1.2 + Math.random() * 1.8
      return base
    }
    case 'flame': {
      // Born on a ring around the emblem, mostly low and on the sides, licking upward.
      const ang = Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.7 * (Math.random() < 0.8 ? 1 : 1.18)
      const rad = R * (0.5 + Math.random() * 0.28)
      base.x = cx + Math.cos(ang) * rad * 1.05
      base.y = cy + Math.sin(ang) * rad * 0.9
      base.vx = Math.cos(ang) * 0.25 + (Math.random() - 0.5) * 0.35
      base.vy = -(0.55 + Math.random() * 0.95)
      base.max = 46 + Math.random() * 40
      base.size = 4 + Math.random() * 7
      base.a = Math.random() * 6.28
      return base
    }
    case 'glint': {
      Object.assign(base, around())
      base.max = 40 + Math.random() * 40
      base.size = 4 + Math.random() * 6
      base.rot = Math.random() * Math.PI
      base.vr = (Math.random() - 0.5) * 0.04
      return base
    }
    case 'dust': {
      Object.assign(base, around())
      base.vx = (Math.random() - 0.5) * 0.25
      base.vy = -(0.1 + Math.random() * 0.4)
      base.max = 70 + Math.random() * 60
      base.size = 1 + Math.random() * 1.8
      return base
    }
    case 'ice': {
      base.x = cx + (Math.random() - 0.5) * R * 1.8
      base.y = cy - R * (0.7 + Math.random() * 0.3)
      base.vx = (Math.random() - 0.5) * 0.3
      base.vy = 0.3 + Math.random() * 0.55
      base.max = 110 + Math.random() * 50
      base.size = 2 + Math.random() * 3
      base.rot = Math.random() * Math.PI
      base.vr = (Math.random() - 0.5) * 0.05
      return base
    }
    case 'mote': {
      base.x = cx + (Math.random() - 0.5) * R * 1.4
      base.y = cy + R * (0.1 + Math.random() * 0.6)
      base.vy = -(0.25 + Math.random() * 0.5)
      base.a = Math.random() * Math.PI * 2 // sway phase
      base.max = 100 + Math.random() * 70
      base.size = 1.5 + Math.random() * 2.2
      return base
    }
    case 'prism': {
      Object.assign(base, around())
      base.vx = (Math.random() - 0.5) * 0.3
      base.vy = (Math.random() - 0.5) * 0.3
      base.max = 70 + Math.random() * 60
      base.size = 3 + Math.random() * 4
      base.rot = Math.random() * Math.PI
      base.vr = (Math.random() - 0.5) * 0.08
      base.hue = Math.random() * 360
      return base
    }
    case 'orbit': {
      base.a = Math.random() * Math.PI * 2
      base.r = R * (0.72 + Math.random() * 0.25)
      base.vr = (Math.random() < 0.5 ? -1 : 1) * (0.018 + Math.random() * 0.02)
      base.max = 120 + Math.random() * 90
      base.size = 1.6 + Math.random() * 2.2
      return base
    }
    case 'ring': {
      base.max = 70
      base.size = 1
      base.a = R * 0.3
      return base
    }
  }
  void theme
  return base
}

function draw4Star(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, rot: number) {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(rot)
  ctx.beginPath()
  for (let i = 0; i < 8; i++) {
    const r = i % 2 === 0 ? s : s * 0.22
    const a = (i * Math.PI) / 4
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r)
  }
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

function drawParticle(ctx: CanvasRenderingContext2D, p: P, theme: Theme, R: number, cx: number, cy: number) {
  const t = p.life / p.max
  const fade = Math.sin(Math.min(1, Math.max(0, t)) * Math.PI) // in/out
  const color = theme.colors[Math.floor(p.hue + p.size * 7) % theme.colors.length]
  ctx.globalAlpha = Math.max(0, fade)
  ctx.fillStyle = color
  switch (p.kind) {
    case 'flame': {
      // Teardrop tongue: white-hot core fading yellow -> orange -> red as it rises and shrinks.
      const w = p.size * (1 - t * 0.75)
      const h = w * (1.5 + (1 - t) * 0.9)
      const sway = Math.sin(p.life * 0.28 + p.a) * w * 0.45 * t
      const stops = t < 0.25 ? ['#FFD23F', '#FF9A1F'] : t < 0.55 ? ['#FFA11F', '#FF5A14'] : t < 0.8 ? ['#FF5A14', '#D1260F'] : ['#D1260F', '#6E0B0B']
      const g = ctx.createLinearGradient(p.x, p.y, p.x + sway, p.y - h)
      g.addColorStop(0, stops[0])
      g.addColorStop(1, stops[1])
      // Opaque-ish colour, not additive: additive washes flames out to grey-white.
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = Math.min(0.92, (1 - t) * 2.4)
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.moveTo(p.x - w, p.y)
      ctx.quadraticCurveTo(p.x - w * 1.05, p.y - h * 0.45, p.x + sway, p.y - h)
      ctx.quadraticCurveTo(p.x + w * 1.05, p.y - h * 0.45, p.x + w, p.y)
      ctx.quadraticCurveTo(p.x, p.y + w * 0.6, p.x - w, p.y)
      ctx.fill()
      // Hot core, additive.
      ctx.globalCompositeOperation = 'lighter'
      ctx.globalAlpha = Math.max(0, 0.55 - t) * 0.9
      ctx.fillStyle = '#FFE9A0'
      ctx.beginPath()
      ctx.ellipse(p.x, p.y - h * 0.22, w * 0.38, h * 0.3, 0, 0, Math.PI * 2)
      ctx.fill()
      break
    }
    case 'glint':
      draw4Star(ctx, p.x, p.y, p.size * (0.5 + fade), p.rot)
      break
    case 'ice':
      draw4Star(ctx, p.x, p.y, p.size, p.rot)
      break
    case 'prism': {
      ctx.fillStyle = `hsl(${(p.hue + p.life * 4) % 360} 95% 70%)`
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(p.rot)
      ctx.beginPath()
      ctx.moveTo(0, -p.size)
      ctx.lineTo(p.size * 0.7, 0)
      ctx.lineTo(0, p.size)
      ctx.lineTo(-p.size * 0.7, 0)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
      break
    }
    case 'ring': {
      const rad = p.a + t * R * 1.15
      ctx.globalAlpha = (1 - t) * 0.6
      ctx.strokeStyle = '#FF8A2A'
      ctx.lineWidth = 2.5 * (1 - t) + 0.5
      ctx.beginPath()
      ctx.arc(cx, cy, rad, 0, Math.PI * 2)
      ctx.stroke()
      break
    }
    default: {
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 3)
      g.addColorStop(0, color)
      g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.size * 3, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

interface Props {
  tier: RankTier
  /** Emblem box in CSS px; the canvas extends `bleed` px past it on every side. */
  size: number
  bleed?: number
}

export default function RankParticles({ tier, size, bleed = 28 }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const theme = THEMES[tier.rank] ?? THEMES.Copper
    const scale = SUB_SCALE[tier.sub] ?? 1
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const W = size + bleed * 2
    canvas.width = W * dpr
    canvas.height = W * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const R = size / 2 + bleed * 0.4
    const cx = W / 2
    const cy = W / 2
    const parts: P[] = []
    const maxParts = theme.rays ? 150 : 100
    let raf = 0
    let last = performance.now()
    let acc = 0
    let ringTimer = 0
    let t0 = last

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      if (document.hidden) {
        last = now
        return
      }
      const dt = Math.min(48, now - last)
      last = now
      const k = dt / 16.67 // 1 = one 60 fps frame
      acc += (theme.rate * scale * dt) / 1000
      while (acc >= 1 && parts.length < maxParts) {
        acc -= 1
        parts.push(spawn(weighted(theme.mix), W, W, theme))
      }
      if (theme.rings) {
        ringTimer += dt
        if (ringTimer > 2600) {
          ringTimer = 0
          parts.push(spawn('ring', W, W, theme))
        }
      }

      ctx.clearRect(0, 0, W, W)
      ctx.globalCompositeOperation = 'lighter'

      if (theme.rays) {
        // Heat glow under everything.
        const heat = ctx.createRadialGradient(cx, cy + R * 0.1, R * 0.2, cx, cy, R * 1.25)
        const f = 0.5 + Math.sin((now - t0) / 160) * 0.08 + Math.sin((now - t0) / 410) * 0.06
        heat.addColorStop(0, `rgba(255,140,30,${0.42 * f})`)
        heat.addColorStop(0.55, `rgba(255,70,20,${0.2 * f})`)
        heat.addColorStop(1, 'rgba(120,10,0,0)')
        ctx.fillStyle = heat
        ctx.fillRect(0, 0, W, W)
        // Slowly rotating ray crown behind the emblem.
        const spin = (now - t0) / 6000
        ctx.save()
        ctx.translate(cx, cy)
        ctx.rotate(spin)
        const pulse = 0.55 + Math.sin((now - t0) / 700) * 0.15 + Math.sin((now - t0) / 130) * 0.06
        for (let i = 0; i < 12; i++) {
          ctx.rotate((Math.PI * 2) / 12)
          const g = ctx.createLinearGradient(0, 0, 0, -W * 0.5)
          g.addColorStop(0, `rgba(255,150,40,${0.3 * pulse})`)
          g.addColorStop(1, 'rgba(255,60,20,0)')
          ctx.fillStyle = g
          ctx.beginPath()
          ctx.moveTo(-2, 0)
          ctx.lineTo(2, 0)
          ctx.lineTo(i % 2 ? 9 : 5, -W * 0.5)
          ctx.lineTo(i % 2 ? -9 : -5, -W * 0.5)
          ctx.closePath()
          ctx.fill()
        }
        ctx.restore()
      }

      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i]
        p.life += k
        if (p.life >= p.max) {
          parts.splice(i, 1)
          continue
        }
        if (p.kind === 'orbit') {
          p.a += p.vr * k
          p.x = cx + Math.cos(p.a) * p.r
          p.y = cy + Math.sin(p.a) * p.r * 0.92
        } else if (p.kind === 'mote') {
          p.a += 0.05 * k
          p.x += Math.sin(p.a) * 0.35 * k
          p.y += p.vy * k
        } else if (p.kind === 'flame') {
          p.x += (p.vx + Math.sin(p.life * 0.15) * 0.25) * k
          p.y += p.vy * k
        } else {
          p.x += p.vx * k
          p.y += p.vy * k
        }
        p.rot += p.vr * k
        drawParticle(ctx, p, theme, R, cx, cy)
      }
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [tier.rank, tier.sub, size, bleed])

  const W = size + bleed * 2
  return (
    <canvas
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
      style={{ width: W, height: W }}
    />
  )
}
