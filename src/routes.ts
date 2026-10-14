import { Dumbbell, UtensilsCrossed, TrendingUp, Trophy, Settings } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/** A bottom-nav tab root. Shared by TabBar, the Android back handler and deep-link routing. */
export interface TabRoute {
  path: '/workout' | '/diet' | '/progress' | '/rank' | '/settings'
  label: string
  icon: LucideIcon
}

export const TAB_ROUTES: TabRoute[] = [
  { path: '/workout', icon: Dumbbell, label: 'Workout' },
  { path: '/diet', icon: UtensilsCrossed, label: 'Diet' },
  { path: '/progress', icon: TrendingUp, label: 'Progress' },
  { path: '/rank', icon: Trophy, label: 'Rank' },
  { path: '/settings', icon: Settings, label: 'Settings' },
]

/** Every screen route pattern declared in App.tsx (the `/` and `*` redirects excluded). */
export const KNOWN_ROUTES: string[] = [
  '/workout',
  '/workout/template/:id',
  '/workout/session',
  '/workout/summary/:id',
  '/workout/history',
  '/workout/past/:id',
  '/diet',
  '/progress',
  '/progress/bodyweight',
  '/progress/coach',
  '/rank',
  '/settings',
]
