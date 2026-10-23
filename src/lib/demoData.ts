import { db, withSyncTrackingSuspended, setSyncDirty } from '../db/db'
import { applyTables, TABLES, type BackupFile, type TableDump, type TableName } from '../db/backup'
import { ensureSeeded } from '../db/seed'
import { addDays, daysBetween, localDateStr } from './dates'
import { withSyncLock, isConnected, useSyncStore } from './sync'
import { useUiStore } from './uiStore'
import { useAppStore } from '../store'
import { t } from '../i18n'

/**
 * Demo data for a first look at the web app (docs/FEATURE_PLAN.md, feature 3). The demo is a
 * committed backup file (`public/demo-backup.json`, built by `npm run demo:build`) in the exact
 * `BackupFile` format of db/backup.ts. Loading it moves every date forward by whole weeks so the
 * history ends in the last few days, then flags the device (`uiStore.demoLoaded`): while the flag is
 * on, sync is blocked so made-up data never reaches a sync repo.
 */
export const DEMO_URL = `${import.meta.env.BASE_URL}demo-backup.json`

/**
 * The zone the demo was generated in (`npm run demo:build` pins TZ=Europe/Rome). Its epoch-ms
 * timestamps are re-read as Rome wall-clock times in the viewer's zone, so a session's local day
 * still matches its day strings (scoreEvents.date, rankState.lastSessionDate) east or west of Rome.
 */
export const DEMO_TZ = 'Europe/Rome'

/** Device-local keys the weekly review card keeps in localStorage (WeekCoachCard.tsx). */
const WEEK_REVIEW_AUTO_KEY = 'gymtracker-week-review-auto'

interface DateFields {
  /** Local calendar days, YYYY-MM-DD ('' or absent = unset, kept as is). */
  days?: readonly string[]
  /** Epoch-ms timestamps (0 or absent = unset, kept as is: seed rows carry updatedAt 0). */
  ms?: readonly string[]
}

/**
 * Every date-like field of every synced table (types.ts). Typed by `TableName`, so a table added to
 * backup.ts TABLES does not compile until it is listed here. Nested ones (quests[].awardedAt and
 * tombstones of date-keyed rows) are handled in `rebaseRow`.
 */
const DATE_FIELDS: Record<TableName, DateFields> = {
  exercises: { ms: ['updatedAt'] },
  templates: { ms: ['updatedAt'] },
  sessions: { ms: ['startedAt', 'endedAt', 'updatedAt'] },
  sets: { ms: ['completedAt', 'updatedAt'] },
  foods: { ms: ['lastUsedAt', 'updatedAt'] },
  foodLogs: { days: ['date'], ms: ['loggedAt', 'updatedAt'] },
  savedMeals: { ms: ['lastUsedAt', 'updatedAt'] },
  settings: { ms: ['updatedAt'] },
  rankState: {
    days: ['seasonStart', 'lastStreakWeek', 'lastSessionDate', 'lastDecayCheckDate'],
    ms: ['updatedAt'],
  },
  scoreEvents: { days: ['date'], ms: ['updatedAt'] },
  seasons: { days: ['startDate', 'endDate'], ms: ['updatedAt'] },
  dayTypes: { days: ['date'], ms: ['updatedAt'] },
  bodyLog: { days: ['date'], ms: ['updatedAt'] },
  waterLogs: { days: ['date'], ms: ['updatedAt'] },
  achievements: { ms: ['unlockedAt', 'updatedAt'] },
  quests: { days: ['weekKey'], ms: ['updatedAt'] },
  tombstones: { ms: ['deletedAt', 'updatedAt'] },
  coachHistory: { days: ['date'], ms: ['generatedAt', 'updatedAt'] },
  plannedFoods: { days: ['date'], ms: ['plannedAt', 'updatedAt'] },
  programs: { days: ['cycleStartDate'], ms: ['endedAt', 'updatedAt'] },
}

/** Tables whose primary key is a local day: a tombstone of one of their rows names it by date. */
const DATE_KEYED_TABLES: ReadonlySet<string> = new Set<TableName>(['dayTypes', 'bodyLog', 'quests'])

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

function shiftDay(value: unknown, days: number): unknown {
  return typeof value === 'string' && DAY_RE.test(value) ? addDays(value, days) : value
}

const zoneFormats = new Map<string, Intl.DateTimeFormat | null>()

function zoneFormat(zone: string): Intl.DateTimeFormat | null {
  if (!zoneFormats.has(zone)) {
    let f: Intl.DateTimeFormat | null = null
    try {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone: zone, hourCycle: 'h23',
        year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
      })
    } catch {
      f = null // unknown zone: keep the instants as they are
    }
    zoneFormats.set(zone, f)
  }
  return zoneFormats.get(zone) ?? null
}

/**
 * The instant that shows, in this device's zone, the wall-clock time `ms` showed in `zone`
 * (18:30 on a Monday in Rome becomes 18:30 on that Monday here). Identity when this device is in
 * `zone` or the zone is unknown.
 */
export function reanchorMs(ms: number, zone: string): number {
  const f = zoneFormat(zone)
  if (!f) return ms
  const p: Record<string, number> = {}
  for (const part of f.formatToParts(new Date(ms))) {
    if (part.type !== 'literal') p[part.type] = Number(part.value)
  }
  const local = new Date(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second, ((ms % 1000) + 1000) % 1000)
  return Number.isFinite(local.getTime()) ? local.getTime() : ms
}

/**
 * The same `zone` wall-clock time `days` local calendar days later, here (DST-safe, unlike adding
 * n × 86 400 000).
 */
function shiftMs(value: unknown, days: number, zone: string): unknown {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return value
  const d = new Date(reanchorMs(value, zone))
  d.setDate(d.getDate() + days)
  return d.getTime()
}

/**
 * Whole days (a multiple of 7) to move the demo forward: the largest number of whole weeks that
 * keeps the export day on or before today. The export day lands on the same weekday within the last
 * 7 days, so the demo's last week becomes the current week whenever today's weekday is on or after
 * the export day's (always, for an export stamped on a Monday). 0 when today is before the export.
 */
export function demoShiftDays(exportedAt: number, todayMs: number): number {
  const diff = daysBetween(localDateStr(new Date(exportedAt)), localDateStr(new Date(todayMs)))
  return diff > 0 ? Math.floor(diff / 7) * 7 : 0
}

/**
 * Whole days to move the planned meals forward: they are planned relative to the export day
 * ("tomorrow's lunch"), so they follow today exactly instead of by whole weeks. 0 when today is
 * before the export.
 */
export function demoPlanShiftDays(exportedAt: number, todayMs: number): number {
  const diff = daysBetween(localDateStr(new Date(exportedAt)), localDateStr(new Date(todayMs)))
  return diff > 0 ? diff : 0
}

function rebaseRow(table: TableName, row: unknown, days: number, zone: string): unknown {
  if (!row || typeof row !== 'object') return row
  const out: Record<string, unknown> = { ...(row as Record<string, unknown>) }
  const fields = DATE_FIELDS[table]
  for (const k of fields.days ?? []) if (k in out) out[k] = shiftDay(out[k], days)
  for (const k of fields.ms ?? []) if (k in out) out[k] = shiftMs(out[k], days, zone)
  if (table === 'quests' && Array.isArray(out.quests)) {
    out.quests = out.quests.map(q =>
      q && typeof q === 'object' && 'awardedAt' in q
        ? { ...q, awardedAt: shiftMs((q as { awardedAt: unknown }).awardedAt, days, zone) }
        : q)
  }
  if (table === 'tombstones' && DATE_KEYED_TABLES.has(String(out.table))) {
    out.rowId = shiftDay(out.rowId, days)
  }
  return out
}

/**
 * Pure: a copy of `tables` with every date and timestamp moved forward by the same whole number of
 * weeks (`demoShiftDays`). Weekdays, order and Monday keys (quests.weekKey, rankState.lastStreakWeek,
 * weekly coach verdict dates) all survive the shift. The planned meals are the exception: they move
 * by the exact number of days (`demoPlanShiftDays`), so a meal planned for the day after the export
 * is planned for tomorrow. Every timestamp is first re-read as a `zone` wall-clock time in this
 * device's zone (`reanchorMs`), so days and timestamps agree in any zone. Tables outside TABLES are
 * dropped.
 */
export function rebaseDemoTables(
  tables: Partial<TableDump>,
  exportedAt: number,
  todayMs: number,
  zone: string = DEMO_TZ,
): Partial<TableDump> {
  const exported = reanchorMs(exportedAt, zone)
  const days = demoShiftDays(exported, todayMs)
  const planDays = demoPlanShiftDays(exported, todayMs)
  const out: Partial<TableDump> = {}
  for (const name of TABLES) {
    const rows = tables[name]
    if (!Array.isArray(rows)) continue
    const shift = name === 'plannedFoods' ? planDays : days
    out[name] = rows.map(r => rebaseRow(name, r, shift, zone))
  }
  return out
}

/**
 * Tables that only ever hold what the user entered or did (no seed rows): one row in any of them
 * means real data that loading the demo would replace. Rank, score, season, achievement, quest and
 * tombstone rows are derived from these or are bookkeeping, so they do not count.
 */
const USER_TABLES = [
  'templates', 'sessions', 'sets', 'foods', 'foodLogs', 'savedMeals', 'dayTypes', 'bodyLog',
  'waterLogs', 'coachHistory', 'plannedFoods', 'programs',
] as const satisfies readonly TableName[]

/**
 * True when the device holds anything the user made: a row in a user table, a custom or edited
 * exercise, or edited settings. Seed rows carry `updatedAt: 0` (seed.ts) and every tracked write
 * stamps a later time, so an untouched install has none of these.
 */
export async function hasUserData(): Promise<boolean> {
  for (const name of USER_TABLES) {
    if ((await db.table(name).count()) > 0) return true
  }
  if ((await db.exercises.filter(e => e.isCustom || (e.updatedAt ?? 0) > 0).count()) > 0) return true
  const settings = await db.settings.get(1)
  return (settings?.updatedAt ?? 0) > 0
}

/**
 * Pure: whether to offer "Try with demo data". Web only (Android keeps its RestoreCard), never
 * while the demo is already loaded, never on a device connected to a sync repo (clearing the demo
 * later must not leave it believing it is in sync with a remote it no longer holds), and never
 * when the device has real data (loading the demo replaces every table).
 */
export function canOfferDemo(o: {
  isNative: boolean
  demoLoaded: boolean
  connected: boolean
  hasUserData: boolean
}): boolean {
  return !o.isNative && !o.demoLoaded && !o.connected && !o.hasUserData
}

/**
 * Throws when the demo must not replace this device's data (see `canOfferDemo`). The sync store is
 * re-read first: another tab may have connected since this one loaded.
 */
async function assertDemoAllowed(): Promise<void> {
  await useSyncStore.persist.rehydrate()
  if (isConnected()) throw new Error(t('data.demo.connected'))
  if (await hasUserData()) throw new Error(t('data.demo.notEmpty'))
}

/**
 * Removes what the demo leaves on the device outside the synced tables: the device-local AI caches
 * and the weekly review's auto marker. Shared by clearDemoData and importBackup (db/backup.ts).
 */
export async function clearDemoLeftovers(): Promise<void> {
  await withSyncTrackingSuspended(() =>
    db.transaction('rw', [db.coachNotes, db.dietNotes, db.workoutSuggestions, db.dietSuggestions], async () => {
      await Promise.all([
        db.coachNotes.clear(),
        db.dietNotes.clear(),
        db.workoutSuggestions.clear(),
        db.dietSuggestions.clear(),
      ])
    }),
  )
  try {
    localStorage.removeItem(WEEK_REVIEW_AUTO_KEY)
  } catch {
    /* storage unavailable */
  }
}

function isDemoFile(x: unknown): x is BackupFile {
  if (!x || typeof x !== 'object') return false
  const f = x as Partial<BackupFile>
  return f.app === 'gymtracker' && f.version === 2 && typeof f.exportedAt === 'number'
    && !!f.tables && typeof f.tables === 'object'
}

/**
 * Replaces all data with the demo backup (web first run only; the Android app keeps its RestoreCard).
 * Refuses while the device is connected to a sync repo or holds real data; the check runs again on
 * the sync lock, after any queued pass (e.g. the launch pull). The write is not a local change: the
 * device is left clean, and the demo flag goes on before the lock is released so no queued sync pass
 * can see the demo rows.
 */
export async function loadDemoData(): Promise<void> {
  await assertDemoAllowed()
  let res: Response
  try {
    res = await fetch(DEMO_URL)
  } catch {
    throw new Error(t('data.github.network'))
  }
  if (!res.ok) throw new Error(t('data.github.network'))
  let parsed: unknown
  try {
    parsed = await res.json()
  } catch {
    throw new Error(t('data.backup.invalidJson'))
  }
  if (!isDemoFile(parsed)) throw new Error(t('data.backup.notBackup'))
  const tables = rebaseDemoTables(parsed.tables, parsed.exportedAt, Date.now())
  await withSyncLock(async () => {
    await assertDemoAllowed()
    await applyTables(tables)
    setSyncDirty(false)
    useUiStore.getState().setDemoLoaded(true)
    useAppStore.getState().setActiveSessionId(null)
  })
}

/**
 * Wipes the demo: every synced table (explicit [] for each, so LATE_TABLES rows go too, along with
 * anything the user added while the demo was loaded), the device-local AI caches and the weekly
 * review's auto marker, then seeds the catalog again. The device ends clean (nothing to push) and
 * the demo flag off, so sync can run again. The last synced sha is forgotten too, so a connected
 * device sees the remote as moved and pulls it instead of pushing the near-empty database over it.
 * The sync store is re-read before that write, so a connection another tab saved since this tab
 * loaded is kept rather than overwritten with this tab's stale copy.
 */
export async function clearDemoData(): Promise<void> {
  const empty = Object.fromEntries(TABLES.map(name => [name, []])) as unknown as TableDump
  await withSyncLock(async () => {
    await applyTables(empty)
    await clearDemoLeftovers()
    await ensureSeeded()
    useAppStore.getState().setActiveSessionId(null)
    await useSyncStore.persist.rehydrate()
    useSyncStore.setState({ lastSyncedSha: null })
    setSyncDirty(false)
    useUiStore.getState().setDemoLoaded(false)
  })
}

/** True while the database holds the demo data (uiStore.demoLoaded). */
export function isDemoLoaded(): boolean {
  return useUiStore.getState().demoLoaded
}
