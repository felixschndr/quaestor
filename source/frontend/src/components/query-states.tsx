import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export function QueryStates({
  query,
  loadingText,
  loadingSkeleton,
  errorText,
  isEmpty = false,
  emptyText,
  emptyClassName,
  children,
}: {
  query: { isLoading: boolean; isError: boolean }
  loadingText: ReactNode
  loadingSkeleton?: ReactNode
  errorText: ReactNode
  isEmpty?: boolean
  emptyText?: ReactNode
  emptyClassName?: string
  children: ReactNode
}) {
  if (query.isLoading) {
    if (!loadingSkeleton) return <p className="text-muted-foreground text-sm">{loadingText}</p>
    return (
      <>
        <span className="sr-only">{loadingText}</span>
        {loadingSkeleton}
      </>
    )
  }
  if (query.isError) return <p className="text-destructive text-sm">{errorText}</p>
  if (isEmpty)
    return <p className={cn('text-muted-foreground text-sm', emptyClassName)}>{emptyText}</p>
  return <>{children}</>
}
