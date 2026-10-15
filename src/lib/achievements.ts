import { db } from '../db/db'
import { standardFor, levelFor } from './standards'
import { t, fmtNum } from '../i18n'
import type { Dict } from '../i18n/en'
import type { Vars } from '../i18n/types'
import type { Id } from '../types'

export interface AchievementDef {
  /** Stored id (db.achievements): never translated. */
  id: string
  /** Display name and description in the UI language (built at load; a language change reloads). */
  name: string
  desc: string
  /** lucide icon key resolved in the UI */
  icon: 'dumbbell' | 'flame' | 'trophy' | 'scale' | 'utensils' | 'zap' | 'medal'
  check: (s: AchievementStats) => boolean
}

export interface AchievementStats {
  totalSessions: number
  totalVolumeKg: number
  streakWeeks: number
  totalPrs: number
  maxSessionPoints: number
  foodLogDays: number
  liftRatios: Map<string, number> // standards key -> best e1RM/BW ratio
}

type AchievementKey = keyof Dict['lib']['achievements']
const text = (key: AchievementKey, vars?: Vars) => ({
  name: t(`lib.achievements.${key}.name`),
  desc: t(`lib.achievements.${key}.desc`, vars),
})

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first-session', ...text('firstSession'), icon: 'dumbbell', check: s => s.totalSessions >= 1 },
  { id: 'sessions-10', ...text('sessions10'), icon: 'dumbbell', check: s => s.totalSessions >= 10 },
  { id: 'sessions-50', ...text('sessions50'), icon: 'dumbbell', check: s => s.totalSessions >= 50 },
  { id: 'sessions-100', ...text('sessions100'), icon: 'medal', check: s => s.totalSessions >= 100 },
  { id: 'volume-100k', ...text('volume100k', { kg: fmtNum(100_000) }), icon: 'zap', check: s => s.totalVolumeKg >= 100_000 },
  { id: 'volume-1m', ...text('volume1m', { kg: fmtNum(1_000_000) }), icon: 'zap', check: s => s.totalVolumeKg >= 1_000_000 },
  { id: 'streak-4', ...text('streak4'), icon: 'flame', check: s => s.streakWeeks >= 4 },
  { id: 'streak-12', ...text('streak12'), icon: 'flame', check: s => s.streakWeeks >= 12 },
  { id: 'prs-10', ...text('prs10'), icon: 'trophy', check: s => s.totalPrs >= 10 },
  { id: 'prs-50', ...text('prs50'), icon: 'trophy', check: s => s.totalPrs >= 50 },
  { id: 'bench-bw', ...text('benchBw'), icon: 'scale', check: s => (s.liftRatios.get('bench') ?? 0) >= 1.0 },
  { id: 'squat-1_5bw', ...text('squat15Bw'), icon: 'scale', check: s => (s.liftRatios.get('squat') ?? 0) >= 1.5 },
  { id: 'deadlift-2bw', ...text('deadlift2Bw'), icon: 'scale', check: s => (s.liftRatios.get('deadlift') ?? 0) >= 2.0 },
  { id: 'nutrition-7', ...text('nutrition7'), icon: 'utensils', check: s => s.foodLogDays >= 7 },
  { id: 'nutrition-30', ...text('nutrition30'), icon: 'utensils', check: s => s.foodLogDays >= 30 },
  { id: 'big-session', ...text('bigSession'), icon: 'medal', check: s => s.maxSessionPoints >= 200 },
]

export async function computeAchievementStats(): Promise<AchievementStats> {
  const sessions = await db.sessions.filter(s => s.endedAt !== undefined).toArray()
  const sets = await db.sets.filter(s => !s.isWarmup).toArray()
  const events = await db.scoreEvents.toArray()
  const rank = await db.rankState.get(1)
  const settings = await db.settings.get(1)
  const foodDates = new Set((await db.foodLogs.toArray()).map(l => l.date))
  const exercises = await db.exercises.toArray()
  const exNames = new Map<Id, string>(exercises.map(e => [e.id!, e.nameLower]))

  const bw = settings?.bodyweightKg ?? 75
  const liftRatios = new Map<string, number>()
  for (const s of sets) {
    const nameLower = exNames.get(s.exerciseId)
    if (!nameLower) continue
    const std = standardFor(nameLower)
    if (!std) continue
    const ratio = levelFor(s.e1rm, bw, std).ratio
    if (ratio > (liftRatios.get(std.key) ?? 0)) liftRatios.set(std.key, ratio)
  }

  const totalPrs = events.reduce(
    (acc, e) => acc + e.breakdown.filter(b => b.e1rmPr).length + e.breakdown.filter(b => b.volumePr).length,
    0,
  )

  return {
    totalSessions: sessions.length,
    totalVolumeKg: Math.round(sets.reduce((a, s) => a + s.weightKg * s.reps, 0)),
    streakWeeks: rank?.streakWeeks ?? 0,
    totalPrs,
    maxSessionPoints: Math.max(0, ...sessions.map(s => s.points ?? 0)),
    foodLogDays: foodDates.size,
    liftRatios,
  }
}

/** Idempotent: unlocks anything newly earned, returns the fresh unlocks. */
export async function checkAchievements(): Promise<AchievementDef[]> {
  const stats = await computeAchievementStats()
  const unlocked = new Set((await db.achievements.toArray()).map(a => a.id))
  const fresh: AchievementDef[] = []
  for (const def of ACHIEVEMENTS) {
    if (!unlocked.has(def.id) && def.check(stats)) {
      await db.achievements.put({ id: def.id, unlockedAt: Date.now() })
      fresh.push(def)
    }
  }
  return fresh
}
