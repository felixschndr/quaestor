import { cn } from '@/lib/utils'

export function WarningDot({ className }: { className?: string } = {}) {
  return (
    <span
      className={cn(
        'bg-warning warning-dot-pulse absolute top-2 right-2 size-2.5 rounded-full',
        className,
      )}
      aria-hidden="true"
    />
  )
}
