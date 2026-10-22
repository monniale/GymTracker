import type { Id, Session, WorkoutTemplate } from '../types'

/**
 * The workout to do next: templates rotate in their list order (`position`),
 * starting after the template of the last finished session. A freestyle or
 * deleted-template session, or no history, starts again at the first one.
 */
export function nextTemplate<T extends Pick<WorkoutTemplate, 'id' | 'position'>>(
  templates: T[],
  lastFinished: Pick<Session, 'templateId'> | undefined,
): T | null {
  if (templates.length === 0) return null
  const ordered = [...templates].sort((a, b) => a.position - b.position)
  const lastId: Id | undefined = lastFinished?.templateId
  const idx = lastId === undefined ? -1 : ordered.findIndex(t => String(t.id) === String(lastId))
  return ordered[idx < 0 ? 0 : (idx + 1) % ordered.length]
}
