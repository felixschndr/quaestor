import { RefreshCw } from 'lucide-react'

import { SuccessCheck, useSuccessCheck } from '@/components/sync-check'
import { WarningDot } from '@/components/warning-dot'
import { cn } from '@/lib/utils'

export interface SyncButtonProps {
  onClick: () => void
  spinning: boolean
  disabled?: boolean
  succeededAt: number | null
  ariaLabel: string
  className?: string
  warn?: boolean
}

export function SyncButton({
  onClick,
  spinning,
  disabled = false,
  succeededAt,
  ariaLabel,
  className,
  warn = false,
}: SyncButtonProps) {
  const { mounted: checkMounted, open: checkOpen } = useSuccessCheck(succeededAt)

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || checkMounted}
      aria-label={ariaLabel}
      title={ariaLabel}
      className={cn(
        'group relative cursor-pointer rounded-md p-1.5 transition-colors disabled:cursor-default disabled:opacity-50',
        checkMounted ? 'text-success disabled:opacity-100' : 'text-primary hover:text-primary/80',
        className,
      )}
    >
      {checkMounted ? (
        <SuccessCheck open={checkOpen} className="size-5" />
      ) : (
        <RefreshCw
          className={cn(
            'size-5 transition-transform duration-500 ease-in-out',
            spinning ? 'animate-spin' : 'group-hover:rotate-[180deg]',
          )}
          aria-hidden="true"
        />
      )}
      {warn && !checkMounted ? <WarningDot /> : null}
    </button>
  )
}
