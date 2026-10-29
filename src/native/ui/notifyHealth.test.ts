import { describe, it, expect } from 'vitest'
import {
  CHANNEL,
  bucketLabel,
  categoryOn,
  enabledCategoryCount,
  healthItems,
  isMuted,
  mutedCategories,
  notificationsState,
  recapWithWhen,
  remindersActive,
  restAlertChannel,
  restIssues,
  throughDate,
} from './notifyHealth'
import { DEFAULT_NOTIFY_PREFS, DEFAULT_REST_ALERT, mergeNotifyPrefs } from '../../lib/notifyPrefs'
import type { NotifyPrefs, RestAlertPrefs } from '../../lib/notifyPrefs'
import type { NativeStatus } from '../status'

const OK: NativeStatus = {
  display: 'granted',
  enabled: true,
  exact: true,
  ignoringBattery: true,
  backgroundRestricted: false,
  standbyBucket: 10,
  promotedAllowed: true,
  manufacturer: 'samsung',
  sdkInt: 36,
  channels: {},
}
const st = (patch: Partial<NativeStatus>): NativeStatus => ({ ...OK, ...patch })
const prefs = (patch: (p: NotifyPrefs) => NotifyPrefs = p => p) => patch(mergeNotifyPrefs(undefined))
const allOff = (p: NotifyPrefs): NotifyPrefs => ({
  ...p,
  workout: { ...p.workout, enabled: false, openSessionNudge: false },
  rank: { ...p.rank, decayWarning: false, streakWarning: false },
  recap: { ...p.recap, enabled: false },
  supplements: { enabled: false },
})
const rest = (patch: Partial<RestAlertPrefs> = {}): RestAlertPrefs => ({ ...DEFAULT_REST_ALERT, ...patch })
const ctx = { remindersActive: true, samsungDone: false, countdown: true }

describe('notificationsState', () => {
  it('maps the runtime permission, then the per-app switch', () => {
    expect(notificationsState({ display: 'granted', enabled: true })).toBe('ok')
    expect(notificationsState({ display: 'granted', enabled: false })).toBe('off')
    expect(notificationsState({ display: 'prompt', enabled: true })).toBe('prompt')
    expect(notificationsState({ display: 'prompt-with-rationale', enabled: false })).toBe('prompt')
    expect(notificationsState({ display: 'denied', enabled: false })).toBe('denied')
  })
})

describe('categories', () => {
  it('defaults: workout (open-session nudge), rank, recap and supplements on; meals, water, weigh-in off', () => {
    const p = prefs()
    expect(categoryOn(p, 'workout')).toBe(true)
    expect(categoryOn(p, 'rank')).toBe(true)
    expect(categoryOn(p, 'recap')).toBe(true)
    expect(categoryOn(p, 'meals')).toBe(false)
    expect(categoryOn(p, 'water')).toBe(false)
    expect(categoryOn(p, 'weighIn')).toBe(false)
    expect(categoryOn(p, 'supplements')).toBe(true)
    expect(enabledCategoryCount(p)).toBe(4)
    expect(remindersActive(p)).toBe(true)
  })

  it('a single meal turns the meals category on', () => {
    const p = prefs(p => ({ ...p, meals: { ...p.meals, lunch: { enabled: true, time: '13:00' } } }))
    expect(categoryOn(p, 'meals')).toBe(true)
  })

  it('reminders are inactive with the master switch off or every category off', () => {
    expect(remindersActive(prefs(p => ({ ...p, enabled: false })))).toBe(false)
    expect(remindersActive(prefs(allOff))).toBe(false)
    expect(enabledCategoryCount(prefs(allOff))).toBe(0)
  })

  it('isMuted only for importance 0 (unknown channels are not muted)', () => {
    expect(isMuted({ a: 0 }, 'a')).toBe(true)
    expect(isMuted({ a: 2 }, 'a')).toBe(false)
    expect(isMuted({}, 'a')).toBe(false)
    expect(isMuted(undefined, 'a')).toBe(false)
  })
})

describe('mutedCategories', () => {
  it('lists the categories that are on but whose channel is off in Android', () => {
    const muted = st({ channels: { [CHANNEL.rank]: 0, [CHANNEL.meals]: 0, [CHANNEL.recap]: 3 } })
    expect(mutedCategories(muted, prefs())).toEqual(['rank'])
    const meals = prefs(p => ({ ...p, meals: { ...p.meals, lunch: { enabled: true, time: '13:00' } } }))
    expect(mutedCategories(muted, meals)).toEqual(['meals', 'rank'])
    // Weigh-in shares the workout channel.
    const weigh = prefs(p => ({ ...p, weighIn: { ...p.weighIn, enabled: true } }))
    expect(mutedCategories(st({ channels: { [CHANNEL.workout]: 0 } }), weigh)).toEqual(['workout', 'weighIn'])
  })

  it('nothing before the status loads, with notifications not allowed, or with reminders off', () => {
    const muted = st({ channels: { [CHANNEL.rank]: 0 } })
    expect(mutedCategories(null, prefs())).toEqual([])
    expect(mutedCategories({ ...muted, display: 'denied' }, prefs())).toEqual([])
    expect(mutedCategories({ ...muted, enabled: false }, prefs())).toEqual([])
    expect(mutedCategories(muted, prefs(p => ({ ...p, enabled: false })))).toEqual([])
    expect(mutedCategories(muted, prefs(p => ({ ...p, rank: { ...p.rank, decayWarning: false, streakWarning: false } })))).toEqual([])
  })
})

describe('healthItems', () => {
  it('is empty when everything is fine', () => {
    expect(healthItems(OK, { ...ctx, samsungDone: true })).toEqual([])
  })

  it('lists only failing items, required first, promotion last and optional', () => {
    const items = healthItems(
      st({ display: 'denied', exact: false, ignoringBattery: false, promotedAllowed: false }),
      ctx,
    )
    expect(items.map(i => i.id)).toEqual(['notifications', 'exact', 'battery', 'samsung', 'promotion'])
    expect(items.filter(i => i.required).length).toBe(4)
    expect(items[0]).toEqual({ id: 'notifications', required: true, state: 'denied' })
    expect(items[2]).toEqual({ id: 'battery', required: true, state: 'optimised' })
  })

  it('reports Restricted over Optimised', () => {
    expect(healthItems(st({ backgroundRestricted: true, ignoringBattery: false }), { ...ctx, samsungDone: true })).toEqual([
      { id: 'battery', required: true, state: 'restricted' },
    ])
  })

  it('drops battery and Never-sleeping when no reminder is active', () => {
    const items = healthItems(st({ ignoringBattery: false }), { ...ctx, remindersActive: false })
    expect(items).toEqual([])
  })

  it('asks for Never sleeping apps on Samsung only, until checked off', () => {
    expect(healthItems(OK, ctx).map(i => i.id)).toEqual(['samsung'])
    expect(healthItems(st({ manufacturer: ' Samsung ' }), ctx).map(i => i.id)).toEqual(['samsung'])
    expect(healthItems(st({ manufacturer: 'Google' }), ctx)).toEqual([])
    expect(healthItems(OK, { ...ctx, samsungDone: true })).toEqual([])
  })

  it('offers the live countdown promotion only on Android 16+ with the countdown on', () => {
    const s = st({ manufacturer: 'Google', promotedAllowed: false })
    expect(healthItems(s, ctx)).toEqual([{ id: 'promotion', required: false }])
    expect(healthItems({ ...s, sdkInt: 35 }, ctx)).toEqual([])
    expect(healthItems(s, { ...ctx, countdown: false })).toEqual([])
  })
})

describe('restIssues', () => {
  it('nothing when both native rest features are off', () => {
    expect(restIssues(st({ display: 'denied' }), rest({ countdown: false, alert: false }))).toEqual([])
  })

  it('missing permission hides the channel rows', () => {
    const s = st({ display: 'prompt', channels: { [CHANNEL.restCountdown]: 0 } })
    expect(restIssues(s, rest())).toEqual([{ id: 'permission', state: 'prompt' }])
    expect(restIssues(st({ enabled: false }), rest())).toEqual([{ id: 'permission', state: 'off' }])
  })

  it('flags the muted countdown and the muted channel of the ACTIVE alert mode only', () => {
    const channels = { [CHANNEL.restCountdown]: 0, [CHANNEL.restAlertLoud]: 0, [CHANNEL.restAlertQuiet]: 4 }
    expect(restIssues(st({ channels }), rest()).map(i => i.id)).toEqual(['countdown-muted'])
    expect(restIssues(st({ channels }), rest({ alertMode: 'alarm' }))).toEqual([
      { id: 'countdown-muted', channelId: CHANNEL.restCountdown },
      { id: 'alert-muted', channelId: CHANNEL.restAlertLoud },
    ])
    expect(restIssues(st({ channels }), rest({ countdown: false, alertMode: 'alarm' })).map(i => i.id)).toEqual([
      'alert-muted',
    ])
  })

  it('exact alarms matter for the alert, not for the countdown', () => {
    expect(restIssues(st({ exact: false }), rest()).map(i => i.id)).toEqual(['exact'])
    expect(restIssues(st({ exact: false }), rest({ alert: false }))).toEqual([])
  })

  it('maps the alert mode to its channel', () => {
    expect(restAlertChannel('notification')).toBe('rest_alert_quiet_v1')
    expect(restAlertChannel('alarm')).toBe('rest_alert_v1')
    expect(DEFAULT_REST_ALERT.alertMode).toBe('notification')
  })
})

describe('copy helpers', () => {
  it('throughDate is the local day of the last planned reminder', () => {
    expect(throughDate(new Date(2026, 9, 18, 12, 0).getTime())).toBe('2026-10-18')
    expect(throughDate(new Date(2026, 9, 18, 23, 59).getTime())).toBe('2026-10-18')
    // A reminder at exactly 00:00 belongs to that day (horizon is an instant, not an exclusive end).
    expect(throughDate(new Date(2026, 9, 19, 0, 0).getTime())).toBe('2026-10-19')
    // DST end in Rome (2026-10-25): the 25-hour day still maps to itself.
    expect(throughDate(new Date(2026, 9, 25, 23, 30).getTime())).toBe('2026-10-25')
  })

  it('names standby buckets', () => {
    expect(bucketLabel(null)).toBeNull()
    expect(bucketLabel(20)).toBe('working set')
    expect(bucketLabel(45)).toBe('restricted')
    expect(bucketLabel(7)).toBe('bucket 7')
  })

  it('recapWithWhen moves an untouched default time, keeps a custom one', () => {
    const r = DEFAULT_NOTIFY_PREFS.recap
    expect(recapWithWhen(r, 'sunday-evening')).toEqual({ enabled: true, when: 'sunday-evening', time: '19:00' })
    expect(recapWithWhen({ ...r, time: '10:30' }, 'sunday-evening').time).toBe('10:30')
    expect(recapWithWhen({ enabled: true, when: 'sunday-evening', time: '19:00' }, 'monday-morning').time).toBe('09:00')
  })
})
