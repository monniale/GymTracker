import { describe, it, expect } from 'vitest'
import { nextTemplate, templatesDoneOn } from './nextTemplate'

const t = (id: number | string, position: number, weekdays?: number[]) =>
  ({ id, position, name: `T${id}`, ...(weekdays ? { weekdays } : {}) })

// Local noon on a date, as a session's startedAt.
const at = (date: string, h = 12) => {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d, h).getTime()
}

const MON = '2026-10-26'
const SUN = '2026-10-25'

describe('nextTemplate: rotation (no schedule)', () => {
  const list = [t('c', 2), t('a', 0), t('b', 1)]
  const done = (templateId: string | number | undefined) => ({ templateId, startedAt: at('2026-10-20') })

  it('rotates after the last finished template, by position', () => {
    expect(nextTemplate(list, done('a'), MON)).toEqual({ template: list[2], reason: 'rotation' })
    expect(nextTemplate(list, done('b'), MON)?.template.id).toBe('c')
    expect(nextTemplate(list, done('c'), MON)?.template.id).toBe('a') // wraps
  })

  it('starts at the first one after a freestyle, a deleted template or no history', () => {
    expect(nextTemplate(list, done(undefined), MON)?.template.id).toBe('a')
    expect(nextTemplate(list, done('gone'), MON)?.template.id).toBe('a')
    expect(nextTemplate(list, undefined, MON)?.template.id).toBe('a')
  })

  it('matches legacy numeric ids and handles no templates', () => {
    expect(nextTemplate([t(1, 0), t(2, 1)], done(1), MON)?.template.id).toBe(2)
    expect(nextTemplate([], done(1), MON)).toBeNull()
  })

  it('defaults today to now and stays rotation with no weekdays anywhere', () => {
    expect(nextTemplate(list, done('a'))).toEqual({ template: list[2], reason: 'rotation' })
  })

  it('an empty weekdays array schedules nothing', () => {
    expect(nextTemplate([t('a', 0), t('b', 1, [])], undefined, MON)?.reason).toBe('rotation')
  })
})

describe('nextTemplate: weekday schedule', () => {
  it("today's scheduled template wins over the rotation", () => {
    const list = [t('a', 0, [3]), t('b', 1, [1]), t('c', 2)]
    // Rotation after 'b' would give 'c'; Monday is 'b' day.
    expect(nextTemplate(list, { templateId: 'b', startedAt: at('2026-10-21') }, MON))
      .toEqual({ template: list[1], reason: 'today' })
    expect(nextTemplate(list, undefined, MON)).toEqual({ template: list[1], reason: 'today' })
  })

  it('falls back to the rotation once the scheduled template is done today', () => {
    const list = [t('a', 0, [1]), t('b', 1), t('c', 2)]
    expect(nextTemplate(list, { templateId: 'a', startedAt: at(MON, 8) }, MON))
      .toEqual({ template: list[1], reason: 'rotation' })
    // Done on an earlier Monday: still today's workout.
    expect(nextTemplate(list, { templateId: 'a', startedAt: at('2026-10-19') }, MON)?.reason).toBe('today')
    // Another workout done today does not hide the scheduled one.
    expect(nextTemplate(list, { templateId: 'b', startedAt: at(MON, 8) }, MON)?.template.id).toBe('a')
  })

  it('two templates on the same weekday: the lower position first, then the other', () => {
    const list = [t('late', 5, [1, 4]), t('early', 1, [1]), t('x', 3)]
    expect(nextTemplate(list, undefined, MON)?.template.id).toBe('early')
    expect(nextTemplate(list, { templateId: 'early', startedAt: at(MON) }, MON))
      .toEqual({ template: list[0], reason: 'today' })
    // Both done today: rotation after the last one ('late' is last by position, wraps to 'early').
    expect(nextTemplate(list, { templateId: 'late', startedAt: at(MON) }, MON))
      .toEqual({ template: list[1], reason: 'rotation' })
  })

  it('maps Sunday to 0', () => {
    const list = [t('a', 0), t('sun', 1, [0])]
    expect(nextTemplate(list, undefined, SUN)).toEqual({ template: list[1], reason: 'today' })
    expect(nextTemplate(list, undefined, MON)?.reason).toBe('rotation')
  })

  it('reads the start date in local time (a session started just after midnight is today)', () => {
    const list = [t('a', 0, [1]), t('b', 1)]
    expect(nextTemplate(list, { templateId: 'a', startedAt: at(MON, 0) + 60_000 }, MON)?.reason).toBe('rotation')
    expect(nextTemplate(list, { templateId: 'a', startedAt: at(MON, 0) - 60_000 }, MON)?.reason).toBe('today')
  })
})

describe('nextTemplate: templates done today (doneToday)', () => {
  it('a scheduled template done today stays done after a freestyle or other workout', () => {
    const list = [t('a', 0, [1]), t('b', 1), t('c', 2)]
    // Last finished = a freestyle session today; 'a' was done earlier today.
    const freestyle = { templateId: undefined, startedAt: at(MON, 18) }
    // Not 'today' any more; the rotation restarts at the first template after a freestyle.
    expect(nextTemplate(list, freestyle, MON, new Set(['a']))).toEqual({ template: list[0], reason: 'rotation' })
    expect(nextTemplate(list, { templateId: 'b', startedAt: at(MON, 18) }, MON, new Set(['a', 'b'])))
      .toEqual({ template: list[2], reason: 'rotation' })
    // Not done today: still today's workout.
    expect(nextTemplate(list, freestyle, MON, new Set(['b']))).toEqual({ template: list[0], reason: 'today' })
  })

  it('two scheduled the same day: the first one not done today, in position order', () => {
    const list = [t('late', 5, [1]), t('early', 1, [1]), t('x', 3)]
    expect(nextTemplate(list, { templateId: 'late', startedAt: at(MON) }, MON, new Set(['late'])))
      .toEqual({ template: list[1], reason: 'today' })
    expect(nextTemplate(list, { templateId: 'late', startedAt: at(MON) }, MON, new Set(['late', 'early']))?.reason)
      .toBe('rotation')
  })

  it('also treats the last finished session as done when it was started today', () => {
    const list = [t('a', 0, [1]), t('b', 1)]
    expect(nextTemplate(list, { templateId: 'a', startedAt: at(MON) }, MON, new Set())?.reason).toBe('rotation')
  })
})

describe('templatesDoneOn', () => {
  it('keeps finished template sessions started on that local date, as strings', () => {
    const ids = templatesDoneOn([
      { templateId: 1, startedAt: at(MON, 8), endedAt: at(MON, 9) },
      { templateId: 'b', startedAt: at(MON, 0) + 60_000, endedAt: at(MON, 1) },
      { templateId: 'live', startedAt: at(MON, 10) }, // not finished
      { templateId: undefined, startedAt: at(MON, 11), endedAt: at(MON, 12) }, // freestyle
      { templateId: 'next', startedAt: at('2026-10-27', 8), endedAt: at('2026-10-27', 9) }, // another day
    ], MON)
    expect([...ids]).toEqual(['1', 'b'])
  })
})
