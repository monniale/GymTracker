import { isNative } from '../native/platform'
import { rankForPoints, rankLabel, type RankTier } from './ranks'
import { fmtDuration, fmtLongDate, localDateStr } from './dates'
import { isCardioSet } from './cardio'
import { exerciseDisplayName } from './exerciseNames'
import { t, tp, fmtNum } from '../i18n'
import type { ScoreEvent, Session, SetRow } from '../types'

/** One exercise row on the card. */
export interface CardExercise {
  name: string
  /** Working sets (warm-ups excluded). */
  sets: number
  /** Heaviest working set by e1RM. */
  best: { weightKg: number; reps: number } | null
  e1rmPr: boolean
  volumePr: boolean
}

export interface SessionCardModel {
  title: string
  /** "Thu 15 Oct 2026". */
  date: string
  points: number
  tier: RankTier
  rankLabel: string
  rankColor: string
  rankedUp: boolean
  /** Top exercises by points (at most `MAX_EXERCISES`). */
  exercises: CardExercise[]
  moreExercises: number
  prCount: number
  sets: number
  volumeKg: number
  durationMs: number
  /** 0 hides the streak stat. */
  streakWeeks: number
}

const MAX_EXERCISES = 4

/**
 * Everything the share card shows, from the stored session. `fresh` is the
 * post-workout summary: only then can the current rank tell a rank-up (an old
 * report only knows today's rank).
 */
export function sessionCardModel(
  session: Session,
  event: ScoreEvent,
  sets: SetRow[],
  rankPoints: number,
  { fresh, streakWeeks }: { fresh: boolean; streakWeeks: number },
): SessionCardModel {
  // Strength working sets only: cardio rows (no weight/reps) have their own minutes elsewhere.
  const working = sets.filter(s => !s.isWarmup && !isCardioSet(s))
  const after = rankForPoints(rankPoints)
  const before = rankForPoints(Math.max(0, rankPoints - event.total))
  const ranked = [...event.breakdown].sort((a, b) => b.setPoints - a.setPoints)
  const exercises = ranked.slice(0, MAX_EXERCISES).map(b => {
    const mine = working.filter(s => s.exerciseId === b.exerciseId)
    const top = mine.reduce<SetRow | null>((a, s) => (!a || s.e1rm > a.e1rm ? s : a), null)
    return {
      name: exerciseDisplayName(b.exerciseName),
      sets: mine.length,
      best: top ? { weightKg: top.weightKg, reps: top.reps } : null,
      e1rmPr: b.e1rmPr,
      volumePr: b.volumePr,
    }
  })
  return {
    title: session.name,
    date: fmtLongDate(localDateStr(new Date(session.startedAt))),
    points: event.total,
    tier: after.tier,
    rankLabel: rankLabel(after.tier),
    rankColor: after.tier.color,
    rankedUp: fresh && after.index > before.index,
    exercises,
    moreExercises: Math.max(0, ranked.length - MAX_EXERCISES),
    prCount: event.breakdown.filter(b => b.e1rmPr || b.volumePr).length,
    sets: working.length,
    volumeKg: Math.round(working.reduce((a, s) => a + s.weightKg * s.reps, 0)),
    durationMs: session.endedAt ? Math.max(0, session.endedAt - session.startedAt) : 0,
    streakWeeks: fresh ? streakWeeks : 0,
  }
}

/** Footer stats in display order; the streak only when there is one. */
export function cardStats(m: SessionCardModel): { value: string; label: string }[] {
  const stats = [
    { value: String(m.sets), label: tp('data.shareCard.statSets', m.sets) },
    { value: `${fmtNum(m.volumeKg)} kg`, label: t('data.shareCard.statVolume') },
    { value: fmtDuration(m.durationMs), label: t('data.shareCard.statTime') },
  ]
  if (m.streakWeeks > 0) {
    stats.push({ value: t('data.shareCard.streakWeeks', { n: m.streakWeeks }), label: t('data.shareCard.statStreak') })
  }
  return stats
}

/** Safe file name: "gymtracker-push-day-2026-10-15.png". */
export function cardFileName(m: SessionCardModel, date: string): string {
  const slug = m.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
  return `gymtracker-${slug ? `${slug}-` : ''}${date}.png`
}

// ── Rendering (browser only) ────────────────────────────────────────────────

export const CARD_W = 1080
export const CARD_H = 1350
const BG = '#0B0F14'
const CARD = '#1B2431'
const EDGE = '#2A3442'
const INK = '#F8FAFC'
const SUB = '#94A3B8'
const ORANGE = '#F97316'
const GREEN = '#22C55E'
const DISPLAY = '"Barlow Condensed", system-ui, sans-serif'
const BODY = 'Barlow, system-ui, sans-serif'

/** Font faces the card draws with; loading them first keeps the canvas from falling back. */
export const CARD_FONTS = [
  `700 100px ${DISPLAY}`,
  `600 40px ${DISPLAY}`,
  `500 40px ${BODY}`,
  `600 40px ${BODY}`,
]

export async function loadCardFonts(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return
  await Promise.all(CARD_FONTS.map(f => document.fonts.load(f).catch(() => [])))
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Could not load ${src}`))
    img.src = src
  })
}

/** The emblems only carry a viewBox; give them a size so every browser can draw them on a canvas. */
async function loadSvg(url: string, size: number): Promise<HTMLImageElement> {
  const text = await (await fetch(url)).text()
  const sized = text.replace(/<svg\b/, `<svg width="${size}" height="${size}"`)
  const blobUrl = URL.createObjectURL(new Blob([sized], { type: 'image/svg+xml' }))
  try {
    return await loadImage(blobUrl)
  } finally {
    URL.revokeObjectURL(blobUrl)
  }
}

/** Shortens `text` with an ellipsis until it fits `max` px in the current font. */
function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text
  let t = text
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1)
  return `${t.trimEnd()}…`
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** A pill badge ending at `right`; returns its left edge. */
function pill(ctx: CanvasRenderingContext2D, label: string, right: number, y: number, color: string): number {
  ctx.font = `600 28px ${DISPLAY}`
  const w = ctx.measureText(label).width + 36
  roundRect(ctx, right - w, y, w, 48, 24)
  ctx.fillStyle = `${color}26`
  ctx.fill()
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, right - w / 2, y + 25)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  return right - w
}

/**
 * Draws the 1080×1350 (4:5) card and returns it as a PNG. `emblemSrc` is the
 * rank emblem URL; a missing logo or emblem is skipped rather than failing.
 */
export async function renderSessionCard(m: SessionCardModel, emblemSrc?: string): Promise<Blob> {
  await loadCardFonts()
  const [logo, emblem] = await Promise.all([
    loadImage(`${import.meta.env.BASE_URL}icons/icon-512.png`).catch(() => null),
    emblemSrc ? loadSvg(emblemSrc, 480).catch(() => null) : Promise.resolve(null),
  ])

  const canvas = document.createElement('canvas')
  canvas.width = CARD_W
  canvas.height = CARD_H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error(t('data.shareCard.noCanvas'))
  const PAD = 72

  // Background with a glow in the rank colour behind the emblem.
  ctx.fillStyle = BG
  ctx.fillRect(0, 0, CARD_W, CARD_H)
  const glow = ctx.createRadialGradient(820, 360, 20, 820, 360, 520)
  glow.addColorStop(0, `${m.rankColor}40`)
  glow.addColorStop(1, `${m.rankColor}00`)
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, CARD_W, CARD_H)

  // Header: logo, session name, date.
  let textX = PAD
  if (logo) {
    roundRect(ctx, PAD, 64, 96, 96, 22)
    ctx.save()
    ctx.clip()
    ctx.drawImage(logo, PAD, 64, 96, 96)
    ctx.restore()
    textX = PAD + 96 + 28
  }
  ctx.fillStyle = INK
  ctx.font = `700 64px ${DISPLAY}`
  ctx.fillText(fit(ctx, m.title, CARD_W - PAD - textX), textX, 118)
  ctx.fillStyle = SUB
  ctx.font = `500 32px ${BODY}`
  ctx.fillText(m.date, textX, 160)

  // Points.
  ctx.fillStyle = ORANGE
  ctx.font = `700 230px ${DISPLAY}`
  ctx.fillText(`+${m.points}`, PAD - 6, 410)
  ctx.fillStyle = SUB
  ctx.font = `600 40px ${DISPLAY}`
  ctx.fillText(m.prCount > 0 ? tp('data.shareCard.pointsPrs', m.prCount) : t('data.shareCard.points'), PAD, 466)

  // Rank emblem + label.
  const cx = 820
  if (m.rankedUp) {
    ctx.fillStyle = GREEN
    ctx.font = `700 40px ${DISPLAY}`
    ctx.textAlign = 'center'
    ctx.fillText(t('data.shareCard.rankUp'), cx, 222)
  }
  if (emblem) ctx.drawImage(emblem, cx - 130, 236, 260, 260)
  ctx.textAlign = 'center'
  ctx.font = `700 52px ${DISPLAY}`
  ctx.fillStyle = m.rankColor
  ctx.fillText(m.rankLabel, cx, emblem ? 540 : 400)
  ctx.textAlign = 'left'

  // Exercises.
  let y = 580
  for (const ex of m.exercises) {
    roundRect(ctx, PAD, y, CARD_W - PAD * 2, 94, 22)
    ctx.fillStyle = CARD
    ctx.fill()
    let right = CARD_W - PAD - 28
    if (ex.volumePr) right = pill(ctx, t('data.shareCard.volumePr'), right, y + 23, GREEN) - 14
    if (ex.e1rmPr) right = pill(ctx, t('data.shareCard.e1rmPr'), right, y + 23, ORANGE) - 14
    ctx.fillStyle = INK
    ctx.font = `600 40px ${BODY}`
    const nameX = PAD + 32
    ctx.fillText(fit(ctx, ex.name, right - nameX - 8), nameX, y + 44)
    ctx.fillStyle = SUB
    ctx.font = `500 28px ${BODY}`
    const sets = tp('units.sets', ex.sets)
    const detail = ex.best
      ? t('data.shareCard.setsBest', { sets, weight: fmtNum(ex.best.weightKg), reps: ex.best.reps })
      : sets
    ctx.fillText(fit(ctx, detail, right - nameX - 8), nameX, y + 80)
    y += 106
  }
  if (m.moreExercises > 0) {
    ctx.fillStyle = SUB
    ctx.font = `500 30px ${BODY}`
    ctx.fillText(tp('data.shareCard.moreExercises', m.moreExercises), PAD + 32, y + 26)
  }

  // Footer stats.
  const stats = cardStats(m)
  const top = 1112
  ctx.strokeStyle = EDGE
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(PAD, top - 36)
  ctx.lineTo(CARD_W - PAD, top - 36)
  ctx.stroke()
  const colW = (CARD_W - PAD * 2) / stats.length
  stats.forEach((s, i) => {
    const x = PAD + i * colW
    ctx.fillStyle = INK
    ctx.font = `700 60px ${DISPLAY}`
    ctx.fillText(fit(ctx, s.value, colW - 16), x, top + 40)
    ctx.fillStyle = SUB
    ctx.font = `500 28px ${BODY}`
    ctx.fillText(s.label.toUpperCase(), x, top + 84)
  })

  // Wordmark.
  ctx.fillStyle = ORANGE
  ctx.font = `700 36px ${DISPLAY}`
  ctx.textAlign = 'right'
  ctx.fillText('GYMTRACKER', CARD_W - PAD, CARD_H - 52)
  ctx.textAlign = 'left'

  return new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error(t('data.shareCard.encodeFailed')))), 'image/png'),
  )
}

/** A blob as base64 without the `data:` prefix. */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''))
    r.onerror = () => reject(r.error ?? new Error(t('data.shareCard.readFailed')))
    r.readAsDataURL(blob)
  })
}

/**
 * Android: the system share sheet (via a cache file). Web: the Web Share API
 * when it takes files, else a download. A closed share sheet is 'canceled'.
 */
export async function shareImage(blob: Blob, fileName: string): Promise<'shared' | 'downloaded' | 'canceled'> {
  if (isNative) {
    const { sharePngFile } = await import('../native/files')
    return sharePngFile(fileName, await blobToBase64(blob), t('data.shareCard.shareTitle'))
  }
  const file = new File([blob], fileName, { type: 'image/png' })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] })
      return 'shared'
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return 'canceled'
      // Not allowed here (e.g. no user activation left): fall back to a download.
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return 'downloaded'
}
