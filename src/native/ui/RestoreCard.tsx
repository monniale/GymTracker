import { useNavigate } from 'react-router-dom'
import { ArchiveRestore, ChevronRight, Cloud, Upload } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useNotifyStore } from '../../lib/notifyStore'

/**
 * First-run card on the Workout tab (Android, amendment A8). WorkoutHome renders it while the
 * install is empty (no sessions, no food logs) and "Start fresh" hasn't been chosen: restoring
 * before logging anything leaves nothing on the phone to merge (the seed rows carry updatedAt 0
 * and never win a merge anyway, seed.ts).
 * The Settings links carry `state.focus`, which SettingsScreen scrolls into view.
 */
export default function RestoreCard() {
  const navigate = useNavigate()
  const setRestoreDismissed = useNotifyStore(s => s.setRestoreDismissed)

  return (
    <section className="mb-4 rounded-2xl border border-primary/40 bg-card p-4">
      <h2 className="flex items-center gap-2 font-display text-xl font-bold">
        <ArchiveRestore size={20} className="shrink-0 text-primary" /> Restore your data
      </h2>
      <p className="mt-1 text-sm text-sub">
        Used GymTracker before? Bring your history over before you log anything here.
      </p>
      <div className="mt-3 space-y-2">
        <Choice
          icon={Cloud}
          title="Connect GitHub Sync"
          where="Settings"
          onClick={() => navigate('/settings', { state: { focus: 'sync' } })}
        />
        <Choice
          icon={Upload}
          title="Import a backup"
          where="Settings › Data"
          onClick={() => navigate('/settings', { state: { focus: 'data' } })}
        />
      </div>
      <p className="mt-2 text-xs leading-relaxed text-sub">
        If Sync asks how to combine, choose “Use cloud data (replace this device)”.
      </p>
      <button
        type="button"
        onClick={() => setRestoreDismissed(true)}
        className="mt-1 min-h-[44px] w-full rounded-xl text-sm font-semibold text-sub active:bg-muted/30"
      >
        Start fresh
      </button>
    </section>
  )
}

function Choice({ icon: Icon, title, where, onClick }: { icon: LucideIcon; title: string; where: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[52px] w-full items-center gap-3 rounded-xl bg-primary/15 px-3 text-left text-primary active:bg-primary/30"
    >
      <Icon size={20} className="shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{title}</span>
        <span className="block truncate text-xs text-sub">{where}</span>
      </span>
      <ChevronRight size={18} className="shrink-0" />
    </button>
  )
}
