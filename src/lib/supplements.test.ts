import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../db/db'
import { ensureSeeded } from '../db/seed'
import { addSupplement, deleteSupplement, setSupplementTaken, sortSupplements, supplementLogId, updateSupplement } from './supplements'

beforeEach(async () => {
  db.close()
  await Dexie.delete('gymtracker')
  await db.open()
  await ensureSeeded()
})

describe('supplements', () => {
  it('adds in order, edits, and logs one intake per supplement and day', async () => {
    const c = await addSupplement({ name: ' Creatine ', dose: '5 g', time: '09:00' })
    const d = await addSupplement({ name: 'Vitamin D', dose: ' ', time: '21:00' })
    expect(sortSupplements(await db.supplements.toArray()).map(s => [s.name, s.dose, s.position]))
      .toEqual([['Creatine', '5 g', 0], ['Vitamin D', undefined, 1]])
    await updateSupplement(d, { name: 'Vitamin D3', time: '20:30' })
    expect(await db.supplements.get(d)).toMatchObject({ name: 'Vitamin D3', time: '20:30' })

    await setSupplementTaken(c, '2026-10-29', true)
    await setSupplementTaken(c, '2026-10-29', true)
    expect(await db.supplementLogs.toArray()).toEqual([
      expect.objectContaining({ id: supplementLogId(c, '2026-10-29'), supplementId: c, date: '2026-10-29' }),
    ])
    await setSupplementTaken(c, '2026-10-29', false)
    expect(await db.supplementLogs.count()).toBe(0)
    expect((await db.tombstones.toArray()).filter(t => t.table === 'supplementLogs')).toHaveLength(1)
  })

  it('deleting a supplement deletes its history, with tombstones for both', async () => {
    const c = await addSupplement({ name: 'Creatine', time: '09:00' })
    await setSupplementTaken(c, '2026-10-28', true)
    await setSupplementTaken(c, '2026-10-29', true)
    await deleteSupplement(c)
    expect(await db.supplements.count()).toBe(0)
    expect(await db.supplementLogs.count()).toBe(0)
    expect((await db.tombstones.toArray()).map(t => t.table).sort())
      .toEqual(['supplementLogs', 'supplementLogs', 'supplements'])
  })
})
