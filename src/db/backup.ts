import { db } from './db'
import { localDateStr } from '../lib/dates'

const TABLES = [
  'exercises', 'templates', 'sessions', 'sets', 'foods', 'foodLogs',
  'savedMeals', 'settings', 'rankState', 'scoreEvents', 'seasons',
] as const

type TableName = (typeof TABLES)[number]

interface BackupFile {
  app: 'gymtracker'
  version: 1
  exportedAt: number
  tables: Record<TableName, unknown[]>
}

export async function exportBackup(): Promise<void> {
  const tables = {} as Record<TableName, unknown[]>
  for (const name of TABLES) {
    tables[name] = await db.table(name).toArray()
  }
  const payload: BackupFile = { app: 'gymtracker', version: 1, exportedAt: Date.now(), tables }
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

/** Replaces ALL current data with the backup's contents. */
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
  await db.transaction('rw', TABLES.map(t => db.table(t)), async () => {
    for (const name of TABLES) {
      const rows = parsed.tables[name]
      await db.table(name).clear()
      if (Array.isArray(rows) && rows.length > 0) {
        await db.table(name).bulkPut(rows)
      }
    }
  })
}
