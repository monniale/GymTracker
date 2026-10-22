import { registerPlugin } from '@capacitor/core'
import { isNative } from './platform'
import { gatherWidgetState, type WidgetState } from '../lib/widgetData'

/**
 * App-local `Widget` plugin (android/…/widget/WidgetPlugin.java): stores the widget's numbers and
 * redraws every placed GymTracker widget. Android only — no web implementation.
 */
interface WidgetPlugin {
  update(state: WidgetState): Promise<void>
  getStatus(): Promise<{ widgets: number; updatedAt: number }>
  requestPin(): Promise<{ supported: boolean }>
}

const Widget = registerPlugin<WidgetPlugin>('Widget')

/**
 * Pushes the current numbers to the home-screen widget. Called after every reminder re-plan
 * (notifications.ts `kick`), so it follows the same triggers: launch, resume, data edits,
 * imports/sync, session start/finish, midnight. Never throws.
 */
export async function pushWidgetState(): Promise<void> {
  if (!isNative) return
  try {
    await Widget.update(await gatherWidgetState())
  } catch {
    /* a widget refresh must never break the re-plan loop */
  }
}

/** Asks the launcher to place the widget; false when it can't (add it from the widget picker). */
export async function requestWidgetPin(): Promise<boolean> {
  if (!isNative) return false
  try {
    return (await Widget.requestPin()).supported
  } catch {
    return false
  }
}

/** Widgets placed on the home screen (Settings diagnostics / smoke test). */
export async function getWidgetStatus(): Promise<{ widgets: number; updatedAt: number } | null> {
  if (!isNative) return null
  try {
    return await Widget.getStatus()
  } catch {
    return null
  }
}
