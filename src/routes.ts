import { Dumbbell, UtensilsCrossed, TrendingUp, Trophy, Settings } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { t } from './i18n'

/** A bottom-nav tab root. Shared by TabBar, the Android back handler and deep-link routing.
 * `label` is resolved once at load (a language change reloads the app). */
export interface TabRoute {
  path: '/workout' | '/diet' | '/progress' | '/rank' | '/settings'
  label: string
  icon: LucideIcon
}

export const TAB_ROUTES: TabRoute[] = [
  { path: '/workout', icon: Dumbbell, label: t('components.tabBar.workout') },
  { path: '/diet', icon: UtensilsCrossed, label: t('components.tabBar.diet') },
  { path: '/progress', icon: TrendingUp, label: t('components.tabBar.progress') },
  { path: '/rank', icon: Trophy, label: t('components.tabBar.rank') },
  { path: '/settings', icon: Settings, label: t('components.tabBar.settings') },
]

/** Every screen route pattern declared in App.tsx (the `/` and `*` redirects excluded). */
export const KNOWN_ROUTES: string[] = [
  '/workout',
  '/workout/template/:id',
  '/workout/session',
  '/workout/summary/:id',
  '/workout/history',
  '/workout/exercises',
  '/workout/past/:id',
  '/workout/programs',
  '/diet',
  '/progress',
  '/progress/bodyweight',
  '/progress/coach',
  '/progress/week',
  '/progress/exercise/:id',
  '/rank',
  '/settings',
  '/import',
]
