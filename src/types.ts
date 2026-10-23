/** Row key: legacy rows use auto-increment integers; rows created since
 * GitHub Sync use UUID strings (globally unique across devices). */
export type Id = number | string

export type MuscleGroup =
  | 'chest' | 'back' | 'shoulders' | 'biceps' | 'triceps'
  | 'legs' | 'glutes' | 'core' | 'cardio' | 'other'

/** Equipment a movement is performed with. Weight data is kept separate per
 * exercise, so barbell/dumbbell/machine variants are distinct exercises. */
export type Equipment = 'barbell' | 'dumbbell' | 'machine' | 'cable' | 'bodyweight' | 'other'

export interface Exercise {
  id?: Id
  name: string
  nameLower: string
  muscleGroup: MuscleGroup
  equipment?: Equipment
  defaultRestSec: number
  isCustom: boolean
  notes?: string
  /** kg added when the double-progression rule fires (default 2.5). */
  progressionStepKg?: number
  /** How sets are logged. Absent = by muscle group ('cardio' → cardio, else strength). */
  kind?: 'strength' | 'cardio'
  /** Exercise-library entry this row was added from (`public/exercise-library.json` id, e.g. "0025").
   * Catalog rows are linked by name instead (`SEED_LIBRARY_IDS`). */
  libraryId?: string
  /** Fraction of bodyweight this move lifts (equipment 'bodyweight' only, e.g. 1.0 pull-up,
   * 0.64 push-up). Absent = the default by name (`defaultBwFactor` in src/lib/load.ts). */
  bwFactor?: number
  /** Stamped on every write by the sync middleware; merge tie-breaker. */
  updatedAt?: number
}

export interface TemplateItem {
  exerciseId: Id
  targetSets: number
  /** Target reps; for a cardio exercise, target minutes per set. */
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
  /** Weekdays this template is scheduled on (0-6 = JS Date.getDay(), Sunday 0), sorted, never
   * empty (no schedule = field absent). Read by nextTemplate and the workout reminder. */
  weekdays?: number[]
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
  /** Set on workouts brought in from another app's CSV export (Settings › Data). */
  importedFrom?: 'strong' | 'hevy'
  /** Set when the session is created by a build that scores bodyweight load
   * (src/lib/load.ts): on such a session a bodyweight exercise's load is
   * bodyweightKg × bwFactor + SetRow.weightKg. Absent on every older session, which
   * keeps load = weightKg everywhere (forward-only, so re-scoring reproduces old totals). */
  bwScoring?: true
  /** Exercises swapped for this session only (src/lib/sessionItems.ts): the template item for
   * `from` is done as `to`, with the same sets, reps, rest and superset. */
  swaps?: { from: Id; to: Id }[]
  /** Stamped on every write by the sync middleware; merge tie-breaker. */
  updatedAt?: number
}

export interface SetRow {
  id?: Id
  sessionId: Id
  exerciseId: Id
  setNumber: number
  /** kg on the bar or machine. For a bodyweight exercise on a `Session.bwScoring` session it is
   * the ADDED kg and may be negative (assisted); the load is `effectiveLoad` (src/lib/load.ts). */
  weightKg: number
  reps: number
  isWarmup: boolean
  completedAt: number
  /** Epley e1RM of the set's load (`setE1rm` in src/lib/load.ts); 0 for unweighted and cardio rows. */
  e1rm: number
  /** Cardio sets (src/lib/cardio.ts): time and optional distance; weightKg/reps/e1rm are 0. */
  durationSec?: number
  distanceM?: number
  /** Rate of perceived exertion, 6–10 in 0.5 steps (`normalizeRpe`); absent = not recorded. */
  rpe?: number
  /** Set type beside the warm-up flag (src/lib/setTypes.ts; read it with `setKind`). Writers never
   * store 'working': absent means a working set. Metadata only: every type scores as today. */
  setType?: 'working' | 'drop' | 'failure' | 'amrap'
  /** Stamped on every write by the sync middleware; merge tie-breaker. */
  updatedAt?: number
}

export interface MacroSet {
  kcal100: number
  protein100: number
  carbs100: number
  fat100: number
}

/** Online food databases the app can pull products from. */
export type FoodSource = 'off' | 'usda'

/** A product normalized from any online database, before it is cached as a Food.
 * `sourceId` is the provider's own id (EAN for OFF, fdcId for USDA); `barcode`
 * is set when known (the EAN, or a USDA branded gtinUpc). */
export interface RemoteFood extends MacroSet {
  source: FoodSource
  sourceId: string
  barcode?: string
  name: string
  brand?: string
  servingG?: number
  servingLabel?: string
}

/** A pluggable online food database. Providers are tried in registry order for
 * both text search (fallback when the primary is thin) and barcode (first hit). */
export interface FoodProvider {
  id: FoodSource
  label: string
  search(query: string, signal?: AbortSignal): Promise<RemoteFood[]>
  lookupBarcode(code: string, signal?: AbortSignal): Promise<RemoteFood | null>
}

export interface Food extends MacroSet {
  id?: Id
  source: FoodSource | 'custom'
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

/** A food planned for a meal (e.g. tomorrow's menu). Not eaten yet: it never counts
 * toward the day's totals, quests or reports until "Eat" turns it into a FoodLog. */
export interface PlannedFood {
  id?: Id
  date: string // YYYY-MM-DD local
  meal: MealType
  foodId: Id
  grams: number
  plannedAt: number
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
  // Profile for the TDEE / macro calculator (all optional: unset until the user runs it).
  /** Sex used by the Mifflin-St Jeor BMR formula. */
  sex?: 'm' | 'f'
  /** Year of birth; the age is derived from it on the day the calculator runs. */
  birthYear?: number
  /** Height in centimetres. */
  heightCm?: number
  /** Activity level, mapped to a TDEE multiplier in `src/lib/tdee.ts`. */
  activity?: 'sedentary' | 'light' | 'moderate' | 'active' | 'very'
  /** Goal bodyweight in kg (shown as a reference line on the bodyweight chart). */
  goalWeightKg?: number
  /** Planned rate in % of bodyweight per week: negative = lose, positive = gain, 0 = maintain. */
  goalRatePctPerWeek?: number
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

/**
 * A stored AI coach verdict (a workout coach note or a diet report). Unlike the
 * device-local caches above it is synced user data (backup.ts TABLES), so past
 * verdicts survive a new phone or a reinstall. Append-only: Regenerate adds a
 * row and keeps the earlier verdict; the newest row per session/day is current.
 */
export interface CoachJudgement {
  id?: Id
  /** 'week' = the weekly review (builds before it show such a row as a diet day). */
  kind: 'workout' | 'diet' | 'week'
  /** The judged session (workout verdicts). */
  sessionId?: Id
  /** Local day the verdict is about (the session's day / the diet day / the week's Monday), YYYY-MM-DD. */
  date: string
  /** Session name when the verdict was written (workout verdicts). */
  title?: string
  note: CoachNote
  /** The model that wrote it (the chosen one or a free fallback). */
  model: string
  generatedAt: number
  /** Stamped on every write by the sync middleware; merge tie-breaker. */
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

/** One component of an AI-estimated takeaway meal (macros per 100 g, like `MacroSet`). */
export interface MealEstimateItem extends MacroSet {
  name: string
  grams: number
  note?: string
}

/** An AI estimate of a meal with no label (Add food › Estimate). Never stored: the logged foods are the record. */
export interface MealEstimate {
  headline: string
  confidence: 'low' | 'medium' | 'high'
  items: MealEstimateItem[]
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
