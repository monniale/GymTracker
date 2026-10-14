import { describe, it, expect } from 'vitest'
import { DEFAULT_NOTIFY_PREFS, DEFAULT_REST_ALERT, isHHMM, mergeNotifyPrefs, mergeRestAlert } from './notifyPrefs'

describe('isHHMM', () => {
  it('accepts zero-padded 24 h times', () => {
    for (const s of ['00:00', '09:05', '13:30', '19:59', '23:59']) expect(isHHMM(s)).toBe(true)
  })

  it('rejects everything else', () => {
    for (const s of ['24:00', '9:00', '09:60', '09:5', '0900', '09:00:00', ' 09:00', '', 'ab:cd', 900, null, undefined, {}])
      expect(isHHMM(s)).toBe(false)
  })
})

describe('mergeNotifyPrefs', () => {
  it('returns the defaults for missing or garbage input', () => {
    for (const v of [undefined, null, 42, 'x', [], [1, 2]]) expect(mergeNotifyPrefs(v)).toEqual(DEFAULT_NOTIFY_PREFS)
  })

  it('never shares references with the defaults', () => {
    const p = mergeNotifyPrefs(undefined)
    expect(p).not.toBe(DEFAULT_NOTIFY_PREFS)
    expect(p.workout).not.toBe(DEFAULT_NOTIFY_PREFS.workout)
    expect(p.workout.days).not.toBe(DEFAULT_NOTIFY_PREFS.workout.days)
    expect(p.meals.lunch).not.toBe(DEFAULT_NOTIFY_PREFS.meals.lunch)
    p.workout.days.push(3)
    p.meals.lunch.enabled = true
    expect(DEFAULT_NOTIFY_PREFS.workout.days).toEqual([])
    expect(DEFAULT_NOTIFY_PREFS.meals.lunch.enabled).toBe(false)
  })

  it('ships the owner-decided defaults', () => {
    const d = DEFAULT_NOTIFY_PREFS
    expect(d.enabled).toBe(true)
    expect(d.rank).toEqual({ decayWarning: true, decayTime: '19:00', streakWarning: true, streakTime: '18:00' })
    expect(d.recap).toEqual({ enabled: true, when: 'monday-morning', time: '09:00' })
    expect(d.workout.openSessionNudge).toBe(true)
    expect(d.workout.enabled).toBe(false)
    expect(d.water.enabled).toBe(false)
    expect(d.weighIn).toEqual({ enabled: false, weekday: 1, time: '08:00' })
    expect(Object.values(d.meals).every(m => !m.enabled)).toBe(true)
  })

  it('keeps nested defaults when only part of a section is persisted', () => {
    const p = mergeNotifyPrefs({ workout: { enabled: true }, meals: { lunch: { enabled: true } }, recap: { time: '10:15' } })
    expect(p.workout).toEqual({ ...DEFAULT_NOTIFY_PREFS.workout, enabled: true })
    expect(p.meals.lunch).toEqual({ enabled: true, time: '13:00' })
    expect(p.meals.dinner).toEqual(DEFAULT_NOTIFY_PREFS.meals.dinner)
    expect(p.recap).toEqual({ enabled: true, when: 'monday-morning', time: '10:15' })
    expect(p.weighIn).toEqual(DEFAULT_NOTIFY_PREFS.weighIn)
  })

  it('keeps valid persisted values', () => {
    const persisted = {
      enabled: false,
      workout: { enabled: true, days: [1, 3, 5], time: '07:30', skipWhenTargetMet: false, openSessionNudge: false },
      meals: {
        breakfast: { enabled: true, time: '07:00' },
        lunch: { enabled: true, time: '12:30' },
        snack: { enabled: false, time: '17:00' },
        dinner: { enabled: true, time: '21:00' },
      },
      water: { enabled: true, start: '08:00', end: '22:00', intervalMin: 90 },
      rank: { decayWarning: false, decayTime: '20:00', streakWarning: false, streakTime: '17:00' },
      recap: { enabled: false, when: 'sunday-evening', time: '20:00' },
      weighIn: { enabled: true, weekday: 7, time: '06:45' },
    }
    expect(mergeNotifyPrefs(persisted)).toEqual(persisted)
  })

  it('drops invalid times, weekdays, intervals and enums back to their defaults', () => {
    const p = mergeNotifyPrefs({
      enabled: 'yes',
      workout: { enabled: 1, time: '25:00', days: 'mon' },
      meals: { lunch: { enabled: true, time: '1:00' }, brunch: { enabled: true, time: '11:00' } },
      water: { intervalMin: 45, start: 900, end: null },
      rank: { decayTime: '19:60' },
      recap: { when: 'friday', weekday: 5 },
      weighIn: { weekday: 0, time: '08:00:00' },
    })
    expect(p.enabled).toBe(true)
    expect(p.workout.enabled).toBe(false)
    expect(p.workout.time).toBe('18:00')
    expect(p.workout.days).toEqual([])
    expect(p.meals.lunch).toEqual({ enabled: true, time: '13:00' })
    expect(Object.keys(p.meals).sort()).toEqual(['breakfast', 'dinner', 'lunch', 'snack'])
    expect(p.water).toEqual(DEFAULT_NOTIFY_PREFS.water)
    expect(p.rank.decayTime).toBe('19:00')
    expect(p.recap).toEqual(DEFAULT_NOTIFY_PREFS.recap)
    expect(p.weighIn).toEqual(DEFAULT_NOTIFY_PREFS.weighIn)
  })

  it('filters, deduplicates and sorts workout weekdays', () => {
    expect(mergeNotifyPrefs({ workout: { days: [5, 1, 5, 0, 8, 2.5, '3', 7, 1] } }).workout.days).toEqual([1, 5, 7])
  })

  it('drops unknown keys', () => {
    const p = mergeNotifyPrefs({ junk: 1, workout: { junk: 2 } }) as unknown as Record<string, unknown>
    expect(p.junk).toBeUndefined()
    expect((p.workout as Record<string, unknown>).junk).toBeUndefined()
  })
})

describe('mergeRestAlert', () => {
  it('defaults to the discreet alert (owner decision)', () => {
    expect(DEFAULT_REST_ALERT).toEqual({ countdown: true, alert: true, alertMode: 'notification', warmupAlert: false })
    expect(mergeRestAlert(undefined)).toEqual(DEFAULT_REST_ALERT)
    expect(mergeRestAlert(undefined)).not.toBe(DEFAULT_REST_ALERT)
  })

  it('keeps valid values and drops invalid ones', () => {
    expect(mergeRestAlert({ countdown: false, alert: false, alertMode: 'alarm', warmupAlert: true })).toEqual({
      countdown: false,
      alert: false,
      alertMode: 'alarm',
      warmupAlert: true,
    })
    expect(mergeRestAlert({ countdown: 'no', alertMode: 'loud', extra: 1 })).toEqual(DEFAULT_REST_ALERT)
  })
})
