import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

export interface ChartCardProps {
  title: string
  isLoading: boolean
  isError: boolean
  isEmpty: boolean
  /** Optional controls rendered in the card header (e.g. chart-type toggle). */
  action?: ReactNode
  children: ReactNode
}

/**
 * Section wrapper for a single chart: titled card with shared loading / error /
 * empty states (mirroring the search page's result-state handling) so each
 * chart component only deals with the happy path.
 */
export function ChartCard({
  title,
  isLoading,
  isError,
  isEmpty,
  action,
  children,
}: ChartCardProps) {
  const { t } = useTranslation()

  return (
    <section className="border-border bg-card flex flex-col gap-3 rounded-lg border p-4">
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-primary text-sm font-semibold">{title}</h2>
        {action}
      </header>
      {isLoading ? (
        <p className="text-muted-foreground text-sm">{t('stats.loading')}</p>
      ) : isError ? (
        <p className="text-destructive text-sm">{t('stats.error')}</p>
      ) : isEmpty ? (
        <p className="text-muted-foreground text-sm">{t('stats.empty')}</p>
      ) : (
        children
      )}
    </section>
  )
}
