export type MuscleGroup =
  | 'chest' | 'back' | 'shoulders' | 'biceps' | 'triceps'
  | 'legs' | 'glutes' | 'core' | 'cardio' | 'other'

export interface Exercise {
  id?: number
  name: string
  nameLower: string
  muscleGroup: MuscleGroup
  equipment?: string
  defaultRestSec: number
  isCustom: boolean
  notes?: string
  /** kg added when the double-progression rule fires (default 2.5). */
  progressionStepKg?: number
}

export interface TemplateItem {
  exerciseId: number
  targetSets: number
  targetReps: number
  restSec?: number
  /** Linked to the NEXT item as a superset: rest only starts after the last member. */
  supersetWithNext?: boolean
}

export interface WorkoutTemplate {
  id?: number
  name: string
  position: number
  items: TemplateItem[]
  updatedAt: number
}

export interface Session {
  id?: number
  templateId?: number
  name: string
  startedAt: number
  endedAt?: number
  bodyweightKg: number
  points?: number
  extraExerciseIds: number[]
}

export interface SetRow {
  id?: number
  sessionId: number
  exerciseId: number
  setNumber: number
  weightKg: number
  reps: number
  isWarmup: boolean
  completedAt: number
  e1rm: number
}

export interface MacroSet {
  kcal100: number
  protein100: number
  carbs100: number
  fat100: number
}

export interface Food extends MacroSet {
  id?: number
  source: 'off' | 'custom'
  offId?: string
  name: string
  nameLower: string
  brand?: string
  servingG?: number
  servingLabel?: string
  userOverridden: boolean
  offOriginal?: MacroSet
  lastUsedAt: number
  useCount: number
  lastGrams?: number
}

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack'

export interface FoodLog {
  id?: number
  date: string // YYYY-MM-DD local
  meal: MealType
  foodId: number
  grams: number
  loggedAt: number
}

export interface SavedMeal {
  id?: number
  name: string
  items: { foodId: number; grams: number }[]
  lastUsedAt: number
}

export interface Settings {
  id: number
  bodyweightKg: number
  // Training-day targets
  kcalTarget: number
  proteinTarget: number
  carbsTarget: number
  fatTarget: number
  // Rest-day targets (optional for pre-v2 data/backups; fall back to training values)
  restKcalTarget?: number
  restProteinTarget?: number
  restCarbsTarget?: number
  restFatTarget?: number
  soundEnabled: boolean
  defaultRestSec: number
  weeklySessionTarget: number
  barWeightKg?: number
  platesAvailable?: number[]
  waterTargetMl?: number
}

/** Manual override of the automatic training/rest day detection, per date. */
export interface DayType {
  date: string // YYYY-MM-DD, primary key
  type: 'training' | 'rest'
}

export interface RankState {
  id: number
  seasonId: number
  seasonStart: string // YYYY-MM-DD
  points: number
  streakWeeks: number
  lastStreakWeek: string // monday YYYY-MM-DD of last week the target was met, '' if never
  lastSessionDate?: string
  idleDecayTaken: number // points already removed during the current idle streak
  lastDecayCheckDate: string
}

export interface ExerciseBreakdown {
  exerciseId: number
  exerciseName: string
  setPoints: number
  countedSets: number
  totalSets: number
  e1rmPr: boolean
  volumePr: boolean
  bestE1rm: number
}

export interface ScoreEvent {
  id?: number
  /** Absent for non-session awards (e.g. weekly quest bonuses). */
  sessionId?: number
  /** Display label for non-session awards. */
  label?: string
  date: string
  basePoints: number
  prBonus: number
  streakMult: number
  dayFactor: number
  total: number
  breakdown: ExerciseBreakdown[]
}

export interface Season {
  id?: number
  seasonId: number
  startDate: string
  endDate: string
  finalPoints: number
  finalRank: string
  recap?: {
    sessions: number
    totalVolumeKg: number
    bestLift?: { exerciseName: string; e1rm: number }
  }
}

export interface BodyLogEntry {
  date: string // YYYY-MM-DD, primary key
  weightKg: number
}

export interface WaterLog {
  id?: number
  date: string
  ml: number
}

export interface AchievementUnlock {
  id: string // achievement id, primary key
  unlockedAt: number
}

export interface QuestState {
  weekKey: string // monday YYYY-MM-DD, primary key
  quests: { id: string; done: boolean; awardedAt?: number }[]
}
