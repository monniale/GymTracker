import { isCardioExercise } from './cardio'
import type { Exercise, Id, Session, TemplateItem, WorkoutTemplate } from '../types'

/**
 * One exercise line of a live session: a template line (or an added exercise's default line),
 * after this session's swaps. `swappedFrom` = the exercise the line was written for, when a
 * swap replaced it; `swappedOut` marks a swapped-out exercise kept only because it already has
 * sets logged in this session (`targetSets` 0, no superset link).
 */
export type SessionItem = TemplateItem & { swappedFrom?: Id; swappedOut?: true }

/** Default line for an exercise added mid-session: cardio one 20-minute set, else 3 × 8. */
function addedItem(exId: Id, exMap: ReadonlyMap<Id, Exercise>): SessionItem {
  const ex = exMap.get(exId)
  return isCardioExercise(ex)
    ? { exerciseId: exId, targetSets: 1, targetReps: 20, restSec: ex?.defaultRestSec }
    : { exerciseId: exId, targetSets: 3, targetReps: 8, restSec: ex?.defaultRestSec }
}

/**
 * The exercise lines of a session: the template's items first (as stored), then every exercise
 * added mid-session (`Session.extraExerciseIds`, in order) that is not already listed. An added
 * cardio exercise gets one 20-minute set (`targetReps` = minutes), anything else 3 × 8; both use
 * the exercise's default rest (undefined when the exercise is missing from `exMap`). Freestyle
 * sessions pass no template.
 *
 * `Session.swaps` are applied to the template lines in stored order, so A→B then B→C does A as
 * C, and A→B then B→A gives A back. A swapped template line keeps its place, sets, reps, rest
 * and superset link and only changes `exerciseId` (+ `swappedFrom`, the template's exercise).
 * Added exercises are never resolved through swaps: swapping an added card rewrites
 * `extraExerciseIds` in place (and records a swap entry only to keep logged sets on a card), so
 * an exercise added back after a swap, or after "also update the template", shows as itself.
 * A swap whose `from` is in no line changes nothing. Every swapped-out exercise with sets
 * logged in this session (`loggedIds`) and no line of its own is appended as a
 * `targetSets: 0`, `swappedOut` line so those sets stay visible and editable.
 *
 * Pure; the returned array is new, unswapped template items are not copied.
 */
export function sessionItems(
  template: Pick<WorkoutTemplate, 'items'> | undefined,
  session: Pick<Session, 'extraExerciseIds' | 'swaps'>,
  exMap: ReadonlyMap<Id, Exercise>,
  loggedIds?: ReadonlySet<Id>,
): SessionItem[] {
  const swaps = (session.swaps ?? []).filter(s => s.from !== s.to)
  /** Line each swapped-out exercise last stood in (for its reps / rest once kept). */
  const outBase = new Map<Id, SessionItem>()
  const resolve = (id: Id, base: SessionItem): Id => {
    let cur = id
    for (const s of swaps) {
      if (s.from === cur) {
        outBase.set(cur, base)
        cur = s.to
      }
    }
    return cur
  }

  const items: SessionItem[] = []
  for (const it of template?.items ?? []) {
    const to = resolve(it.exerciseId, it)
    items.push(to === it.exerciseId ? it : { ...it, exerciseId: to, swappedFrom: it.exerciseId })
  }

  const itemIds = new Set(items.map(i => i.exerciseId))
  for (const exId of session.extraExerciseIds) {
    if (itemIds.has(exId)) continue
    items.push(addedItem(exId, exMap))
    itemIds.add(exId)
  }

  if (loggedIds) {
    for (const { from } of swaps) {
      if (itemIds.has(from) || !loggedIds.has(from)) continue
      const base = outBase.get(from) ?? addedItem(from, exMap)
      items.push({ exerciseId: from, targetSets: 0, targetReps: base.targetReps, restSec: base.restSec, swappedOut: true })
      itemIds.add(from)
    }
  }
  return items
}
