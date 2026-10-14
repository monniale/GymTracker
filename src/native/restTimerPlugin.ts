import { registerPlugin, WebPlugin } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'

/**
 * App-local Java plugin `RestTimer` (android/…/resttimer/RestTimerPlugin.java): live countdown
 * notification + exact end alarm + "Rest over" alert, with Skip / +15 s handled natively (works with
 * the process dead). Native-only module (ROUTEMAP invariant 14): reach it via `restTimerBridge.ts`.
 */
export interface RestTimerState {
  running: boolean
  /** epoch ms (wall clock) */
  endAt: number
  totalSec: number
  /** epoch ms when the end alarm fired, 0 if never */
  endedAt: number
  /** false = exact alarm unavailable, the end alert may be late */
  exact: boolean
}

export interface RestTimerStartOptions {
  /** epoch ms in the future (rejected otherwise) */
  endAt: number
  totalSec?: number
  /** default 'Rest' */
  title?: string
  body?: string
  /** ongoing chronometer notification (default true) */
  countdown?: boolean
  /** "Rest over" notification when the timer ends with the app in the background (default true) */
  alert?: boolean
  /** 'notification' = discreet, follows the ringer (default); 'alarm' = loud, alarm volume */
  alertMode?: 'alarm' | 'notification'
}

export type RestTimerEvent = 'actionSkip' | 'actionExtend' | 'timerEnd' | 'notificationDismissed'

export interface RestTimerPlugin {
  /** Idempotent: re-arms the end alarm and re-posts the countdown. */
  start(opts: RestTimerStartOptions): Promise<RestTimerState>
  /** Rejects with code NOT_RUNNING when no timer runs. */
  extend(opts: { seconds: number }): Promise<RestTimerState>
  /** Cancels the alarm, the countdown and a pending "Rest over" alert. */
  stop(): Promise<RestTimerState>
  getState(): Promise<RestTimerState>
  addListener(event: RestTimerEvent, fn: (s: RestTimerState & { deltaSec?: number }) => void): Promise<PluginListenerHandle>
  /** A rest notification was tapped (route '/workout/session'); cold starts are retained until a listener exists. */
  addListener(event: 'openRoute', fn: (e: { route: string }) => void): Promise<PluginListenerHandle>
  removeAllListeners(): Promise<void>
}

/** Web/PWA no-op (never used by the Pages build: the bridge only runs on Android). */
class RestTimerWeb extends WebPlugin {
  private s: RestTimerState = { running: false, endAt: 0, totalSec: 0, endedAt: 0, exact: false }

  async start(o: RestTimerStartOptions): Promise<RestTimerState> {
    this.s = { running: true, endAt: o.endAt, totalSec: o.totalSec ?? 0, endedAt: 0, exact: false }
    return this.s
  }

  async extend(o: { seconds: number }): Promise<RestTimerState> {
    if (this.s.running) this.s = { ...this.s, endAt: this.s.endAt + o.seconds * 1000 }
    return this.s
  }

  async stop(): Promise<RestTimerState> {
    this.s = { ...this.s, running: false }
    return this.s
  }

  async getState(): Promise<RestTimerState> {
    return this.s
  }
}

export const RestTimer = registerPlugin<RestTimerPlugin>('RestTimer', {
  web: () => new RestTimerWeb(),
})
