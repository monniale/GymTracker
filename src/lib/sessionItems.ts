import { isCardioExercise } from './cardio'
import type { Exercise, Id, Session, TemplateItem, WorkoutTemplate } from '../types'

/** One exercise line of a live session. Same shape as a template line for now. */
export type SessionItem = TemplateItem

/**
 * The exercise lines of a session: the template's items first (as stored), then
 * every exercise added mid-session (`Session.extraExerciseIds`, in order) that is
 * not already listed. An added cardio exercise gets one 20-minute set
 * (`targetReps` = minutes), anything else 3 × 8; both use the exercise's default
 * rest (undefined when the exercise is missing from `exMap`). Freestyle sessions
 * pass no template. Pure; the returned array is new, the template items are not
 * copied.
 */
export function sessionItems(
  template: Pick<WorkoutTemplate, 'items'> | undefined,
  session: Pick<Session, 'extraExerciseIds'>,
  exMap: ReadonlyMap<Id, Exercise>,
): SessionItem[] {
  const items: SessionItem[] = [...(template?.items ?? [])]
  const itemIds = new Set(items.map(i => i.exerciseId))
  for (const exId of session.extraExerciseIds) {
    if (!itemIds.has(exId)) {
      const ex = exMap.get(exId)
      items.push(isCardioExercise(ex)
        ? { exerciseId: exId, targetSets: 1, targetReps: 20, restSec: ex?.defaultRestSec }
        : { exerciseId: exId, targetSets: 3, targetReps: 8, restSec: ex?.defaultRestSec })
      itemIds.add(exId)
    }
  }
  return items
}
