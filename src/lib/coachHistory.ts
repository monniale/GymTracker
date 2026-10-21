import { db, withSyncTrackingSuspended, deleteWithTombstone } from '../db/db'
import { localDateStr } from './dates'
import type { CoachJudgement, CoachNote, Id } from '../types'

/**
 * Stored AI coach verdicts (`db.coachHistory`): every workout coach note and
 * diet report the app generates, kept as synced user data. Append-only — a
 * Regenerate adds a row, so earlier verdicts stay readable; the newest row for a
 * session (workout) or day (diet) is the one the cards show.
 *
 * The device-local caches `coachNotes`/`dietNotes` are legacy: nothing writes
 * them any more, `backfillCoachHistory` copies their rows in once, and the cards
 * fall back to them only until that has run.
 */

export type JudgementKind = CoachJudgement['kind']

/** Identity of what a verdict is about: the session for workouts, the day for diet, the Monday for a week. */
export function judgementKey(j: Pick<CoachJudgement, 'kind' | 'sessionId' | 'date'>): string {
  return j.kind === 'workout' ? `workout:${String(j.sessionId)}` : `${j.kind}:${j.date}`
}

function newest(rows: CoachJudgement[]): CoachJudgement | undefined {
  let best: CoachJudgement | undefined
  for (const r of rows) if (!best || r.generatedAt > best.generatedAt) best = r
  return best
}

async function rowsFor(kind: JudgementKind, key: Id): Promise<CoachJudgement[]> {
  const rows = kind === 'workout'
    ? await db.coachHistory.where('sessionId').equals(key).toArray()
    : await db.coachHistory.where('date').equals(String(key)).toArray()
  return rows.filter(r => r.kind === kind)
}

/** Every stored verdict for one workout session (key = sessionId), diet day (key = date) or week (key = Monday). */
export function judgementsFor(kind: JudgementKind, key: Id): Promise<CoachJudgement[]> {
  return rowsFor(kind, key)
}

/** The current verdict for a session/day: the newest stored one, else a legacy cached note. */
export async function currentNote(kind: JudgementKind, key: Id): Promise<CoachNote | null> {
  const stored = newest(await rowsFor(kind, key))
  if (stored) return stored.note
  if (kind === 'week') return null // no legacy cache: weekly reviews were always stored here
  const legacy = kind === 'workout'
    ? await db.coachNotes.get(key)
    : await db.dietNotes.get(String(key))
  return legacy?.note ?? null
}

/** Store a freshly generated verdict. A normal (tracked) write: it syncs like any user data. */
export async function saveJudgement(
  j: { kind: 'workout'; sessionId: Id; note: CoachNote; model: string }
    | { kind: 'diet' | 'week'; date: string; note: CoachNote; model: string },
): Promise<void> {
  const generatedAt = Date.now()
  if (j.kind === 'workout') {
    const session = await db.sessions.get(j.sessionId)
    await db.coachHistory.add({
      kind: 'workout',
      sessionId: j.sessionId,
      date: localDateStr(new Date(session?.startedAt ?? generatedAt)),
      title: session?.name,
      note: j.note,
      model: j.model,
      generatedAt,
    })
  } else {
    await db.coachHistory.add({ kind: j.kind, date: j.date, note: j.note, model: j.model, generatedAt })
  }
}

/**
 * Delete one stored verdict everywhere (tombstoned, so the delete syncs). A legacy
 * cache row it was copied from goes too, or the card would fall back to it.
 */
export async function deleteJudgement(j: CoachJudgement): Promise<void> {
  if (j.id === undefined) return
  await deleteWithTombstone('coachHistory', j.id)
  await withSyncTrackingSuspended(async () => {
    if (j.kind === 'workout' && j.sessionId !== undefined) {
      const cached = await db.coachNotes.get(j.sessionId)
      if (cached?.generatedAt === j.generatedAt) await db.coachNotes.delete(j.sessionId)
    } else if (j.kind === 'diet') {
      const cached = await db.dietNotes.get(j.date)
      if (cached?.generatedAt === j.generatedAt) await db.dietNotes.delete(j.date)
    }
  })
}

const BACKFILL_KEY = 'gymtracker-coach-backfill-v1'

/**
 * One-time copy of this device's cached coach notes and diet reports (written by
 * builds before the history existed) into the synced history, so verdicts that
 * only lived on this device are stored too. Idempotent: rows already present
 * (same subject + generatedAt) are skipped. Resolves to the number of rows added.
 */
export async function backfillCoachHistory(): Promise<number> {
  try {
    if (localStorage.getItem(BACKFILL_KEY) === '1') return 0
  } catch {
    /* storage unavailable: run the idempotent copy anyway */
  }
  const [notes, diets, history] = await Promise.all([
    db.coachNotes.toArray(), db.dietNotes.toArray(), db.coachHistory.toArray(),
  ])
  const have = new Set(history.map(h => `${judgementKey(h)}@${h.generatedAt}`))
  const rows: CoachJudgement[] = []
  for (const n of notes) {
    if (have.has(`workout:${String(n.sessionId)}@${n.generatedAt}`)) continue
    const session = await db.sessions.get(n.sessionId)
    rows.push({
      kind: 'workout',
      sessionId: n.sessionId,
      date: localDateStr(new Date(session?.startedAt ?? n.generatedAt)),
      title: session?.name,
      note: n.note,
      model: n.model,
      generatedAt: n.generatedAt,
    })
  }
  for (const d of diets) {
    if (have.has(`diet:${d.date}@${d.generatedAt}`)) continue
    rows.push({ kind: 'diet', date: d.date, note: d.note, model: d.model, generatedAt: d.generatedAt })
  }
  if (rows.length > 0) await db.coachHistory.bulkAdd(rows)
  try {
    localStorage.setItem(BACKFILL_KEY, '1')
  } catch {
    /* next launch repeats the (idempotent) check */
  }
  return rows.length
}
