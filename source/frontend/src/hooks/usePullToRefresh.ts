import { useEffect, useRef, useState } from 'react'

const TRIGGER_DISTANCE_PX = 80
const MAX_VISUAL_PULL_PX = 120

interface UsePullToRefreshArgs {
  onRefresh: () => Promise<unknown> | unknown
  enabled?: boolean
}

interface UsePullToRefreshResult {
  pullDistance: number
  isRefreshing: boolean
}

/**
 * Touch-based pull-to-refresh: when the user starts a downward drag from the
 * very top of the page, track the drag distance and fire `onRefresh` when
 * they release past the trigger threshold.
 */
export function usePullToRefresh({
  onRefresh,
  enabled = true,
}: UsePullToRefreshArgs): UsePullToRefreshResult {
  const [pullDistance, setPullDistance] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const startYRef = useRef<number | null>(null)
  const pullDistanceRef = useRef(0)
  const onRefreshRef = useRef(onRefresh)

  useEffect(() => {
    onRefreshRef.current = onRefresh
  }, [onRefresh])

  useEffect(() => {
    if (!enabled) return

    const setDistance = (next: number) => {
      pullDistanceRef.current = next
      setPullDistance(next)
    }

    const handleTouchStart = (event: TouchEvent) => {
      if (window.scrollY > 0) return
      startYRef.current = event.touches[0]?.clientY ?? null
    }

    const handleTouchMove = (event: TouchEvent) => {
      const startY = startYRef.current
      if (startY === null) return
      const currentY = event.touches[0]?.clientY ?? startY
      const delta = currentY - startY
      if (delta <= 0) {
        setDistance(0)
        return
      }
      // Dampen the pull so it feels rubber-band-y past the trigger.
      setDistance(Math.min(MAX_VISUAL_PULL_PX, delta * 0.5))
    }

    const handleTouchEnd = async () => {
      const finalPull = pullDistanceRef.current
      startYRef.current = null
      setDistance(0)
      if (finalPull >= TRIGGER_DISTANCE_PX) {
        setIsRefreshing(true)
        try {
          await onRefreshRef.current()
        } finally {
          setIsRefreshing(false)
        }
      }
    }

    window.addEventListener('touchstart', handleTouchStart, { passive: true })
    window.addEventListener('touchmove', handleTouchMove, { passive: true })
    window.addEventListener('touchend', handleTouchEnd)
    window.addEventListener('touchcancel', handleTouchEnd)

    return () => {
      window.removeEventListener('touchstart', handleTouchStart)
      window.removeEventListener('touchmove', handleTouchMove)
      window.removeEventListener('touchend', handleTouchEnd)
      window.removeEventListener('touchcancel', handleTouchEnd)
    }
  }, [enabled])

  return { pullDistance, isRefreshing }
}
