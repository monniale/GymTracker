import type { Id, Session, WorkoutTemplate } from '../types'
import { localDateStr, weekdayOf } from './dates'

export interface NextTemplate<T> {
  template: T
  /** 'today': scheduled for today's weekday (`WorkoutTemplate.weekdays`); 'rotation': the list order. */
  reason: 'today' | 'rotation'
}

/**
 * The workout to do next.
 *
 * A template scheduled for today's weekday wins (two on the same day: the lower `position`),
 * unless it was already done today. `doneToday` (template ids of the sessions finished and
 * started today, `templatesDoneOn`) decides that: the first scheduled template not in it wins,
 * so a freestyle or other workout finished after it does not bring it back. Without
 * `doneToday` only the last finished session is known: when it is a scheduled template started
 * today, the next template scheduled today after it wins, if any. Otherwise templates rotate
 * in their list order (`position`), starting after the template of the last finished session.
 * A freestyle or deleted-template session, or no history, starts again at the first one. With
 * no template scheduled anywhere this is exactly the rotation.
 *
 * `today` is a local YYYY-MM-DD date (default: now).
 */
export function nextTemplate<T extends Pick<WorkoutTemplate, 'id' | 'position' | 'weekdays'>>(
  templates: T[],
  lastFinished: Pick<Session, 'templateId' | 'startedAt'> | undefined,
  today: string = localDateStr(),
  doneToday?: ReadonlySet<string>,
): NextTemplate<T> | null {
  if (templates.length === 0) return null
  const ordered = [...templates].sort((a, b) => a.position - b.position)
  const lastId: Id | undefined = lastFinished?.templateId
  const same = (t: T) => lastId !== undefined && String(t.id) === String(lastId)

  const wd = weekdayOf(today)
  const scheduled = ordered.filter(t => t.weekdays?.includes(wd))
  if (scheduled.length > 0) {
    const lastToday = lastFinished !== undefined && localDateStr(new Date(lastFinished.startedAt)) === today
    const pick = doneToday
      ? scheduled.find(t => !doneToday.has(String(t.id)) && !(lastToday && same(t)))
      : scheduled[(lastToday ? scheduled.findIndex(same) : -1) + 1]
    if (pick) return { template: pick, reason: 'today' }
  }

  const idx = lastId === undefined ? -1 : ordered.findIndex(same)
  return { template: ordered[idx < 0 ? 0 : (idx + 1) % ordered.length], reason: 'rotation' }
}

/**
 * Template ids (as strings) of the finished sessions started on local date `date`: the
 * `doneToday` argument of `nextTemplate`. Pass the sessions started on or after that day's
 * midnight; others are ignored.
 */
export function templatesDoneOn(
  sessions: Pick<Session, 'templateId' | 'startedAt' | 'endedAt'>[],
  date: string,
): Set<string> {
  const ids = new Set<string>()
  for (const s of sessions) {
    if (s.endedAt === undefined || s.templateId === undefined) continue
    if (localDateStr(new Date(s.startedAt)) === date) ids.add(String(s.templateId))
  }
  return ids
}
