import { describe, it, expect } from 'vitest'
import { bridgeAction, nativeStartOptions, reconcileDecision, startRestTimerBridge, onResumeRestTimer } from './restTimerBridge'
import type { RestLike } from './restTimerBridge'
import { DEFAULT_REST_ALERT } from '../lib/notifyPrefs'

const NOW = 1_800_000_000_000
const sec = (n: number) => n * 1000

const native = (running: boolean, endAt: number, totalSec = 90) => ({ running, endAt, totalSec })
const rest = (endsAt: number, extra: Partial<RestLike> = {}): RestLike => ({ endsAt, totalSec: 90, ...extra })

describe('reconcileDecision', () => {
  it('does nothing when neither side has a timer', () => {
    expect(reconcileDecision(native(false, 0), null, NOW)).toBe('none')
    expect(reconcileDecision(native(false, NOW - sec(600)), null, NOW)).toBe('none')
  })

  it('re-arms a running native timer that matches the store (lost alarm after a force-stop)', () => {
    const end = NOW + sec(40)
    expect(reconcileDecision(native(true, end), rest(end), NOW)).toBe('rearm-native')
  })

  it('leaves a matching timer that ends right now alone', () => {
    expect(reconcileDecision(native(true, NOW + 300), rest(NOW + 300), NOW)).toBe('none')
    expect(reconcileDecision(native(true, NOW - 1500), rest(NOW - 1500), NOW)).toBe('none')
  })

  it('adopts native when it moved while JS was dead (+15 s from the shade) or JS lost its rest', () => {
    expect(reconcileDecision(native(true, NOW + sec(55)), rest(NOW + sec(40)), NOW)).toBe('adopt-native')
    expect(reconcileDecision(native(true, NOW + sec(55)), null, NOW)).toBe('adopt-native')
    // just ended natively (alarm on its way): still adopt, RestTimerBar shows "Rest over"
    expect(reconcileDecision(native(true, NOW - 1000), rest(NOW + sec(30)), NOW)).toBe('adopt-native')
  })

  it('stops a native timer whose end alarm was lost long ago and clears the store', () => {
    const end = NOW - sec(30)
    expect(reconcileDecision(native(true, end), rest(end), NOW)).toBe('stop-native-and-clear')
    expect(reconcileDecision(native(true, end), null, NOW)).toBe('stop-native-and-clear')
    // the store rest is stale too / about to end
    expect(reconcileDecision(native(true, end), rest(NOW - sec(20)), NOW)).toBe('stop-native-and-clear')
    expect(reconcileDecision(native(true, end), rest(NOW + 200), NOW)).toBe('stop-native-and-clear')
  })

  it('hands a live store rest to native when native holds a dead timer', () => {
    expect(reconcileDecision(native(true, NOW - sec(300)), rest(NOW + sec(60)), NOW)).toBe('rearm-native')
  })

  it('clears the store when native stopped this very timer (Skip from the shade while JS was dead)', () => {
    const end = NOW + sec(45)
    expect(reconcileDecision(native(false, end), rest(end), NOW)).toBe('clear-store')
  })

  it('re-arms native for a live store rest it never got (bridge was off when it started)', () => {
    expect(reconcileDecision(native(false, NOW - sec(500)), rest(NOW + sec(45)), NOW)).toBe('rearm-native')
    expect(reconcileDecision(native(false, 0), rest(NOW + sec(45)), NOW)).toBe('rearm-native')
  })

  it('clears a stale "Rest over" left from before a relaunch', () => {
    expect(reconcileDecision(native(false, NOW - sec(60)), rest(NOW - sec(60)), NOW)).toBe('clear-store')
    expect(reconcileDecision(native(false, 0), rest(NOW - sec(11)), NOW)).toBe('clear-store')
  })

  it('lets RestTimerBar finish a rest that ended moments ago or ends within a second', () => {
    expect(reconcileDecision(native(false, NOW - sec(3)), rest(NOW - sec(3)), NOW)).toBe('none')
    expect(reconcileDecision(native(false, NOW + 800), rest(NOW + 800), NOW)).toBe('none')
    expect(reconcileDecision(native(false, 0), rest(NOW - sec(9)), NOW)).toBe('none')
  })
})

describe('bridgeAction', () => {
  it('starts native for a new live rest when enabled', () => {
    expect(bridgeAction(null, rest(NOW + sec(90)), NOW, true)).toBe('start')
    // −15 s / +15 s in the app re-starts (start() is idempotent: re-arms and re-posts)
    expect(bridgeAction(rest(NOW + sec(60)), rest(NOW + sec(45)), NOW, true)).toBe('start')
    // a new set while the previous rest still runs
    expect(bridgeAction(rest(NOW + sec(20)), rest(NOW + sec(90), { label: 'Squat · set 2/3' }), NOW, true)).toBe('start')
  })

  it('does not restart for an identical rest', () => {
    const r = rest(NOW + sec(60), { label: 'x', warmup: true })
    expect(bridgeAction(r, { ...r }, NOW, true)).toBe('none')
    expect(bridgeAction(rest(NOW + sec(60)), rest(NOW + sec(60), { warmup: false }), NOW, true)).toBe('none')
    expect(bridgeAction(rest(NOW + sec(60)), rest(NOW + sec(60), { label: 'Next: Row' }), NOW, true)).toBe('start')
  })

  it('stops native on skip / finish / discard while the rest is running', () => {
    expect(bridgeAction(rest(NOW + sec(30)), null, NOW, true)).toBe('stop')
    expect(bridgeAction(rest(NOW + sec(30)), null, NOW, false)).toBe('stop')
  })

  it('leaves native alone on natural expiry, so its "Rest over" alert survives the auto-clear', () => {
    expect(bridgeAction(rest(NOW - sec(4)), null, NOW, true)).toBe('none')
    expect(bridgeAction(rest(NOW + 400), null, NOW, true)).toBe('none')
  })

  it('never starts when disabled, but stops a previous running rest', () => {
    expect(bridgeAction(null, rest(NOW + sec(90)), NOW, false)).toBe('none')
    expect(bridgeAction(rest(NOW - sec(5)), rest(NOW + sec(30), { warmup: true }), NOW, false)).toBe('none')
    expect(bridgeAction(rest(NOW + sec(50)), rest(NOW + sec(30), { warmup: true }), NOW, false)).toBe('stop')
  })

  it('does not start a rest that is already over', () => {
    expect(bridgeAction(null, rest(NOW + 200), NOW, true)).toBe('none')
    expect(bridgeAction(rest(NOW + sec(20)), rest(NOW + 200), NOW, true)).toBe('stop')
    expect(bridgeAction(null, null, NOW, true)).toBe('none')
  })
})

describe('nativeStartOptions', () => {
  it('maps a rest with the discreet defaults', () => {
    expect(DEFAULT_REST_ALERT.alertMode).toBe('notification')
    expect(nativeStartOptions(rest(NOW + sec(90), { label: 'Squat · set 2/3 · 100 kg × 5' }), DEFAULT_REST_ALERT)).toEqual({
      endAt: NOW + sec(90),
      totalSec: 90,
      title: 'Rest',
      body: 'Squat · set 2/3 · 100 kg × 5',
      countdown: true,
      alert: true,
      alertMode: 'notification',
    })
  })

  it('falls back to a generic body', () => {
    expect(nativeStartOptions(rest(NOW + sec(90)), DEFAULT_REST_ALERT)?.body).toBe('Next set when this hits zero')
    expect(nativeStartOptions(rest(NOW + sec(90), { label: '' }), DEFAULT_REST_ALERT)?.body).toBe('Next set when this hits zero')
  })

  it('keeps warm-up rests silent unless warmupAlert is on', () => {
    const warm = rest(NOW + sec(30), { warmup: true })
    expect(nativeStartOptions(warm, DEFAULT_REST_ALERT)).toMatchObject({ countdown: true, alert: false })
    expect(nativeStartOptions(warm, { ...DEFAULT_REST_ALERT, warmupAlert: true })).toMatchObject({ alert: true })
    expect(nativeStartOptions(warm, { ...DEFAULT_REST_ALERT, countdown: false })).toBeNull()
  })

  it('passes the loud opt-in and returns null when both countdown and alert are off', () => {
    expect(nativeStartOptions(rest(NOW + sec(60)), { ...DEFAULT_REST_ALERT, alertMode: 'alarm' })?.alertMode).toBe('alarm')
    expect(nativeStartOptions(rest(NOW + sec(60)), { ...DEFAULT_REST_ALERT, countdown: false })).toMatchObject({ countdown: false, alert: true })
    expect(nativeStartOptions(rest(NOW + sec(60)), { ...DEFAULT_REST_ALERT, countdown: false, alert: false })).toBeNull()
  })
})

describe('bridge entry points off Android', () => {
  it('are no-ops (the PWA and tests never touch the plugin)', async () => {
    await expect(startRestTimerBridge()).resolves.toBeUndefined()
    await expect(onResumeRestTimer()).resolves.toBeUndefined()
  })
})
