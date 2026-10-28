import { db, deleteWithTombstone } from '../db/db'
import { rankPointsFor } from './merge'
import type { Id, ScoreEvent } from '../types'

/**
 * What row-level last-write-wins cannot do on its own after a cloud pull — the cross-row rules
 * `mergeSnapshots` applies to whole snapshots:
 * - scoreEvents: the same quest award earned on two devices → one event;
 * - rankState.points: the sum of this season's events (both devices' training counts).
 * (Barcode duplicates are settled while the pull is applied: `applyCloudRows`, since the unique
 * `offId` index cannot hold both rows; the losers' logs are remapped here, `remapFoodIds`.)
 * Every change is a tracked write, so it lands in the outbox and reaches the cloud.
 * `touched` = the tables the pull changed; nothing runs when none of these is among them.
 */
export async function fixAfterPull(touched: ReadonlySet<string>): Promise<void> {
  if (touched.has('scoreEvents')) await dedupAwards()
  if (touched.has('scoreEvents') || touched.has('seasons') || touched.has('rankState')) await recomputeRank()
}

/** Point every log, plan and saved-meal item at the surviving food (tracked writes). */
export async function remapFoodIds(remap: Map<string, Id>): Promise<void> {
  if (remap.size === 0) return
  await db.transaction('rw', db.foodLogs, db.plannedFoods, db.savedMeals, async () => {
    for (const log of await db.foodLogs.toArray()) {
      const to = remap.get(String(log.foodId))
      if (to !== undefined) await db.foodLogs.update(log.id!, { foodId: to })
    }
    for (const p of await db.plannedFoods.toArray()) {
      const to = remap.get(String(p.foodId))
      if (to !== undefined) await db.plannedFoods.update(p.id!, { foodId: to })
    }
    for (const meal of await db.savedMeals.toArray()) {
      if (!meal.items.some(it => remap.has(String(it.foodId)))) continue
      const items = meal.items.map(it => (remap.has(String(it.foodId)) ? { ...it, foodId: remap.get(String(it.foodId))! } : it))
      await db.savedMeals.update(meal.id!, { items })
    }
  })
}

async function dedupAwards(): Promise<void> {
  const events = await db.scoreEvents.orderBy('date').toArray()
  const seen = new Map<string, ScoreEvent>()
  const extra: ScoreEvent[] = []
  for (const e of events) {
    if (!e.label) continue
    const key = `${e.date}|${e.label}`
    const prior = seen.get(key)
    // Keep the earliest-written award (stable across devices); drop the later copies.
    if (!prior) seen.set(key, e)
    else if ((e.updatedAt ?? 0) < (prior.updatedAt ?? 0)) { extra.push(prior); seen.set(key, e) }
    else extra.push(e)
  }
  for (const e of extra) await deleteWithTombstone('scoreEvents', e.id!)
}

async function recomputeRank(): Promise<void> {
  const rank = await db.rankState.get(1)
  if (!rank) return
  const points = rankPointsFor(rank, await db.scoreEvents.toArray(), await db.seasons.toArray())
  if (points !== rank.points) await db.rankState.update(1, { points })
}
