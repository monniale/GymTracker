import { db, withSyncTrackingSuspended, setSyncDirty } from './db'
import { localDateStr } from '../lib/dates'

export const TABLES = [
  'exercises', 'templates', 'sessions', 'sets', 'foods', 'foodLogs',
  'savedMeals', 'settings', 'rankState', 'scoreEvents', 'seasons', 'dayTypes',
  'bodyLog', 'waterLogs', 'achievements', 'quests', 'tombstones',
] as const

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
 * itself doesn't stamp updatedAt or mark the device dirty. */
export async function applyTables(tables: Partial<TableDump>): Promise<void> {
  await withSyncTrackingSuspended(() =>
    db.transaction('rw', TABLES.map(t => db.table(t)), async () => {
      for (const name of TABLES) {
        const rows = tables[name]
        await db.table(name).clear()
        if (Array.isArray(rows) && rows.length > 0) {
          await db.table(name).bulkPut(rows)
        }
      }
    }),
  )
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
    throw new Error('Not a valid JSON file.')
  }
  if (parsed.app !== 'gymtracker' || !parsed.tables) {
    throw new Error('Not a GymTracker backup file.')
  }
  await applyTables(parsed.tables)
  // A manual restore is a local change relative to any sync remote.
  setSyncDirty(true)
}
