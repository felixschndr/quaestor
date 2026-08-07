import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

export interface ChartCardProps {
  title: string
  icon?: ReactNode
  info?: ReactNode
  isLoading: boolean
  isError: boolean
  isEmpty: boolean
  isStale?: boolean
  emptyLabel?: string
  action?: ReactNode
  children: ReactNode
}

export function ChartCard({
  title,
  icon,
  info,
  isLoading,
  isError,
  isEmpty,
  isStale = false,
  emptyLabel,
  action,
  children,
}: ChartCardProps) {
  const { t } = useTranslation()

  return (
    <section
      aria-busy={isStale || undefined}
      className={cn(
        'border-border bg-card flex flex-col gap-3 rounded-lg border p-4 transition-opacity',
        isStale && 'opacity-50',
      )}
    >
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-primary inline-flex items-center gap-2 text-sm font-semibold">
          {icon}
          {title}
        </h2>
        <div className="flex items-center gap-2">
          {action}
          {info}
        </div>
      </header>
      {isLoading ? (
        <p className="text-muted-foreground text-sm">{t('common.loading')}</p>
      ) : isError ? (
        <p className="text-destructive text-sm">{t('stats.error')}</p>
      ) : isEmpty ? (
        <p className="text-muted-foreground text-sm">
          {emptyLabel ?? t('common.noMatchingTransactions')}
        </p>
      ) : (
        children
      )}
    </section>
  )
}
