import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { PlannerData } from '../lib/notifyPlanner'

/**
 * Reminder engine against an in-memory LocalNotifications fake: permission gating, full vs diff,
 * exactness, debounce/single-flight, triggers, shade cleanup and the invariant-18 discipline.
 * `isNative` is forced on; the Dexie gatherer is replaced by a fixed PlannerData.
 */

type Ln = { id: number; title: string; body: string; isExactNotification?: boolean; extra?: Record<string, unknown>; schedule?: { at?: Date; allowWhileIdle?: boolean }; [k: string]: unknown }

const h = vi.hoisted(() => {
  const s = {
    display: 'granted' as string,
    enabled: true,
    exact: true,
    scheduled: new Map<number, Ln>(),
    delivered: [] as number[],
    triggered: [] as Ln[],
    data: null as unknown as PlannerData,
    dirty: [] as (() => void)[],
  }
  const api = {
    checkPermissions: vi.fn(async () => ({ display: s.display })),
    areEnabled: vi.fn(async () => ({ value: s.enabled })),
    checkExactNotificationSetting: vi.fn(async () => ({ exact_alarm: s.exact ? 'granted' : 'denied' })),
    requestPermissions: vi.fn(async () => {
      s.display = 'granted'
      return { display: 'granted' }
    }),
    createChannel: vi.fn(async (_c: { id: string; importance?: number }) => {}),
    deleteChannel: vi.fn(async () => {}),
    getAll: vi.fn(async (o?: { state?: string }) =>
      ({ notifications: o?.state === 'TRIGGERED' ? s.triggered : [...s.scheduled.values()] })),
    cancel: vi.fn(async ({ notifications }: { notifications: { id: number }[] }) => {
      if (notifications.length === 0) throw new Error('cancel([]) rejects natively')
      for (const n of notifications) s.scheduled.delete(n.id)
    }),
    schedule: vi.fn(async ({ notifications }: { notifications: Ln[] }) => {
      if (s.display !== 'granted' || !s.enabled) throw new Error('schedule() without permission would prompt')
      for (const n of notifications) s.scheduled.set(n.id, n)
      return { notifications: notifications.map(n => ({ id: n.id })) }
    }),
    getDeliveredNotifications: vi.fn(async () => ({ notifications: s.delivered.map(id => ({ id, title: '', body: '' })) })),
    removeDeliveredNotificationsById: vi.fn(async ({ ids }: { ids: number[] }) => {
      s.delivered = s.delivered.filter(i => !ids.includes(i))
    }),
    removeAllDeliveredNotifications: vi.fn(async () => {
      throw new Error('forbidden: kills the rest-timer countdown')
    }),
    changeExactNotificationSetting: vi.fn(async () => {
      s.exact = true
      return { exact_alarm: 'granted' }
    }),
  }
  return { s, api }
})

vi.mock('./platform', () => ({ isNative: true, isAndroid: true }))
vi.mock('@capacitor/local-notifications', () => ({ LocalNotifications: h.api }))
vi.mock('../lib/notifyData', () => ({ gatherPlannerData: vi.fn(async () => h.s.data) }))
vi.mock('./widget', () => ({ pushWidgetState: vi.fn(async () => {}) }))
vi.mock('../db/db', async orig => ({
  ...(await orig<typeof import('../db/db')>()),
  onSyncDirty: (l: () => void) => {
    h.s.dirty.push(l)
    return () => {
      h.s.dirty = h.s.dirty.filter(x => x !== l)
    }
  },
}))

const T = (y: number, m: number, d: number, hh = 0, mi = 0) => new Date(y, m - 1, d, hh, mi).getTime()
const NOW = T(2026, 10, 12, 10) // Monday

function fixture(): PlannerData {
  return {
    today: '2026-10-12', activeSession: false, activeSessionStartedAt: null, sessionDays: [], weekSessionsDone: 1,
    weeklyTarget: 3, dayTypeOverrides: {}, mealsLoggedToday: [], waterTodayMl: 0, waterTargetMl: 2500, lastWaterAt: null,
    bodyLogDates: [],
    rank: { points: 800, seasonStart: '2026-09-01', lastSessionDate: '2026-10-08', streakWeeks: 2, lastStreakWeek: '2026-10-05' },
    recap: { weekMonday: '2026-10-12', sessions: 1, points: 90 },
  }
}

async function load() {
  vi.resetModules()
  const m = await import('./notifications')
  const { useNotifyStore } = await import('../lib/notifyStore')
  const { useAppStore } = await import('../store')
  const planner = await import('../lib/notifyPlanner')
  const db = await import('../db/db')
  // Lunch on so there is a stream of specs besides the default rank/recap ones.
  useNotifyStore.getState().setPrefs(p => ({ ...p, meals: { ...p.meals, lunch: { enabled: true, time: '13:00' } } }))
  const desired = () => planner.planNotifications({ now: Date.now(), prefs: useNotifyStore.getState().prefs, data: h.s.data })
  return { m, useNotifyStore, useAppStore, planner, db, desired }
}

/** Let debounce timers fire and the single-flight run finish. */
async function settle(m: typeof import('./notifications'), ms = 2000) {
  await vi.advanceTimersByTimeAsync(ms)
  await m.whenResyncIdle()
}

function memoryStorage(): Storage {
  const m = new Map<string, string>()
  return {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: k => m.get(k) ?? null,
    key: i => [...m.keys()][i] ?? null,
    removeItem: k => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
  vi.useFakeTimers({ now: NOW })
  Object.assign(h.s, { display: 'granted', enabled: true, exact: true, delivered: [], triggered: [], data: fixture(), dirty: [] })
  h.s.scheduled = new Map()
  Object.values(h.api).forEach(f => f.mockClear())
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('reminder engine', () => {
  it('launch: channels, then a full re-plan matching the planner exactly', async () => {
    const { m, useNotifyStore, desired } = await load()
    await m.startReminderEngine()
    await settle(m)
    const ids = [...h.s.scheduled.keys()].sort()
    expect(ids).toEqual(desired().map(s => s.id).sort())
    expect(ids.length).toBeGreaterThan(8)
    for (const n of h.s.scheduled.values()) {
      expect(n.isExactNotification).toBe(true)
      expect(n.schedule?.allowWhileIdle).toBe(true)
      expect(n.schedule?.at?.getTime()).toBe(n.extra?.atMs)
      expect(n.smallIcon).toBe('ic_stat_gymtracker')
      expect(n.group).toBe('gt_reminders') // never auto-grouped (and silenced) on Android 16
      expect(typeof n.extra?.sig).toBe('string')
      expect((n.extra!.atMs as number) > Date.now() + 30_000).toBe(true)
    }
    const r = useNotifyStore.getState().lastResync!
    expect(r).toMatchObject({ reason: 'launch', scheduled: ids.length, cancelled: 0, exact: true })
    expect(r.horizon).toBeGreaterThan(Date.now())
    const channels = h.api.createChannel.mock.calls.map(c => c[0])
    expect(channels.map(c => c.id)).toEqual([
      'workout_reminders_v1', 'meal_reminders_v1', 'water_reminders_v1', 'rank_alerts_v1', 'weekly_recap_v1',
      'supplement_reminders_v1', 'app_status_v1',
    ])
    expect(channels.find(c => c.id === 'app_status_v1')?.importance).toBe(2)
  })

  it('startReminderEngine is idempotent', async () => {
    const { m } = await load()
    await Promise.all([m.startReminderEngine(), m.startReminderEngine()])
    await m.startReminderEngine()
    await settle(m)
    expect(h.api.createChannel).toHaveBeenCalledTimes(7)
    expect(h.api.schedule).toHaveBeenCalledTimes(1)
  })

  it('never schedules (nor prompts) without granted + enabled', async () => {
    for (const [display, enabled] of [['prompt', true], ['prompt-with-rationale', true], ['denied', true], ['granted', false]] as const) {
      Object.assign(h.s, { display, enabled })
      const { m, useNotifyStore } = await load()
      await m.startReminderEngine()
      await settle(m)
      expect(h.api.schedule).not.toHaveBeenCalled()
      expect(h.api.requestPermissions).not.toHaveBeenCalled()
      expect(useNotifyStore.getState().lastResync).toMatchObject({ skipped: 'permission', scheduled: 0 })
    }
  })

  it('diff mode: a re-plan with nothing new makes no LN writes; a data change touches only what changed', async () => {
    const { m } = await load()
    await m.startReminderEngine()
    await settle(m)
    h.api.cancel.mockClear()
    h.api.schedule.mockClear()
    m.requestResync('resume')
    await settle(m)
    expect(h.api.cancel).not.toHaveBeenCalled()
    expect(h.api.schedule).not.toHaveBeenCalled()
    // Lunch logged today → only today's lunch reminder goes away.
    h.s.data = { ...fixture(), mealsLoggedToday: ['lunch'] }
    m.requestResync('data')
    await settle(m)
    expect(h.api.cancel).toHaveBeenCalledTimes(1)
    expect(h.api.cancel.mock.calls[0][0].notifications).toHaveLength(1)
    expect(h.api.schedule).not.toHaveBeenCalled()
  })

  it('exactness: inexact while not granted, re-armed exact once granted (diff mode)', async () => {
    h.s.exact = false
    const { m, desired } = await load()
    await m.startReminderEngine()
    await settle(m)
    expect([...h.s.scheduled.values()].every(n => n.isExactNotification === false)).toBe(true)
    expect(h.api.changeExactNotificationSetting).not.toHaveBeenCalled()
    await m.openExactAlarmSettings()
    await settle(m)
    expect(h.api.changeExactNotificationSetting).toHaveBeenCalledTimes(1)
    expect([...h.s.scheduled.values()].every(n => n.isExactNotification === true)).toBe(true)
    expect(h.s.scheduled.size).toBe(desired().length)
  })

  it('resume is full only when the build/timezone stamp changed', async () => {
    const { m, useNotifyStore } = await load()
    await m.startReminderEngine()
    await settle(m)
    h.api.cancel.mockClear()
    await m.onResumeReminders()
    await settle(m)
    expect(h.api.cancel).not.toHaveBeenCalled()
    useNotifyStore.getState().setPlanStamp('older-build|UTC|0')
    await m.onResumeReminders()
    await settle(m)
    expect(h.api.cancel).toHaveBeenCalledTimes(1)
    expect(h.api.cancel.mock.calls[0][0].notifications).toHaveLength(h.s.scheduled.size)
  })

  it('debounce + single flight: a burst of data writes is one run; a request during a run queues one more', async () => {
    const { m } = await load()
    const notifyData = await import('../lib/notifyData')
    const gather = vi.mocked(notifyData.gatherPlannerData)
    gather.mockClear()
    for (let i = 0; i < 4; i++) {
      m.requestResync('data')
      await vi.advanceTimersByTimeAsync(300)
    }
    expect(gather).not.toHaveBeenCalled() // 1.5 s from the FIRST write (later writes never push it back)
    await settle(m)
    expect(gather).toHaveBeenCalledTimes(1)
    // prefs (0.4 s) pre-empts a pending data deadline (1.5 s): earliest wins.
    gather.mockClear()
    m.requestResync('data')
    m.requestResync('prefs')
    await vi.advanceTimersByTimeAsync(450)
    await m.whenResyncIdle()
    expect(gather).toHaveBeenCalledTimes(1)
    // During a run, two more requests → exactly one extra run.
    gather.mockClear()
    let release!: () => void
    gather.mockImplementationOnce(() => new Promise(r => { release = () => r(h.s.data) }))
    m.requestResync('manual')
    await vi.advanceTimersByTimeAsync(1)
    m.requestResync('manual')
    m.requestResync('session')
    await vi.advanceTimersByTimeAsync(1)
    release()
    await settle(m)
    expect(gather).toHaveBeenCalledTimes(2)
  })

  it('triggers: sync-dirty writes, data replaced, session change and prefs change all re-plan', async () => {
    const { m, useNotifyStore, useAppStore, db } = await load()
    await m.startReminderEngine()
    await settle(m)
    const reasons = () => useNotifyStore.getState().lastResync?.reason
    h.s.dirty.forEach(l => l())
    await settle(m)
    expect(reasons()).toBe('data')
    db.emitDataReplaced()
    await settle(m)
    expect(reasons()).toBe('import')
    useAppStore.getState().setActiveSessionId('s1')
    await settle(m)
    expect(reasons()).toBe('session')
    useNotifyStore.getState().setPrefs(p => ({ ...p, water: { ...p.water, enabled: true } }))
    await settle(m)
    expect(reasons()).toBe('prefs')
    expect([...h.s.scheduled.values()].some(n => (n.extra?.key as string).startsWith('water:'))).toBe(true)
    // Turning everything off cancels every managed alarm.
    useNotifyStore.getState().setPrefs(p => ({ ...p, enabled: false }))
    await settle(m)
    expect(h.s.scheduled.size).toBe(0)
    expect(useNotifyStore.getState().lastResync).toMatchObject({ skipped: 'disabled' })
  })

  it('shade cleanup: removes stale managed notifications only; prunes old fired records', async () => {
    const { m, planner } = await load()
    const today = planner.dayIdx('2026-10-12')
    const yesterdayMeal = planner.nid(11, today - 1, 1)
    const justFired = { id: planner.nid(12, today, 0), title: '', body: '', extra: { atMs: Date.now() - 10_000 } }
    const oldFired = { id: planner.nid(11, today - 2, 0), title: '', body: '', extra: { atMs: Date.now() - 2 * 86_400_000 } }
    h.s.delivered = [4201, 4202, planner.nid(99, 0, 0), yesterdayMeal]
    h.s.triggered = [justFired, oldFired, { id: yesterdayMeal, title: '', body: '', extra: { atMs: Date.now() - 86_400_000 } }]
    await m.startReminderEngine()
    await settle(m)
    expect(h.api.removeDeliveredNotificationsById).toHaveBeenCalledTimes(1)
    expect(h.api.removeDeliveredNotificationsById.mock.calls[0][0].ids.sort()).toEqual([yesterdayMeal, oldFired.id].sort())
    expect(h.s.delivered).toEqual([4201, 4202, planner.nid(99, 0, 0)])
    expect(h.api.removeAllDeliveredNotifications).not.toHaveBeenCalled()
  })

  it('leaves an alarm due within the lead window alone (it could not be re-armed in time)', async () => {
    const { m, planner, useNotifyStore } = await load()
    const imminent = { id: planner.nid(11, planner.dayIdx('2026-10-12'), 3), title: 'Log your dinner', body: '', isExactNotification: true, extra: { atMs: Date.now() + 20_000, sig: 'x' } }
    h.s.scheduled.set(imminent.id, imminent)
    await m.startReminderEngine() // full mode
    await settle(m, 10)
    expect(h.s.scheduled.get(imminent.id)).toBe(imminent)
    m.requestResync('data') // diff mode
    await settle(m, 1600)
    expect(h.s.scheduled.has(imminent.id)).toBe(true)
    // …but switching reminders off cancels it too.
    useNotifyStore.getState().setPrefs(p => ({ ...p, enabled: false }))
    await settle(m, 500)
    expect(h.s.scheduled.size).toBe(0)
  })

  it('never cancels unmanaged ids (test reminder) on a full launch', async () => {
    const { m, planner } = await load()
    const test = { id: planner.nid(99, 0, 0), title: 't', body: 'b' }
    h.s.scheduled.set(test.id, test)
    await m.startReminderEngine()
    await settle(m)
    expect(h.s.scheduled.get(test.id)).toBe(test)
    for (const call of h.api.cancel.mock.calls) {
      expect(call[0].notifications.length).toBeGreaterThan(0)
      for (const n of call[0].notifications) expect(planner.isManagedId(n.id)).toBe(true)
    }
  })

  it('test reminder: 15 s out on the workout channel, opens Settings; refuses without permission', async () => {
    const { m, planner } = await load()
    await m.sendTestReminder()
    const n = h.s.scheduled.get(planner.nid(99, 0, 0))!
    expect(n.extra?.atMs).toBe(Date.now() + 15_000)
    expect(n).toMatchObject({ channelId: 'workout_reminders_v1', isExactNotification: true, group: 'gt_reminders' })
    expect(n.extra?.route).toBe('/settings')
    h.s.display = 'denied'
    await expect(m.sendTestReminder()).rejects.toThrow(/allow/)
  })

  it('summary: count and horizon exclude the keep-alive', async () => {
    const { m, planner, desired } = await load()
    await m.startReminderEngine()
    await settle(m)
    const d = desired()
    const reminders = d.filter(s => s.cat !== 'keepalive')
    expect(d.some(s => s.cat === 'keepalive')).toBe(true)
    const sum = await m.getScheduledSummary()
    expect(sum.count).toBe(reminders.length)
    expect(sum.next).toEqual({ atMs: reminders[0].atMs, title: reminders[0].title })
    expect(sum.horizon).toBe(planner.planHorizon(d))
  })

  it('first-workout prompt: asks once, only while Android would still show it', async () => {
    h.s.display = 'prompt'
    const { m, useNotifyStore } = await load()
    await m.maybeAskOnFirstWorkout()
    await m.maybeAskOnFirstWorkout()
    expect(h.api.requestPermissions).toHaveBeenCalledTimes(1)
    expect(useNotifyStore.getState().permissionAsked).toBe(true)
    h.s.display = 'granted'
    const again = await load()
    again.useNotifyStore.setState({ permissionAsked: false })
    h.api.requestPermissions.mockClear()
    await again.m.maybeAskOnFirstWorkout()
    expect(h.api.requestPermissions).not.toHaveBeenCalled()
  })

  it('every reminder route is an allowed deep link', async () => {
    const { m } = await load()
    const { ALLOWED_ROUTES } = await import('./navigation')
    const { REMINDER_ROUTES } = await import('../lib/notifyPlanner')
    for (const r of REMINDER_ROUTES) expect(ALLOWED_ROUTES as readonly string[]).toContain(r)
    await m.startReminderEngine()
    await settle(m)
    for (const n of h.s.scheduled.values()) expect(ALLOWED_ROUTES as readonly string[]).toContain(n.extra?.route)
  })
})
