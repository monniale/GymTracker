import { NavLink } from 'react-router-dom'
import { TAB_ROUTES } from '../routes'

export default function TabBar() {
  return (
    <nav className="border-t border-edge bg-surface/95 pb-safe backdrop-blur">
      <div className="mx-auto flex max-w-lg">
        {TAB_ROUTES.map(({ path, icon: Icon, label }) => (
          <NavLink
            key={path}
            to={path}
            className={({ isActive }) =>
              `flex min-h-[56px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors ${
                isActive ? 'text-primary' : 'text-sub active:text-ink'
              }`
            }
          >
            <Icon size={22} strokeWidth={2} aria-hidden />
            <span className="max-w-full truncate px-0.5">{label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
