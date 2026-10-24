import { db } from '../db/db'
import { withSyncLock } from './sync'
import { demoLoadedAnyTab } from './uiStore'
import { t } from '../i18n'
import { checkAchievements } from './achievements'
import { isCardioSet } from './cardio'
import { localDateStr } from './dates'
import {
  resolveExercises, planImportScoring, type ExerciseMatch, type ImportFormat, type ParsedHistory,
} from './importHistory'
import type { BodyLogEntry, Exercise, Id, MuscleGroup } from '../types'

/**
 * Writes a parsed Strong/Hevy history into the app. Everything goes in ONE
 * transaction on the sync lock (never overlapping a pull), as normal tracked
 * writes so it syncs (invariant 2). Ids are assigned up front so sets and
 * score events can point at their session. It never calls finishSession,
 * registerSessionForStreak or rescoreSession (invariant 5): the streak is
 * untouched and only current-season sessions add rank points.
 */

export interface ImportPreview {
  format: ImportFormat
  /** Workouts that will be added. */
  workouts: number
  /** Workouts already in the app (same start time), skipped. */
  duplicates: number
  firstDate: string | null
  lastDate: string | null
  sets: number
  cardioSets: number
  matched: { raw: string; name: string }[]
  toCreate: { raw: string; muscleGroup: MuscleGroup }[]
  warnings: string[]
}

export interface ImportResult {
  workouts: number
  duplicates: number
  sets: number
  exercisesCreated: number
  pointsAdded: number
}

function split(parsed: ParsedHistory, existingStarts: Set<number>) {
  const fresh = parsed.sessions.filter(s => !existingStarts.has(s.startedAt))
  return { fresh, duplicates: parsed.sessions.length - fresh.length }
}

function rawNames(sessions: ParsedHistory['sessions']): string[] {
  return [...new Set(sessions.flatMap(s => s.sets.map(x => x.exerciseName)))]
}

export async function previewImport(parsed: ParsedHistory): Promise<ImportPreview> {
  const [catalog, starts] = await Promise.all([
    db.exercises.toArray(),
    db.sessions.orderBy('startedAt').keys(),
  ])
  const { fresh, duplicates } = split(parsed, new Set(starts as number[]))
  const matches = resolveExercises(rawNames(fresh), catalog)
  const sets = fresh.flatMap(s => s.sets)
  return {
    format: parsed.format,
    workouts: fresh.length,
    duplicates,
    firstDate: fresh.length ? localDateStr(new Date(fresh[0].startedAt)) : null,
    lastDate: fresh.length ? localDateStr(new Date(fresh[fresh.length - 1].startedAt)) : null,
    sets: sets.length,
    cardioSets: sets.filter(isCardioSet).length,
    matched: matches.filter(m => m.existing).map(m => ({ raw: m.raw, name: m.existing!.name })),
    toCreate: matches.filter(m => !m.existing).map(m => ({ raw: m.raw, muscleGroup: m.create!.muscleGroup })),
    warnings: parsed.warnings,
  }
}

/** Bodyweight on a day: the latest weigh-in on or before it, else the settings value. */
function bodyweightLookup(log: BodyLogEntry[], fallback: number): (date: string) => number {
  const sorted = [...log].sort((a, b) => a.date.localeCompare(b.date))
  return date => {
    let w = fallback
    for (const e of sorted) {
      if (e.date > date) break
      w = e.weightKg
    }
    return w
  }
}

/**
 * Refused while the demo is loaded: `clearDemoData` wipes every table, so imported workouts would
 * be deleted with the demo (and the demo flag keeps them from ever syncing).
 */
export async function applyImport(parsed: ParsedHistory): Promise<ImportResult> {
  if (demoLoadedAnyTab()) throw new Error(t('settings.importHistory.demoLoaded'))
  const result = await withSyncLock(() =>
    db.transaction(
      'rw',
      [db.exercises, db.sessions, db.sets, db.scoreEvents, db.rankState, db.settings, db.bodyLog],
      async (): Promise<ImportResult> => {
        const [catalog, sessions, rank, settings, bodyLog] = await Promise.all([
          db.exercises.toArray(),
          db.sessions.toArray(),
          db.rankState.get(1),
          db.settings.get(1),
          db.bodyLog.toArray(),
        ])
        // Re-checked inside the transaction: a sync may have landed since the preview.
        const { fresh, duplicates } = split(parsed, new Set(sessions.map(s => s.startedAt)))
        if (fresh.length === 0) return { workouts: 0, duplicates, sets: 0, exercisesCreated: 0, pointsAdded: 0 }

        const matches: ExerciseMatch[] = resolveExercises(rawNames(fresh), catalog)
        const idOf = new Map<string, Id>()
        const names = new Map<Id, string>(catalog.map(e => [e.id!, e.name]))
        let created = 0
        for (const m of matches) {
          if (m.existing) {
            idOf.set(m.raw, m.existing.id!)
            continue
          }
          const row: Exercise = { id: crypto.randomUUID(), ...m.create! }
          await db.exercises.add(row)
          idOf.set(m.raw, row.id!)
          names.set(row.id!, row.name)
          created++
        }

        const exerciseIds = [...new Set(idOf.values())]
        const existingSets = exerciseIds.length ? await db.sets.where('exerciseId').anyOf(exerciseIds).toArray() : []
        const plans = planImportScoring(fresh, {
          exerciseIdOf: raw => idOf.get(raw)!,
          exerciseNames: names,
          seasonStart: rank?.seasonStart ?? localDateStr(),
          existingSets,
          existingSessionStarts: sessions.filter(s => s.endedAt !== undefined).map(s => s.startedAt),
          bodyweightFor: bodyweightLookup(bodyLog, settings?.bodyweightKg ?? 75),
        })

        let setCount = 0
        let points = 0
        for (const p of plans) {
          const sessionId = crypto.randomUUID()
          await db.sessions.add({
            id: sessionId,
            name: p.name,
            startedAt: p.startedAt,
            endedAt: p.endedAt,
            bodyweightKg: bodyweightLookup(bodyLog, settings?.bodyweightKg ?? 75)(p.event.date),
            points: p.event.total,
            extraExerciseIds: [],
            importedFrom: parsed.format,
          })
          await db.sets.bulkAdd(p.sets.map(s => ({ id: crypto.randomUUID(), sessionId, ...s })))
          await db.scoreEvents.add({ id: crypto.randomUUID(), sessionId, ...p.event })
          setCount += p.sets.length
          points += p.pointsDelta
        }
        if (rank && points > 0) {
          await db.rankState.update(1, { points: Math.max(0, Math.round(rank.points + points)) })
        }
        return { workouts: plans.length, duplicates, sets: setCount, exercisesCreated: created, pointsAdded: Math.round(points) }
      },
    ),
  )
  if (result.workouts > 0) void checkAchievements().catch(() => {})
  return result
}
