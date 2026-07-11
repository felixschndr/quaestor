import { useCallback, useRef, type RefCallback } from 'react'

const DIRECTION_THRESHOLD_PX = 6

export function useHorizontalScrubLock<T extends HTMLElement>(): RefCallback<T> {
  const cleanup = useRef<(() => void) | undefined>(undefined)
  return useCallback((node: T | null) => {
    cleanup.current?.()
    cleanup.current = undefined
    if (!node) return
    let startX = 0
    let startY = 0
    let horizontal: boolean | null = null
    const onTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0]
      if (!touch) return
      startX = touch.clientX
      startY = touch.clientY
      horizontal = null
    }
    const onTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0]
      if (!touch) return
      if (horizontal === null) {
        const deltaX = Math.abs(touch.clientX - startX)
        const deltaY = Math.abs(touch.clientY - startY)
        if (Math.max(deltaX, deltaY) < DIRECTION_THRESHOLD_PX) return
        horizontal = deltaX > deltaY
      }
      if (horizontal && event.cancelable) event.preventDefault()
    }
    node.addEventListener('touchstart', onTouchStart, { passive: true })
    node.addEventListener('touchmove', onTouchMove, { passive: false })
    cleanup.current = () => {
      node.removeEventListener('touchstart', onTouchStart)
      node.removeEventListener('touchmove', onTouchMove)
    }
  }, [])
}
