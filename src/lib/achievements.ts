import { db } from '../db/db'
import { standardFor, levelFor } from './standards'
import type { Id } from '../types'

export interface AchievementDef {
  id: string
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

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first-session', name: 'First blood', desc: 'Finish your first session', icon: 'dumbbell', check: s => s.totalSessions >= 1 },
  { id: 'sessions-10', name: 'Regular', desc: '10 sessions finished', icon: 'dumbbell', check: s => s.totalSessions >= 10 },
  { id: 'sessions-50', name: 'Gym rat', desc: '50 sessions finished', icon: 'dumbbell', check: s => s.totalSessions >= 50 },
  { id: 'sessions-100', name: 'Iron veteran', desc: '100 sessions finished', icon: 'medal', check: s => s.totalSessions >= 100 },
  { id: 'volume-100k', name: 'Ton mover', desc: '100,000 kg lifetime volume', icon: 'zap', check: s => s.totalVolumeKg >= 100_000 },
  { id: 'volume-1m', name: 'Million club', desc: '1,000,000 kg lifetime volume', icon: 'zap', check: s => s.totalVolumeKg >= 1_000_000 },
  { id: 'streak-4', name: 'Habit formed', desc: '4-week training streak', icon: 'flame', check: s => s.streakWeeks >= 4 },
  { id: 'streak-12', name: 'Unstoppable', desc: '12-week training streak', icon: 'flame', check: s => s.streakWeeks >= 12 },
  { id: 'prs-10', name: 'Record breaker', desc: '10 personal records', icon: 'trophy', check: s => s.totalPrs >= 10 },
  { id: 'prs-50', name: 'PR machine', desc: '50 personal records', icon: 'trophy', check: s => s.totalPrs >= 50 },
  { id: 'bench-bw', name: 'Bodyweight bench', desc: 'Bench press e1RM ≥ 1× bodyweight', icon: 'scale', check: s => (s.liftRatios.get('bench') ?? 0) >= 1.0 },
  { id: 'squat-1_5bw', name: 'Squat 1.5×', desc: 'Squat e1RM ≥ 1.5× bodyweight', icon: 'scale', check: s => (s.liftRatios.get('squat') ?? 0) >= 1.5 },
  { id: 'deadlift-2bw', name: 'Deadlift 2×', desc: 'Deadlift e1RM ≥ 2× bodyweight', icon: 'scale', check: s => (s.liftRatios.get('deadlift') ?? 0) >= 2.0 },
  { id: 'nutrition-7', name: 'Fuel logger', desc: 'Log food on 7 different days', icon: 'utensils', check: s => s.foodLogDays >= 7 },
  { id: 'nutrition-30', name: 'Precision eater', desc: 'Log food on 30 different days', icon: 'utensils', check: s => s.foodLogDays >= 30 },
  { id: 'big-session', name: 'Monster session', desc: 'Score 200+ points in one session', icon: 'medal', check: s => s.maxSessionPoints >= 200 },
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
