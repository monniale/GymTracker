import { db, withSyncTrackingSuspended, setSyncDirty, emitDataReplaced } from './db'
import { localDateStr } from '../lib/dates'
import { isNative } from '../native/platform'
import { t } from '../i18n'

export const TABLES = [
  'exercises', 'templates', 'sessions', 'sets', 'foods', 'foodLogs',
  'savedMeals', 'settings', 'rankState', 'scoreEvents', 'seasons', 'dayTypes',
  'bodyLog', 'waterLogs', 'achievements', 'quests', 'tombstones', 'coachHistory',
  'plannedFoods',
] as const

/**
 * Tables added after snapshot format v2 shipped. A snapshot or backup that has no
 * entry for one of them comes from an app build that predates it (e.g. the PWA
 * not yet updated, syncing with the phone): applying it keeps this device's rows
 * instead of clearing them, and the next push puts them back in the cloud copy.
 */
const LATE_TABLES: ReadonlySet<TableName> = new Set<TableName>(['coachHistory', 'plannedFoods'])

export type TableName = (typeof TABLES)[number]
export type TableDump = Record<TableName, unknown[]>

export interface BackupFile {
  app: 'gymtracker'
  version: 1 | 2
  exportedAt: number
  deviceId?: string
  tables: Partial<TableDump>
}

export async function collectTables(): Promise<TableDump> {
  const tables = {} as TableDump
  for (const name of TABLES) {
    tables[name] = await db.table(name).toArray()
  }
  return tables
}

/** Wholesale replace of all tables. Sync tracking suspended so the import
 * itself doesn't stamp updatedAt or mark the device dirty. Covers both
 * `importBackup` and the sync pull/merge, so it announces the replacement
 * (`onDataReplaced`) to listeners the suspended writes bypass. Resolves true
 * when it kept local rows of a LATE_TABLES table the snapshot lacked, i.e. this
 * device now holds data the cloud copy is missing. */
export async function applyTables(tables: Partial<TableDump>): Promise<boolean> {
  let keptLocal = false
  await withSyncTrackingSuspended(() =>
    db.transaction('rw', TABLES.map(t => db.table(t)), async () => {
      for (const name of TABLES) {
        const rows = tables[name]
        if (rows === undefined && LATE_TABLES.has(name)) {
          if ((await db.table(name).count()) > 0) keptLocal = true
          continue
        }
        await db.table(name).clear()
        if (Array.isArray(rows) && rows.length > 0) {
          await db.table(name).bulkPut(rows)
        }
      }
    }),
  )
  emitDataReplaced()
  return keptLocal
}

export async function exportBackup(): Promise<void> {
  const payload: BackupFile = {
    app: 'gymtracker',
    version: 2,
    exportedAt: Date.now(),
    tables: await collectTables(),
  }
  const json = JSON.stringify(payload)
  const fileName = `gymtracker-backup-${localDateStr()}.json`

  // Android app: the WebView has no file share and ignores <a download> —
  // write to the cache and open the system share sheet (Drive, Files…).
  if (isNative) {
    const { shareTextFile } = await import('../native/files')
    await shareTextFile(fileName, json)
    return
  }

  const file = new File([json], fileName, { type: 'application/json' })

  // Share sheet on iOS (lets the user save to Files/iCloud); download elsewhere.
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] })
      return
    } catch {
      // Cancelled or unsupported — fall through to download.
    }
  }
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

/** Replaces ALL current data with the backup's contents (v1 or v2 files). */
export async function importBackup(fileText: string): Promise<void> {
  let parsed: BackupFile
  try {
    parsed = JSON.parse(fileText)
  } catch {
    throw new Error(t('data.backup.invalidJson'))
  }
  if (parsed.app !== 'gymtracker' || !parsed.tables) {
    throw new Error(t('data.backup.notBackup'))
  }
  await applyTables(parsed.tables)
  // A manual restore is a local change relative to any sync remote.
  setSyncDirty(true)
}
