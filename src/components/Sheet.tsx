import type { ReactNode } from 'react'
import { X } from 'lucide-react'

interface SheetProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}

/** Bottom sheet — every picker/editor uses this so actions stay in thumb reach. */
export default function Sheet({ open, onClose, title, children }: SheetProps) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 animate-fade-in bg-black/60" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 mx-auto flex max-h-[88dvh] max-w-lg animate-slide-up flex-col rounded-t-2xl border-t border-edge bg-surface">
        <div className="relative shrink-0 border-b border-edge/60 px-4 pb-2 pt-4">
          <div className="absolute left-1/2 top-1.5 h-1 w-10 -translate-x-1/2 rounded-full bg-muted" />
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl font-semibold">{title}</h2>
            <button
              onClick={onClose}
              aria-label="Close"
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-sub active:bg-muted"
            >
              <X size={22} />
            </button>
          </div>
        </div>
        <div className="overflow-y-auto p-4 pb-safe">{children}</div>
      </div>
    </div>
  )
}
