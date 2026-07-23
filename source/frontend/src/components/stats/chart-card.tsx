import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

export interface ChartCardProps {
  title: string
  icon?: ReactNode
  isLoading: boolean
  isError: boolean
  isEmpty: boolean
  emptyLabel?: string
  action?: ReactNode
  children: ReactNode
}

export function ChartCard({
  title,
  icon,
  isLoading,
  isError,
  isEmpty,
  emptyLabel,
  action,
  children,
}: ChartCardProps) {
  const { t } = useTranslation()

  return (
    <section className="border-border bg-card flex flex-col gap-3 rounded-lg border p-4">
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-primary inline-flex items-center gap-2 text-sm font-semibold">
          {icon}
          {title}
        </h2>
        {action}
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
