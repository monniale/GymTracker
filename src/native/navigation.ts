import { TAB_ROUTES } from '../routes'

/**
 * Native navigation helpers. Pure apart from the pending-route queue below, and free of plugin
 * imports so it is unit-testable (navigation.test.ts).
 */

/**
 * Hash routes a notification tap / native intent may open. MainActivity is exported, so any app can
 * send it a `gt_route` extra: everything is matched exactly against this list. Never
 * `/workout/summary/*` (ROUTEMAP invariant 11).
 */
export const ALLOWED_ROUTES = ['/workout', '/workout/session', '/diet', '/progress', '/progress/week', '/rank', '/settings'] as const

export type AllowedRoute = (typeof ALLOWED_ROUTES)[number]

const FALLBACK: AllowedRoute = '/workout'

function hasActiveSession(id: unknown): boolean {
  return (typeof id === 'number' && Number.isFinite(id)) || (typeof id === 'string' && id.length > 0)
}

/** Not allowed → '/workout'; '/workout/session' without an active session → '/workout'. */
export function sanitizeRoute(route: unknown, activeSessionId: unknown): AllowedRoute {
  if (typeof route !== 'string') return FALLBACK
  const r = route.trim()
  const allowed = ALLOWED_ROUTES.find(a => a === r)
  if (!allowed) return FALLBACK
  if (allowed === '/workout/session' && !hasActiveSession(activeSessionId)) return FALLBACK
  return allowed
}

/* ---------- pending route (notification tap → NativeShell) ---------- */

// Raw (unsanitized) route: it is sanitized on delivery, against the active session at that moment.
let pending: string | null = null
const listeners = new Set<(route: string) => void>()

/**
 * Queues a route to open (from a notification tap). Delivered at once if NativeShell is mounted,
 * otherwise held until it subscribes (a cold start from a tap fires before React renders).
 * Non-string / empty values are ignored: the app just opens where it was.
 */
export function setPendingRoute(route: unknown): void {
  if (typeof route !== 'string' || route.trim() === '') return
  if (listeners.size === 0) {
    pending = route // latest tap wins
    return
  }
  for (const l of [...listeners]) l(route)
}

/** Delivers a queued pending route immediately, then every new one. Returns unsubscribe. */
export function subscribePendingRoute(fn: (route: string) => void): () => void {
  listeners.add(fn)
  if (pending !== null) {
    const r = pending
    pending = null
    fn(r)
  }
  return () => {
    listeners.delete(fn)
  }
}

/* ---------- Android back button ---------- */

export type BackAction =
  | { kind: 'close-sheet' } // pop the top-most open Sheet (src/lib/backStack.ts)
  | { kind: 'back' } // navigate(-1): there is an in-app history entry to return to
  | { kind: 'navigate'; to: string } // navigate(to, { replace: true })
  | { kind: 'minimize' } // App.minimizeApp(): never exitApp (keeps a session / rest timer warm)

const TAB_PATHS: readonly string[] = TAB_ROUTES.map(t => t.path)

/** Parent tab of a sub-route ('/workout/past/7' → '/workout'); '/workout' when there is none. */
function parentTab(pathname: string): string {
  const root = `/${pathname.split('/')[1] ?? ''}`
  return TAB_PATHS.includes(root) ? root : FALLBACK
}

/**
 * What the Android back button does (owner decision 6 / spec C11):
 * 1. an open sheet → close it;
 * 2. a tab root other than Workout → Workout; Workout → minimize;
 * 3. a sub-route with in-app history → back;
 * 4. a sub-route that is the first history entry → its parent tab.
 * `key` is React Router's location key ('default' = initial entry); `historyIdx` is the router's
 * `window.history.state.idx` when known (0 = first entry, nothing to go back to).
 */
export function backAction(
  pathname: string,
  key: string,
  sheetOpen: boolean,
  historyIdx: number | null = null,
): BackAction {
  if (sheetOpen) return { kind: 'close-sheet' }
  if (TAB_PATHS.includes(pathname)) {
    return pathname === FALLBACK ? { kind: 'minimize' } : { kind: 'navigate', to: FALLBACK }
  }
  const hasHistory = key !== 'default' && (historyIdx === null || historyIdx > 0)
  return hasHistory ? { kind: 'back' } : { kind: 'navigate', to: parentTab(pathname) }
}
