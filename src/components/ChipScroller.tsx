import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

const FADE = 28

/**
 * A horizontally swipeable row of chips without the browser's scrollbar: the edges fade out
 * where more chips are hidden, so the row reads as scrollable on every platform.
 */
export default function ChipScroller({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ left: false, right: false })

  const update = () => {
    const el = ref.current
    if (!el) return
    const left = el.scrollLeft > 1
    const right = el.scrollLeft < el.scrollWidth - el.clientWidth - 1
    setEdges(prev => (prev.left === left && prev.right === right ? prev : { left, right }))
  }
  // After every render too: chips come and go (a muscle filter chip) without a resize.
  useEffect(update)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.addEventListener('scroll', update, { passive: true })
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
    ro?.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      ro?.disconnect()
    }
  }, [])

  const mask = `linear-gradient(to right, ${edges.left ? 'transparent' : '#000'} 0, #000 ${FADE}px, #000 calc(100% - ${FADE}px), ${edges.right ? 'transparent' : '#000'} 100%)`
  return (
    <div
      ref={ref}
      className={`no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto overscroll-x-contain px-1 ${className}`}
      style={{ maskImage: mask, WebkitMaskImage: mask }}
    >
      {children}
    </div>
  )
}
