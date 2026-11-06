import type { MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { ArrowDown, ArrowUp } from 'lucide-react'

import { HrefLink } from '@/components/href-link'
import { cn } from '@/lib/utils'
import { formatMoney, formatPercent } from '@/lib/format'
import type { CategoryTrendSlice, StatsDirection } from '@/lib/statistics'
import { useCategoryCatalog } from '@/lib/categoryCatalog'

const ON_PAR_THRESHOLD = 0.05

const WHOLE_PERCENT_THRESHOLD = 0.1

export interface CategoryTrendChartProps {
  slices: CategoryTrendSlice[]
  direction: StatsDirection
  drillHref?: (category: string) => string
  baselineHref?: (category: string) => string
}

const stopRowClick = (event: MouseEvent) => event.stopPropagation()

export function CategoryTrendChart({
  slices,
  direction,
  drillHref,
  baselineHref,
}: CategoryTrendChartProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const catalog = useCategoryCatalog()
  const cell = 'border-border/60 border-b py-2'

  return (
    <table className="w-full border-separate border-spacing-0 text-sm">
      <thead>
        <tr className="text-muted-foreground text-xs">
          <th className={cn(cell, 'w-full py-1.5 pr-2 pl-2 text-left font-medium')}>
            {t('common.category')}
          </th>
          <th className={cn(cell, 'py-1.5 pr-4 pl-2 text-right font-medium whitespace-nowrap')}>
            {t('stats.netWorth.average')}
          </th>
          <th className={cn(cell, 'py-1.5 pr-2 pl-2 text-right font-medium whitespace-nowrap')}>
            {t('common.current')}
          </th>
        </tr>
      </thead>
      <tbody>
        {slices
          .filter((slice) => Math.round(slice.current * 100) !== 0)
          .map((slice) => {
            const delta = slice.current - slice.baseline
            const ratio = slice.baseline > 0 ? delta / slice.baseline : null
            const onPar = slice.baseline > 0 && Math.abs(ratio ?? 0) < ON_PAR_THRESHOLD
            const unfavorable = direction === 'OUTGOING' ? delta > 0 : delta < 0
            const tone = unfavorable ? 'text-destructive' : 'text-success'
            const Arrow = delta > 0 ? ArrowUp : ArrowDown
            const href = drillHref?.(slice.category)
            const hover = href ? 'group-hover:bg-muted/40' : ''

            return (
              <tr
                key={slice.category}
                onClick={href ? () => void navigate({ href }) : undefined}
                className={cn(href && 'group cursor-pointer')}
              >
                <td className={cn(cell, hover, 'text-foreground rounded-l-md pr-2 pl-2')}>
                  {href ? (
                    <HrefLink href={href} onClick={stopRowClick}>
                      {catalog.label(slice.category)}
                    </HrefLink>
                  ) : (
                    catalog.label(slice.category)
                  )}
                </td>
                <td
                  className={cn(
                    cell,
                    hover,
                    'text-muted-foreground pr-4 pl-2 text-right tabular-nums whitespace-nowrap',
                  )}
                >
                  {baselineHref ? (
                    <HrefLink
                      href={baselineHref(slice.category)}
                      onClick={stopRowClick}
                      className="cursor-pointer hover:underline"
                    >
                      {formatMoney(slice.baseline)}
                    </HrefLink>
                  ) : (
                    formatMoney(slice.baseline)
                  )}
                </td>
                <td
                  className={cn(
                    cell,
                    hover,
                    'rounded-r-md pr-2 pl-2 text-right tabular-nums sm:whitespace-nowrap',
                  )}
                >
                  <span className="text-foreground font-medium whitespace-nowrap">
                    {formatMoney(slice.current)}
                  </span>{' '}
                  {onPar ? null : (
                    <span className={cn('whitespace-nowrap text-xs font-medium', tone)}>
                      (
                      {ratio === null ? (
                        t('stats.categoryTrend.new')
                      ) : (
                        <span className="inline-flex items-center gap-0.5 align-middle">
                          <Arrow className="size-3" aria-hidden="true" />
                          {formatPercent(
                            Math.abs(ratio),
                            Math.abs(ratio) > WHOLE_PERCENT_THRESHOLD,
                          )}
                        </span>
                      )}
                      )
                    </span>
                  )}
                </td>
              </tr>
            )
          })}
      </tbody>
    </table>
  )
}
