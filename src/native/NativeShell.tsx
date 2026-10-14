import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { App } from '@capacitor/app'
import { KeepAwake } from '@capacitor-community/keep-awake'
import type { PluginListenerHandle } from '@capacitor/core'
import { useAppStore } from '../store'
import { backDepth, popBack } from '../lib/backStack'
import { backAction, sanitizeRoute, subscribePendingRoute } from './navigation'

/** React Router's index of the current entry in its history stack (0 = first), if known. */
function historyIdx(): number | null {
  const idx = (window.history.state as { idx?: unknown } | null)?.idx
  return typeof idx === 'number' ? idx : null
}

function quiet(p: Promise<unknown>): void {
  p.catch(e => console.warn('[native]', e))
}

/**
 * Android-only behaviour that needs the router. Rendered inside <HashRouter> (lazy, only when
 * `isNative`); renders nothing.
 * - Back button: sheet → tab root → Workout → minimize (pure rule in navigation.ts `backAction`).
 * - Notification / rest-timer taps: navigate to the sanitized pending route.
 * - Keep-awake (spec C12): screen stays on while a session is active AND (the session screen is
 *   open OR a rest is running), so glancing at Diet mid-rest works but a forgotten session does
 *   not keep the screen on for hours. (`useWakeLock` is a no-op on native.)
 */
export default function NativeShell(): null {
  const navigate = useNavigate()
  const location = useLocation()
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate
  const locationRef = useRef(location)
  locationRef.current = location

  useEffect(() => {
    // Once a JS listener exists, @capacitor/app no longer navigates the WebView by itself.
    let handle: PluginListenerHandle | undefined
    let disposed = false
    void App.addListener('backButton', () => {
      const { pathname, key } = locationRef.current
      const action = backAction(pathname, key, backDepth() > 0, historyIdx())
      switch (action.kind) {
        case 'close-sheet':
          popBack()
          break
        case 'back':
          navigateRef.current(-1)
          break
        case 'navigate':
          navigateRef.current(action.to, { replace: true })
          break
        case 'minimize':
          quiet(App.minimizeApp())
          break
      }
    })
      .then(h => {
        if (disposed) void h.remove()
        else handle = h
      })
      .catch(e => console.warn('[native] back button listener failed', e))
    return () => {
      disposed = true
      void handle?.remove()
    }
  }, [])

  useEffect(
    () =>
      subscribePendingRoute(route => {
        const to = sanitizeRoute(route, useAppStore.getState().activeSessionId)
        if (to !== locationRef.current.pathname) navigateRef.current(to)
      }),
    [],
  )

  const pathname = location.pathname
  const awake = useAppStore(s => s.activeSessionId !== null && (pathname === '/workout/session' || s.rest !== null))
  useEffect(() => {
    quiet(awake ? KeepAwake.keepAwake() : KeepAwake.allowSleep())
  }, [awake])
  useEffect(() => () => quiet(KeepAwake.allowSleep()), [])

  return null
}
