import { cn } from '@/lib/utils'

export function WarningDot({ className }: { className?: string } = {}) {
  return (
    <span
      className={cn('bg-warning absolute top-2 right-2 size-2 rounded-full', className)}
      aria-hidden="true"
    />
  )
}
