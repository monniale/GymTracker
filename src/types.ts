/** Row key: legacy rows use auto-increment integers; rows created since
 * GitHub Sync use UUID strings (globally unique across devices). */
export type Id = number | string

export type MuscleGroup =
  | 'chest' | 'back' | 'shoulders' | 'biceps' | 'triceps'
  | 'legs' | 'glutes' | 'core' | 'cardio' | 'other'

export interface Exercise {
  id?: Id
  name: string
  nameLower: string
  muscleGroup: MuscleGroup
  equipment?: string
  defaultRestSec: number
  isCustom: boolean
  notes?: string
  /** kg added when the double-progression rule fires (default 2.5). */
  progressionStepKg?: number
  /** Stamped on every write by the sync middleware; merge tie-breaker. */
  updatedAt?: number
}

export interface TemplateItem {
  exerciseId: Id
  targetSets: number
  targetReps: number
  restSec?: number
  /** Linked to the NEXT item as a superset: rest only starts after the last member. */
  supersetWithNext?: boolean
}

export interface WorkoutTemplate {
  id?: Id
  name: string
  position: number
  items: TemplateItem[]
  updatedAt: number
}

export interface Session {
  id?: Id
  templateId?: Id
  name: string
  startedAt: number
  endedAt?: number
  bodyweightKg: number
  points?: number
  extraExerciseIds: Id[]
  /** Stamped on every write by the sync middleware; merge tie-breaker. */
  updatedAt?: number
}

export interface SetRow {
  id?: Id
  sessionId: Id
  exerciseId: Id
  setNumber: number
  weightKg: number
  reps: number
  isWarmup: boolean
  completedAt: number
  e1rm: number
  /** Stamped on every write by the sync middleware; merge tie-breaker. */
  updatedAt?: number
}

export interface MacroSet {
  kcal100: number
  protein100: number
  carbs100: number
  fat100: number
}

export interface Food extends MacroSet {
  id?: Id
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
  /** Stamped on every write by the sync middleware; merge tie-breaker. */
  updatedAt?: number
}

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack'

export interface FoodLog {
  id?: Id
  date: string // YYYY-MM-DD local
  meal: MealType
  foodId: Id
  grams: number
  loggedAt: number
  /** Stamped on every write by the sync middleware; merge tie-breaker. */
  updatedAt?: number
}

export interface SavedMeal {
  id?: Id
  name: string
  items: { foodId: Id; grams: number }[]
  lastUsedAt: number
  /** Stamped on every write by the sync middleware; merge tie-breaker. */
  updatedAt?: number
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
  /** Stamped on every write by the sync middleware; merge tie-breaker. */
  updatedAt?: number
}

/** Manual override of the automatic training/rest day detection, per date. */
export interface DayType {
  date: string // YYYY-MM-DD, primary key
  type: 'training' | 'rest'
  /** Stamped on every write by the sync middleware; merge tie-breaker. */
  updatedAt?: number
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
  /** Stamped on every write by the sync middleware; merge tie-breaker. */
  updatedAt?: number
}

export interface ExerciseBreakdown {
  exerciseId: Id
  exerciseName: string
  setPoints: number
  countedSets: number
  totalSets: number
  e1rmPr: boolean
  volumePr: boolean
  bestE1rm: number
}

export interface ScoreEvent {
  id?: Id
  /** Absent for non-session awards (e.g. weekly quest bonuses). */
  sessionId?: Id
  /** Display label for non-session awards. */
  label?: string
  date: string
  basePoints: number
  prBonus: number
  streakMult: number
  dayFactor: number
  total: number
  breakdown: ExerciseBreakdown[]
  /** Stamped on every write by the sync middleware; merge tie-breaker. */
  updatedAt?: number
}

export interface Season {
  id?: Id
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
  /** Stamped on every write by the sync middleware; merge tie-breaker. */
  updatedAt?: number
}

export interface BodyLogEntry {
  date: string // YYYY-MM-DD, primary key
  weightKg: number
  /** Stamped on every write by the sync middleware; merge tie-breaker. */
  updatedAt?: number
}

export interface WaterLog {
  id?: Id
  date: string
  ml: number
  /** Stamped on every write by the sync middleware; merge tie-breaker. */
  updatedAt?: number
}

export interface AchievementUnlock {
  id: string // achievement id, primary key
  unlockedAt: number
  /** Stamped on every write by the sync middleware; merge tie-breaker. */
  updatedAt?: number
}

export interface QuestState {
  weekKey: string // monday YYYY-MM-DD, primary key
  quests: { id: string; done: boolean; awardedAt?: number }[]
  /** Stamped on every write by the sync middleware; merge tie-breaker. */
  updatedAt?: number
}

/** AI coach note categories/tones — mirrored by the Gemini response schema. */
export type CoachInsightCategory =
  // workout
  | 'verdict' | 'pr' | 'progression' | 'balance' | 'intensity' | 'consistency' | 'milestone'
  // diet
  | 'calories' | 'protein' | 'macros' | 'hydration'
export type CoachInsightTone = 'celebratory' | 'positive' | 'neutral' | 'warning'

export interface CoachInsight {
  category: CoachInsightCategory
  tone: CoachInsightTone
  message: string
}

/** Structured coaching note rendered on the session summary. */
export interface CoachNote {
  headline: string
  tone: CoachInsightTone
  insights: CoachInsight[]
}

/** Cached AI coach note, keyed by session. Device-local: intentionally excluded
 * from the sync snapshot and local backups (not in backup.ts TABLES). */
export interface CoachNoteRow {
  sessionId: Id
  note: CoachNote
  model: string
  generatedAt: number
  /** Stamped by the sync middleware on non-suspended writes; unused for sync. */
  updatedAt?: number
}

/** Cached AI diet note, keyed by day (YYYY-MM-DD). Device-local like CoachNoteRow. */
export interface DietNoteRow {
  date: string
  note: CoachNote
  model: string
  generatedAt: number
  updatedAt?: number
}

/* ---------- AI action suggestions (F1 diet macros, F2 workout weights) ---------- */

/** One AI-suggested working set (already snapped to loadable increments). */
export interface PlannedSet {
  weightKg: number
  reps: number
}

/** AI-suggested opening sets for one exercise, resolved to a real exerciseId. */
export interface ExercisePlan {
  exerciseId: Id
  sets: PlannedSet[]
  note?: string
}

/** A whole-session AI weight/rep plan. Device-local; F2 auto-fills the set
 * fields from it and always falls back to the offline progression engine. */
export interface WorkoutPlanRow {
  sessionId: Id
  plan: ExercisePlan[]
  model: string
  generatedAt: number
  updatedAt?: number
}

/** One AI-suggested food to add or swap in, grounded in a real portion. */
export interface MacroSuggestionItem {
  /** String(foodId) of a food the user already tracks, when the model reused one. */
  ref?: string
  food: string
  brand?: string
  meal: MealType
  grams: number
  /** The model's macro contribution for this portion (recomputed on apply). */
  kcal: number
  protein: number
  carbs: number
  fat: number
  reason?: string
}

/** AI suggestions for completing the day's macros or swapping a food. */
export interface MacroSuggestion {
  headline: string
  items: MacroSuggestionItem[]
}

/** Cached macro-completion suggestion, keyed by day. Device-local like DietNoteRow.
 * `basis` is a signature of the remaining macros at generation time so the UI can
 * flag the suggestion as stale once more food is logged. */
export interface DietSuggestionRow {
  date: string
  basis: string
  suggestion: MacroSuggestion
  model: string
  generatedAt: number
  updatedAt?: number
}

/** Deletion marker so removals propagate across devices instead of resurrecting. */
export interface Tombstone {
  id?: Id
  table: string
  rowId: Id
  deletedAt: number
  updatedAt?: number
}
