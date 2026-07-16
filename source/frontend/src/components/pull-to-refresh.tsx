import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { RotateCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

const PULL_TO_TRIGGER_PX = 130
const MAX_PULL_PX = 160
const FINGER_TO_CONTENT_RATIO = 0.5
const GAP_BELOW_INDICATOR_PX = 32
const GAP_ABOVE_INDICATOR_PX = 20

interface PullToRefreshProps {
  onRefresh: () => Promise<unknown>
  children: ReactNode
}

/**
 * Mobile pull-to-refresh
 * no-op on non-touch devices, where touch events never fire.
 */
export function PullToRefresh({ onRefresh, children }: PullToRefreshProps) {
  const { t } = useTranslation()
  const [pull, setPull] = useState(0)
  const [active, setActive] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const startY = useRef<number | null>(null)
  const pullRef = useRef(0)
  const refreshingRef = useRef(false)
  const indicatorRef = useRef<HTMLDivElement>(null)

  const setPullValue = useCallback((value: number) => {
    pullRef.current = value
    setPull(value)
  }, [])

  useEffect(() => {
    const atTop = () => window.scrollY <= 0

    const restOffset = () =>
      Math.max(
        PULL_TO_TRIGGER_PX,
        (indicatorRef.current?.offsetHeight ?? 0) + GAP_BELOW_INDICATOR_PX + GAP_ABOVE_INDICATOR_PX,
      )

    const onTouchStart = (event: TouchEvent) => {
      if (refreshingRef.current || event.touches.length !== 1 || !atTop()) {
        startY.current = null
        return
      }
      startY.current = event.touches[0].clientY
    }

    const trigger = async () => {
      refreshingRef.current = true
      setRefreshing(true)
      setPullValue(restOffset())
      try {
        await onRefresh()
      } finally {
        refreshingRef.current = false
        setRefreshing(false)
        setPullValue(0)
      }
    }

    const onTouchMove = (event: TouchEvent) => {
      if (refreshingRef.current || startY.current === null) return
      const delta = event.touches[0].clientY - startY.current
      if (delta <= 0 || !atTop()) {
        if (!atTop()) startY.current = null
        setActive(false)
        setPullValue(0)
        return
      }
      setActive(true)
      setPullValue(Math.min(MAX_PULL_PX, delta * FINGER_TO_CONTENT_RATIO))
      // Suppress the browser's native overscroll while we own the gesture.
      if (event.cancelable) event.preventDefault()
    }

    const finishGesture = () => {
      if (startY.current === null) return
      startY.current = null
      setActive(false)
      if (pullRef.current >= PULL_TO_TRIGGER_PX) {
        void trigger()
      } else {
        setPullValue(0)
      }
    }

    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', finishGesture)
    window.addEventListener('touchcancel', finishGesture)
    return () => {
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', finishGesture)
      window.removeEventListener('touchcancel', finishGesture)
    }
  }, [onRefresh, setPullValue])

  const progress = Math.min(pull / PULL_TO_TRIGGER_PX, 1)
  const spin = (Math.min(pull, MAX_PULL_PX) / MAX_PULL_PX) * 360
  const armed = pull >= PULL_TO_TRIGGER_PX
  const label = refreshing
    ? t('common.refreshing')
    : armed
      ? t('common.releaseToRefresh')
      : t('common.pullToRefresh')

  return (
    <div className="relative">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-10"
        style={{
          transform: `translateY(${pull}px)`,
          transition: active ? 'none' : 'transform 0.2s ease',
        }}
      >
        <div
          ref={indicatorRef}
          role="status"
          aria-live="polite"
          className="absolute inset-x-0 bottom-full flex flex-col items-center gap-1.5"
          style={{
            marginBottom: GAP_BELOW_INDICATOR_PX,
            opacity: refreshing ? 1 : progress,
            transition: active ? 'none' : 'opacity 0.2s ease',
          }}
        >
          <span className="bg-card border-border text-primary flex size-9 items-center justify-center rounded-full border shadow-sm">
            <RotateCw
              aria-hidden="true"
              className={cn('size-5', refreshing && 'animate-spin')}
              style={refreshing ? undefined : { transform: `rotate(${spin}deg)` }}
            />
          </span>
          <span className="text-muted-foreground text-xs font-medium">{label}</span>
          <span className="text-muted-foreground/70 px-4 text-center text-[0.6875rem] leading-tight">
            {t('common.refreshServerOnly')}
          </span>
        </div>
      </div>
      <div
        style={{
          transform: pull > 0 ? `translateY(${pull}px)` : undefined,
          transition: active ? 'none' : 'transform 0.2s ease',
        }}
      >
        {children}
      </div>
    </div>
  )
}
