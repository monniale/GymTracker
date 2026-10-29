import { db, deleteWithTombstone, tombstoneKeys } from '../db/db'
import type { Id, Supplement } from '../types'

/** Natural key of a day's intake: the same row on every device that logs it. */
export function supplementLogId(supplementId: Id, date: string): string {
  return `${supplementId}|${date}`
}

/** Active supplements in Diet-screen order. */
export function sortSupplements(list: Supplement[]): Supplement[] {
  return [...list].sort((a, b) => a.position - b.position || a.createdAt - b.createdAt)
}

export async function addSupplement(fields: { name: string; dose?: string; time: string }): Promise<Id> {
  const last = await db.supplements.orderBy('position').last()
  return db.supplements.add({
    name: fields.name.trim(),
    dose: fields.dose?.trim() || undefined,
    time: fields.time,
    position: (last?.position ?? -1) + 1,
    createdAt: Date.now(),
  })
}

export async function updateSupplement(id: Id, fields: { name: string; dose?: string; time: string }): Promise<void> {
  await db.supplements.update(id, { name: fields.name.trim(), dose: fields.dose?.trim() || undefined, time: fields.time })
}

/** Deletes the supplement and its intake history; both deletes reach the other devices. */
export async function deleteSupplement(id: Id): Promise<void> {
  await db.transaction('rw', db.supplements, db.supplementLogs, db.tombstones, async () => {
    const logKeys = await db.supplementLogs.where('supplementId').equals(id).primaryKeys()
    await db.supplementLogs.bulkDelete(logKeys)
    await tombstoneKeys('supplementLogs', logKeys)
    await deleteWithTombstone('supplements', id)
  })
}

/** Marks a supplement taken (or not) on `date`. Taking it today cancels that day's reminder. */
export async function setSupplementTaken(supplementId: Id, date: string, taken: boolean): Promise<void> {
  const id = supplementLogId(supplementId, date)
  if (taken) await db.supplementLogs.put({ id, supplementId, date, takenAt: Date.now() })
  else if (await db.supplementLogs.get(id)) await deleteWithTombstone('supplementLogs', id)
}
