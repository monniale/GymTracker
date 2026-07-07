/**
 * Spike (load-bearing assumption of the sync design): explicit string UUID keys
 * must legally coexist with auto-generated integer keys on Dexie '++id' tables,
 * with no schema migration. IndexedDB spec: a key generator is consumed only
 * when no key is supplied; numeric explicit keys >= state bump it; non-numeric
 * keys (strings) never touch it.
 */
import 'fake-indexeddb/auto'
import Dexie, { type Table } from 'dexie'
import { describe, it, expect } from 'vitest'

interface Row {
  id?: number | string
  name: string
}

describe('string keys on ++id Dexie tables', () => {
  it('accepts explicit string ids alongside auto-increment integers', async () => {
    const db = new Dexie(`spike-${Math.random()}`)
    db.version(1).stores({ rows: '++id, name' })
    const rows = db.table('rows') as Table<Row, number | string>

    const a = await rows.add({ name: 'auto-1' }) // -> 1
    const u = await rows.add({ id: 'uuid-abc', name: 'explicit-string' })
    const b = await rows.add({ name: 'auto-2' }) // generator unaffected -> 2

    expect(a).toBe(1)
    expect(u).toBe('uuid-abc')
    expect(b).toBe(2)

    expect((await rows.get('uuid-abc'))?.name).toBe('explicit-string')
    expect((await rows.get(2))?.name).toBe('auto-2')
    expect(await rows.count()).toBe(3)
  })

  it('bulkPut with mixed integer and string ids round-trips', async () => {
    const db = new Dexie(`spike-${Math.random()}`)
    db.version(1).stores({ rows: '++id' })
    const rows = db.table('rows') as Table<Row, number | string>

    await rows.bulkPut([
      { id: 5, name: 'int' },
      { id: 'c7f0e9d2', name: 'str' },
    ])
    expect((await rows.get(5))?.name).toBe('int')
    expect((await rows.get('c7f0e9d2'))?.name).toBe('str')

    // Importing high integer ids bumps the generator (known corollary);
    // string ids must NOT break subsequent auto-generation.
    const next = await rows.add({ name: 'after' })
    expect(typeof next).toBe('number')
    expect(next as number).toBeGreaterThan(5)
  })

  it('where()/indexes still work across mixed key types', async () => {
    const db = new Dexie(`spike-${Math.random()}`)
    db.version(1).stores({ rows: '++id, name' })
    const rows = db.table('rows') as Table<Row, number | string>
    await rows.bulkAdd([
      { name: 'x' },
      { id: 'u-1', name: 'x' },
    ])
    expect(await rows.where('name').equals('x').count()).toBe(2)
  })
})
