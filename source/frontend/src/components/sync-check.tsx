import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Loader2 } from 'lucide-react'

import { cn } from '@/lib/utils'

export const CHECK_ZOOM_MS = 200
export const CHECK_HOLD_MS = 1200

export function useSuccessCheck(succeededAt: number | null): { mounted: boolean; open: boolean } {
  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (succeededAt === null) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true)
    const raf = requestAnimationFrame(() => setOpen(true))
    const closeTimer = setTimeout(() => setOpen(false), CHECK_ZOOM_MS + CHECK_HOLD_MS)
    const unmountTimer = setTimeout(
      () => setMounted(false),
      CHECK_ZOOM_MS + CHECK_HOLD_MS + CHECK_ZOOM_MS,
    )
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(closeTimer)
      clearTimeout(unmountTimer)
    }
  }, [succeededAt])

  return { mounted, open }
}

export function SuccessCheck({
  open,
  className,
  ariaLabel,
}: {
  open: boolean
  className?: string
  ariaLabel?: string
}) {
  return (
    <Check
      className={cn('transition-transform ease-out', open ? 'scale-100' : 'scale-0', className)}
      style={{ transitionDuration: `${CHECK_ZOOM_MS}ms` }}
      {...(ariaLabel ? { role: 'status', 'aria-label': ariaLabel } : { 'aria-hidden': true })}
    />
  )
}

export type SyncState = 'running' | 'completed' | undefined

export function SyncStatusIcon({ state }: { state: SyncState }) {
  const { t } = useTranslation()
  const [succeededAt, setSucceededAt] = useState<number | null>(null)
  const wasRunning = useRef(false)

  useEffect(() => {
    if (state === 'running') {
      wasRunning.current = true
      return
    }
    if (!wasRunning.current || state !== 'completed') return
    wasRunning.current = false
    setSucceededAt(Date.now())
  }, [state])

  const { mounted, open } = useSuccessCheck(succeededAt)

  if (state === 'running') {
    return (
      <Loader2
        className="text-success size-4 shrink-0 animate-spin"
        aria-label={t('overview.syncing')}
        role="status"
      />
    )
  }
  if (!mounted) return null
  return (
    <SuccessCheck
      open={open}
      className="text-success size-4 shrink-0"
      ariaLabel={t('overview.synced')}
    />
  )
}
