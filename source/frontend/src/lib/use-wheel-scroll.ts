import { useCallback, useRef, type RefCallback } from 'react'

/**
 * Ref for a scroll container that keeps mouse-wheel scrolling working even when
 * the container lives inside a body-portalled popover that was opened from
 * within a modal Dialog.
 */
export function useWheelScroll<T extends HTMLElement>(): RefCallback<T> {
  const cleanup = useRef<(() => void) | undefined>(undefined)
  return useCallback((node: T | null) => {
    cleanup.current?.()
    cleanup.current = undefined
    if (!node) return
    const onWheel = (event: WheelEvent) => {
      if (node.scrollHeight <= node.clientHeight) return
      // deltaMode: 0 = pixels, 1 = lines, 2 = pages.
      const factor = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? node.clientHeight : 1
      const delta = event.deltaY * factor
      // Swallow the event even at the ends so the page behind the popover
      // never scroll-chains while the pointer is over the list.
      event.preventDefault()
      const atTop = node.scrollTop <= 0
      const atBottom = node.scrollTop + node.clientHeight >= node.scrollHeight - 1
      if ((delta < 0 && atTop) || (delta > 0 && atBottom)) return
      node.scrollTop += delta
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    cleanup.current = () => node.removeEventListener('wheel', onWheel)
  }, [])
}
