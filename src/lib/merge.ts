/**
 * Pure snapshot merge for two-device sync ("snapshot ping-pong with CAS and
 * row-merge fallback"). Runs only when BOTH devices changed since the last
 * common sync point; fast-forward pulls/pushes replace wholesale and never
 * come through here.
 *
 * Per-table policies (from the sync design research):
 * - append-mostly tables union by primary key (UUID ids never collide;
 *   legacy integer ids are identical on both devices by bootstrap).
 * - singletons (settings, rankState) resolve last-write-wins by updatedAt;
 *   rank points are then RECOMPUTED from the merged score events so training
 *   done on both devices all counts.
 * - natural-key tables (bodyLog/dayTypes by date, achievements by id,
 *   quests by weekKey, seasons by seasonId) union by that key.
 * - quests item-merge with done=OR so a completed quest never un-completes.
 * - foods dedupe by barcode (offId) with a bounded FK remap into foodLogs and
 *   savedMeals (two devices scanning the same product offline).
 * - tombstones propagate deletes: a row is dropped when a tombstone is newer
 *   than the row's last update.
 */
import type {
  Exercise, WorkoutTemplate, Session, SetRow, Food, FoodLog, SavedMeal,
  Settings, RankState, ScoreEvent, Season, DayType, BodyLogEntry, WaterLog,
  AchievementUnlock, QuestState, Tombstone, Id,
} from '../types'
import { SEASON_CARRYOVER } from './ranks'

export interface SnapshotTables {
  exercises: Exercise[]
  templates: WorkoutTemplate[]
  sessions: Session[]
  sets: SetRow[]
  foods: Food[]
  foodLogs: FoodLog[]
  savedMeals: SavedMeal[]
  settings: Settings[]
  rankState: RankState[]
  scoreEvents: ScoreEvent[]
  seasons: Season[]
  dayTypes: DayType[]
  bodyLog: BodyLogEntry[]
  waterLogs: WaterLog[]
  achievements: AchievementUnlock[]
  quests: QuestState[]
  tombstones: Tombstone[]
}

export interface SyncPayload {
  app: 'gymtracker'
  version: 2
  exportedAt: number
  deviceId: string
  tables: SnapshotTables
}

export const TOMBSTONE_RETENTION_MS = 90 * 86_400_000

type Stamped = { updatedAt?: number }

function ts(row: Stamped | undefined): number {
  return row?.updatedAt ?? 0
}

/** Union two row sets by key; on key collision the later-updated row wins. */
function unionByKey<T extends Stamped>(
  local: T[],
  remote: T[],
  keyOf: (row: T) => string,
  resolve: (l: T, r: T) => T = (l, r) => (ts(r) > ts(l) ? r : l),
): T[] {
  const out = new Map<string, T>()
  for (const row of local) out.set(keyOf(row), row)
  for (const row of remote) {
    const key = keyOf(row)
    const existing = out.get(key)
    out.set(key, existing === undefined ? row : resolve(existing, row))
  }
  return [...out.values()]
}

const byId = (row: Stamped) => String((row as { id?: Id }).id)

export interface MergeResult {
  tables: SnapshotTables
  /** human-readable notes for logging/debug */
  notes: string[]
}

export function mergeSnapshots(local: SyncPayload, remote: SyncPayload, now: number): MergeResult {
  const L = local.tables
  const R = remote.tables
  const notes: string[] = []

  /* ---- tombstones first: they gate every other table ---- */
  const tombstones = unionByKey(L.tombstones ?? [], R.tombstones ?? [], byId)
    .filter(t => now - t.deletedAt < TOMBSTONE_RETENTION_MS)
  const deadline = new Map<string, number>()
  for (const t of tombstones) {
    const key = `${t.table}:${String(t.rowId)}`
    deadline.set(key, Math.max(deadline.get(key) ?? 0, t.deletedAt))
  }
  function alive<T extends Stamped>(table: string, keyOf: (row: T) => string) {
    return (row: T): boolean => {
      const died = deadline.get(`${table}:${keyOf(row)}`)
      if (died === undefined) return true
      // A row edited after its deletion elsewhere is an intentional resurrection.
      return ts(row) > died
    }
  }

  /* ---- plain unions ---- */
  const exercises = unionByKey(L.exercises, R.exercises, byId)
    .filter(alive('exercises', byId))
  const templates = unionByKey(L.templates, R.templates, byId,
    (l, r) => ((r.updatedAt ?? 0) > (l.updatedAt ?? 0) ? r : l))
    .filter(alive('templates', byId))
  const sessions = unionByKey(L.sessions, R.sessions, byId)
    .filter(alive('sessions', byId))
  const sets = unionByKey(L.sets, R.sets, byId)
    .filter(alive('sets', byId))
  const foodLogsRaw = unionByKey(L.foodLogs, R.foodLogs, byId)
    .filter(alive('foodLogs', byId))
  const savedMealsRaw = unionByKey(L.savedMeals, R.savedMeals, byId,
    (l, r) => {
      const winner = ts(r) > ts(l) ? r : l
      return { ...winner, lastUsedAt: Math.max(l.lastUsedAt ?? 0, r.lastUsedAt ?? 0) }
    })
    .filter(alive('savedMeals', byId))
  const waterLogs = unionByKey(L.waterLogs, R.waterLogs, byId)
    .filter(alive('waterLogs', byId))
  const bodyLog = unionByKey(L.bodyLog, R.bodyLog, row => row.date)
    .filter(alive('bodyLog', row => row.date))
  const dayTypes = unionByKey(L.dayTypes, R.dayTypes, row => row.date)
    .filter(alive('dayTypes', row => row.date))
  const achievements = unionByKey(L.achievements, R.achievements, row => row.id,
    (l, r) => ({ ...l, unlockedAt: Math.min(l.unlockedAt, r.unlockedAt) }))

  /* ---- seasons: same archived season may exist on both devices with
     different row ids — key by seasonId, not id ---- */
  const seasons = unionByKey(L.seasons, R.seasons, row => `s${row.seasonId}`)

  /* ---- quests: item-wise OR so completed quests never regress ---- */
  const quests = unionByKey(L.quests, R.quests, row => row.weekKey, (l, r) => {
    const items = new Map(l.quests.map(q => [q.id, { ...q }]))
    for (const rq of r.quests) {
      const lq = items.get(rq.id)
      if (!lq) {
        items.set(rq.id, { ...rq })
      } else {
        const awarded = [lq.awardedAt, rq.awardedAt].filter((x): x is number => x !== undefined)
        items.set(rq.id, {
          id: rq.id,
          done: lq.done || rq.done,
          awardedAt: awarded.length ? Math.min(...awarded) : undefined,
        })
      }
    }
    return { ...(ts(r) > ts(l) ? r : l), quests: [...items.values()] }
  })

  /* ---- scoreEvents: union by id, then collapse duplicate non-session awards
     (the same quest completed independently on both devices) ---- */
  const eventsUnion = unionByKey(L.scoreEvents, R.scoreEvents, byId)
    .filter(alive('scoreEvents', byId))
  const seenLabel = new Map<string, ScoreEvent>()
  const scoreEvents: ScoreEvent[] = []
  for (const e of eventsUnion) {
    if (e.label) {
      const key = `${e.date}|${e.label}`
      const prior = seenLabel.get(key)
      if (prior) {
        notes.push(`deduped duplicate award "${e.label}" on ${e.date}`)
        continue
      }
      seenLabel.set(key, e)
    }
    scoreEvents.push(e)
  }

  /* ---- foods: union by id, then dedupe barcode duplicates + remap FKs ---- */
  const foodsUnion = unionByKey(L.foods, R.foods, byId, (l, r) => {
    if (l.userOverridden !== r.userOverridden) return l.userOverridden ? l : r
    return ts(r) > ts(l) ? r : l
  }).filter(alive('foods', byId))
  const byOff = new Map<string, Food[]>()
  for (const f of foodsUnion) {
    if (!f.offId) continue
    const list = byOff.get(f.offId) ?? []
    list.push(f)
    byOff.set(f.offId, list)
  }
  const remap = new Map<string, Id>()
  const dropped = new Set<string>()
  for (const [offId, group] of byOff) {
    if (group.length < 2) continue
    const winner = [...group].sort((a, b) => {
      if (a.userOverridden !== b.userOverridden) return a.userOverridden ? -1 : 1
      return Math.max(ts(b), b.lastUsedAt ?? 0) - Math.max(ts(a), a.lastUsedAt ?? 0)
    })[0]
    for (const f of group) {
      if (f === winner) continue
      remap.set(String(f.id), winner.id!)
      dropped.add(String(f.id))
      notes.push(`deduped barcode ${offId}: ${String(f.id)} -> ${String(winner.id)}`)
    }
  }
  const foods = foodsUnion.filter(f => !dropped.has(String(f.id)))
  const foodLogs = foodLogsRaw.map(log =>
    remap.has(String(log.foodId)) ? { ...log, foodId: remap.get(String(log.foodId))! } : log)
  const savedMeals = savedMealsRaw.map(meal => ({
    ...meal,
    items: meal.items.map(it =>
      remap.has(String(it.foodId)) ? { ...it, foodId: remap.get(String(it.foodId))! } : it),
  }))

  /* ---- settings: singleton LWW ---- */
  const settings = pickSingleton(L.settings, R.settings)

  /* ---- rankState: LWW base (prefer the further-along season), points
     recomputed from merged events so both devices' training counts ---- */
  const rankState = mergeRankState(L.rankState, R.rankState, scoreEvents, seasons, notes)

  return {
    tables: {
      exercises, templates, sessions, sets, foods, foodLogs, savedMeals,
      settings, rankState, scoreEvents, seasons, dayTypes, bodyLog, waterLogs,
      achievements, quests, tombstones,
    },
    notes,
  }
}

function pickSingleton<T extends Stamped>(local: T[], remote: T[]): T[] {
  const l = local[0]
  const r = remote[0]
  if (!l) return r ? [r] : []
  if (!r) return [l]
  return [ts(r) > ts(l) ? r : l]
}

function mergeRankState(
  local: RankState[],
  remote: RankState[],
  scoreEvents: ScoreEvent[],
  seasons: Season[],
  notes: string[],
): RankState[] {
  const l = local[0]
  const r = remote[0]
  if (!l || !r) return l ? [l] : r ? [r] : []

  let base: RankState
  if (l.seasonId !== r.seasonId) {
    base = l.seasonId > r.seasonId ? l : r // one device already rolled the season
  } else {
    base = ts(r as Stamped) > ts(l as Stamped) ? r : l
  }

  const prev = seasons.find(s => s.seasonId === base.seasonId - 1)
  const carry = prev ? Math.round(prev.finalPoints * SEASON_CARRYOVER) : 0
  const seasonSum = scoreEvents
    .filter(e => e.date >= base.seasonStart)
    .reduce((acc, e) => acc + e.total, 0)
  const points = Math.max(0, Math.round(carry + seasonSum - base.idleDecayTaken))
  if (points !== base.points) {
    notes.push(`rankState points recomputed ${base.points} -> ${points}`)
  }
  return [{ ...base, points }]
}
