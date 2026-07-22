import Dexie, { type Table } from 'dexie'
import type {
  Exercise, WorkoutTemplate, Session, SetRow, Food, FoodLog,
  SavedMeal, Settings, RankState, ScoreEvent, Season, DayType,
  BodyLogEntry, WaterLog, AchievementUnlock, QuestState, Tombstone,
  CoachNoteRow, DietNoteRow, WorkoutPlanRow, DietSuggestionRow, Id,
} from '../types'

/** Tables with '++id' primary keys: new rows get UUID string ids so inserts
 * made on different devices can never collide (legacy integer ids remain). */
const UUID_TABLES = new Set([
  'exercises', 'templates', 'sessions', 'sets', 'foods', 'foodLogs',
  'savedMeals', 'scoreEvents', 'seasons', 'waterLogs', 'tombstones',
])

/* ---------- sync tracking (dirty flag + suspension during imports) ---------- */

const DIRTY_KEY = 'gymtracker-sync-dirty'
let suspended = false
const dirtyListeners = new Set<() => void>()

export function onSyncDirty(listener: () => void): () => void {
  dirtyListeners.add(listener)
  return () => dirtyListeners.delete(listener)
}

export function isSyncDirty(): boolean {
  try {
    return localStorage.getItem(DIRTY_KEY) === '1'
  } catch {
    return false
  }
}

export function setSyncDirty(dirty: boolean): void {
  try {
    if (dirty) localStorage.setItem(DIRTY_KEY, '1')
    else localStorage.removeItem(DIRTY_KEY)
  } catch {
    /* storage unavailable (tests) */
  }
}

function markDirty(): void {
  if (suspended) return
  setSyncDirty(true)
  dirtyListeners.forEach(l => l())
}

/** Run fn with sync tracking off (snapshot imports must not stamp/mark dirty). */
export async function withSyncTrackingSuspended<T>(fn: () => Promise<T>): Promise<T> {
  suspended = true
  try {
    return await fn()
  } finally {
    suspended = false
  }
}

export class GymDB extends Dexie {
  exercises!: Table<Exercise, Id>
  templates!: Table<WorkoutTemplate, Id>
  sessions!: Table<Session, Id>
  sets!: Table<SetRow, Id>
  foods!: Table<Food, Id>
  foodLogs!: Table<FoodLog, Id>
  savedMeals!: Table<SavedMeal, Id>
  settings!: Table<Settings, number>
  rankState!: Table<RankState, number>
  scoreEvents!: Table<ScoreEvent, Id>
  seasons!: Table<Season, Id>
  dayTypes!: Table<DayType, string>
  bodyLog!: Table<BodyLogEntry, string>
  waterLogs!: Table<WaterLog, Id>
  achievements!: Table<AchievementUnlock, string>
  quests!: Table<QuestState, string>
  tombstones!: Table<Tombstone, Id>
  /** Device-local AI coach cache, keyed by session. Excluded from sync/backups. */
  coachNotes!: Table<CoachNoteRow, Id>
  /** Device-local AI diet cache, keyed by day. Excluded from sync/backups. */
  dietNotes!: Table<DietNoteRow, string>
  /** Device-local AI pre-workout weight/rep plan, keyed by session. Excluded from sync/backups. */
  workoutSuggestions!: Table<WorkoutPlanRow, Id>
  /** Device-local AI macro-completion suggestion, keyed by day. Excluded from sync/backups. */
  dietSuggestions!: Table<DietSuggestionRow, string>

  constructor() {
    super('gymtracker')
    this.version(1).stores({
      exercises: '++id, nameLower, muscleGroup',
      templates: '++id, name, position',
      sessions: '++id, startedAt, templateId',
      sets: '++id, sessionId, exerciseId, [exerciseId+completedAt]',
      foods: '++id, nameLower, &offId, lastUsedAt',
      foodLogs: '++id, date, [date+meal], foodId',
      savedMeals: '++id, name, lastUsedAt',
      settings: 'id',
      rankState: 'id',
      scoreEvents: '++id, date, sessionId',
      seasons: '++id, startDate',
    })
    this.version(2).stores({
      dayTypes: 'date',
    })
    this.version(3).stores({
      bodyLog: 'date',
      waterLogs: '++id, date',
      achievements: 'id',
      quests: 'weekKey',
    })
    this.version(4).stores({
      tombstones: '++id, deletedAt',
    })
    // Device-local AI coach cache. Keyed by sessionId (not '++id'), so no UUID
    // assignment is needed; kept out of backup.ts TABLES so it never syncs.
    this.version(5).stores({
      coachNotes: 'sessionId',
    })
    // Device-local AI diet cache, keyed by day. Also excluded from backup.ts TABLES.
    this.version(6).stores({
      dietNotes: 'date',
    })
    // Device-local AI action suggestions: pre-workout weight/rep plans (by session)
    // and macro-completion suggestions (by day). Natural keys (no UUID); kept out
    // of backup.ts TABLES so they never sync/export. Derived, per-device data.
    this.version(7).stores({
      workoutSuggestions: 'sessionId',
      dietSuggestions: 'date',
    })

    // Sync middleware: UUID ids for new rows, updatedAt stamps, dirty tracking.
    this.use({
      stack: 'dbcore',
      name: 'gymtracker-sync',
      create: down => ({
        ...down,
        table: name => {
          const table = down.table(name)
          return {
            ...table,
            mutate: req => {
              if (!suspended) {
                if (req.type === 'add' || req.type === 'put') {
                  const now = Date.now()
                  for (const value of req.values as Array<Record<string, unknown>>) {
                    if (value && typeof value === 'object') {
                      if (req.type === 'add' && UUID_TABLES.has(name) && value.id === undefined) {
                        value.id = crypto.randomUUID()
                      }
                      value.updatedAt = now
                    }
                  }
                }
                markDirty()
              }
              return table.mutate(req)
            },
          }
        },
      }),
    })
  }
}

export const db = new GymDB()

/** Delete + tombstone in one transaction so the removal syncs across devices. */
export async function deleteWithTombstone(tableName: string, key: Id): Promise<void> {
  await db.transaction('rw', db.table(tableName), db.tombstones, async () => {
    await db.table(tableName).delete(key)
    await db.tombstones.add({ table: tableName, rowId: key, deletedAt: Date.now() })
  })
}

/** Bulk variant used when deleting a session with all its sets/events. */
export async function tombstoneKeys(tableName: string, keys: Id[]): Promise<void> {
  const now = Date.now()
  await db.tombstones.bulkAdd(keys.map(rowId => ({ table: tableName, rowId, deletedAt: now })))
}
