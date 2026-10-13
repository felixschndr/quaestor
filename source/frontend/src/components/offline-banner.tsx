import { useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { onlineManager } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CloudOff } from 'lucide-react'

export const OFFLINE_BANNER_RESIZE_EVENT = 'offline-banner-resize'

// Fixed on top of every page. Its height goes into --offline-banner-height, so the layout and the pages' own fixed and
// sticky headers move down by it instead of hiding it.
export function OfflineBanner() {
  const { t } = useTranslation()
  const online = useSyncExternalStore(onlineManager.subscribe.bind(onlineManager), () =>
    onlineManager.isOnline(),
  )
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const banner = ref.current
    const root = document.documentElement
    const publish = (height: number) => {
      root.style.setProperty('--offline-banner-height', `${height}px`)
      window.dispatchEvent(new Event(OFFLINE_BANNER_RESIZE_EVENT))
    }
    if (!banner) return
    const observer = new ResizeObserver(() => publish(banner.getBoundingClientRect().height))
    observer.observe(banner)
    publish(banner.getBoundingClientRect().height)
    return () => {
      observer.disconnect()
      publish(0)
    }
  }, [online])

  if (online) return null
  return (
    <div
      ref={ref}
      role="status"
      className="bg-muted text-muted-foreground fixed inset-x-0 top-0 z-30 flex items-center justify-center gap-2 px-4 py-2 text-center text-xs"
    >
      <CloudOff className="size-4 shrink-0" aria-hidden="true" />
      <span>{t('offlineCache.banner')}</span>
    </div>
  )
}
