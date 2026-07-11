import { addDays, getISOWeek, type Day } from 'date-fns'
import { useTranslation } from 'react-i18next'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts'

import { formatDate } from '@/lib/format'
import { useHorizontalScrubLock } from '@/lib/use-horizontal-scrub'
import {
  fillTransactionCountBuckets,
  type TransactionCountBucket,
  type TransactionCountsGroupBy,
} from '@/lib/statistics'
import { AXIS_TICK, TOOLTIP_STYLE, useDateFnsLocale, useMonthLabel } from './chartTheme'

export interface TransactionCountChartProps {
  data: TransactionCountBucket[]
  groupBy: TransactionCountsGroupBy
  dateFrom?: string
  dateTo?: string
}

export function TransactionCountChart({
  data,
  groupBy,
  dateFrom,
  dateTo,
}: TransactionCountChartProps) {
  const { t, i18n } = useTranslation()
  const scrubLockRef = useHorizontalScrubLock<HTMLDivElement>()
  const monthLabel = useMonthLabel()
  const locale = useDateFnsLocale()
  const dayFormat = new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short' })
  // A weekday bucket is a %w day number ('0' = Sunday … '6' = Saturday) — the
  // same indexing date-fns' localize.day uses. Habitual form: "Samstags" /
  // "Saturdays" — appending "s" works for both supported languages (de, en).
  const weekdayLabel = (bucket: string): string =>
    `${locale.localize.day(Number(bucket) as Day, { width: 'wide' })}s`

  const weekRangeFormat = new Intl.DateTimeFormat(i18n.language, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  const weekLabel = (bucket: string): string =>
    t('stats.transactionCounts.weekLabel', { week: getISOWeek(new Date(bucket)) })
  // Week buckets are keyed by their Monday; the week runs through the Sunday.
  const weekRange = (bucket: string): string => {
    const monday = new Date(bucket)
    return weekRangeFormat.formatRange(monday, addDays(monday, 6))
  }

  const tickLabel = (bucket: string): string => {
    if (groupBy === 'month') return monthLabel(bucket)
    if (groupBy === 'week') return weekLabel(bucket)
    if (groupBy === 'weekday') return weekdayLabel(bucket)
    return dayFormat.format(new Date(bucket))
  }

  const tooltipLabel = (bucket: string): string => {
    if (groupBy === 'month') return monthLabel(bucket)
    if (groupBy === 'weekday') return weekdayLabel(bucket)
    return formatDate(bucket)
  }

  const renderTooltip = ({ active, payload, label }: TooltipContentProps) => {
    if (!active || !payload?.length) return null
    const bucket = String(label)
    const count = <span style={{ color: 'var(--color-primary)' }}>{payload[0].value}</span>
    if (groupBy === 'week') {
      return (
        <div style={{ ...TOOLTIP_STYLE, padding: '6px 10px' }}>
          <div>
            {weekLabel(bucket)} ({weekRange(bucket)})
          </div>
          <div>
            {t('stats.transactionCounts.count')}: {count}
          </div>
        </div>
      )
    }
    return (
      <div style={{ ...TOOLTIP_STYLE, padding: '6px 10px' }}>
        <span>{tooltipLabel(bucket)}: </span>
        {count}
      </div>
    )
  }

  const chartData = fillTransactionCountBuckets(data, groupBy, dateFrom, dateTo)

  return (
    <div ref={scrubLockRef} className="h-72 w-full touch-pan-y">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ left: 0, right: 0 }}>
          <CartesianGrid stroke="var(--color-border)" vertical={false} />
          <XAxis dataKey="bucket" tick={AXIS_TICK} tickFormatter={tickLabel} />
          <YAxis tick={AXIS_TICK} allowDecimals={false} width={40} />
          <Tooltip cursor={{ fill: 'var(--color-muted)' }} content={renderTooltip} />
          <Bar
            dataKey="count"
            name={t('stats.transactionCounts.count')}
            fill="var(--color-primary)"
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
