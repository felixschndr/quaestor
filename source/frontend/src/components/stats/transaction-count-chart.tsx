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

import { formatDate, formatMoney } from '@/lib/format'
import { useHorizontalScrubLock } from '@/lib/use-horizontal-scrub'
import {
  fillTransactionCountBuckets,
  type TransactionCountBucket,
  type TransactionCountMetric,
  type TransactionCountsGroupBy,
} from '@/lib/statistics'
import {
  AXIS_TICK,
  BAR_RADIUS_TOP,
  TOOLTIP_STYLE,
  euroAxisFormat,
  useDateFnsLocale,
  useMonthLabel,
} from './chartTheme'
import { AxisValueTick } from './chart-parts'

export interface TransactionCountChartProps {
  data: TransactionCountBucket[]
  groupBy: TransactionCountsGroupBy
  metric: TransactionCountMetric
  dateFrom?: string
  dateTo?: string
}

export function TransactionCountChart({
  data,
  groupBy,
  metric,
  dateFrom,
  dateTo,
}: TransactionCountChartProps) {
  const { t, i18n } = useTranslation()
  const scrubLockRef = useHorizontalScrubLock<HTMLDivElement>()
  const monthLabel = useMonthLabel()
  const locale = useDateFnsLocale()
  const dayFormat = new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short' })
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

  const isAmount = metric === 'amount'
  const valueLabel = isAmount
    ? t('stats.transactionCounts.metric.amount')
    : t('common.transactions')
  const formatValue = (value: number): string => (isAmount ? formatMoney(value) : String(value))

  const renderTooltip = ({ active, payload, label }: TooltipContentProps) => {
    if (!active || !payload?.length) return null
    const bucket = String(label)
    const count = (
      <span style={{ color: 'var(--color-primary)' }}>{formatValue(Number(payload[0].value))}</span>
    )
    if (groupBy === 'week') {
      return (
        <div style={{ ...TOOLTIP_STYLE, padding: '6px 10px' }}>
          <div>
            {weekLabel(bucket)} ({weekRange(bucket)})
          </div>
          <div>
            {valueLabel}: {count}
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

  const chartData = fillTransactionCountBuckets(data, groupBy, dateFrom, dateTo).map((bucket) => ({
    ...bucket,
    value: isAmount ? bucket.amount : bucket.count,
  }))

  return (
    <div ref={scrubLockRef} className="h-72 w-full touch-pan-y">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ left: 0, right: 0 }}>
          <CartesianGrid stroke="var(--color-border)" vertical={false} />
          <XAxis dataKey="bucket" tick={AXIS_TICK} tickFormatter={tickLabel} />
          <YAxis
            tick={isAmount ? <AxisValueTick format={euroAxisFormat} /> : AXIS_TICK}
            allowDecimals={false}
            width={isAmount ? 60 : 40}
          />
          <Tooltip cursor={{ fill: 'var(--color-muted)' }} content={renderTooltip} />
          <Bar
            dataKey="value"
            name={valueLabel}
            fill="var(--color-primary)"
            radius={BAR_RADIUS_TOP}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
