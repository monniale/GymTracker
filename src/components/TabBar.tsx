import { NavLink } from 'react-router-dom'
import { Dumbbell, UtensilsCrossed, Trophy, Settings } from 'lucide-react'

const TABS = [
  { to: '/workout', icon: Dumbbell, label: 'Workout' },
  { to: '/diet', icon: UtensilsCrossed, label: 'Diet' },
  { to: '/rank', icon: Trophy, label: 'Rank' },
  { to: '/settings', icon: Settings, label: 'Settings' },
]

export default function TabBar() {
  return (
    <nav className="border-t border-edge bg-surface/95 pb-safe backdrop-blur">
      <div className="mx-auto flex max-w-lg">
        {TABS.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors ${
                isActive ? 'text-primary' : 'text-sub active:text-ink'
              }`
            }
          >
            <Icon size={22} strokeWidth={2} aria-hidden />
            {label}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
