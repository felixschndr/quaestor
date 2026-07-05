import { format } from 'date-fns'
import { useTranslation } from 'react-i18next'
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import type { MonthlyNetSavings } from '@/lib/statistics'
import {
  AXIS_TICK,
  euroAxisFormat,
  euroFormat,
  LEGEND_STYLE,
  TOOLTIP_LABEL_STYLE,
  TOOLTIP_STYLE,
  useMonthLabel,
} from './chartTheme'

export interface NetSavingsChartProps {
  data: MonthlyNetSavings[]
}

/** Surplus (income − expenses) per month as bars, with the savings rate as a line on a second axis. */
export function NetSavingsChart({ data }: NetSavingsChartProps) {
  const { t } = useTranslation()
  const monthLabel = useMonthLabel()
  const netLabel = t('stats.netSavings.net')
  const rateLabel = t('stats.netSavings.savingsRate')

  // Drop the savings-rate point for the current (incomplete) month: salary
  // usually lands at month-end, so mid-month the rate is hugely negative and
  // would blow out the percent axis. The surplus bar still shows.
  const currentMonth = format(new Date(), 'yyyy-MM')
  const chartData = data.map((entry) =>
    entry.month === currentMonth ? { ...entry, savings_rate: null } : entry,
  )

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData} margin={{ left: 8, right: 8 }}>
          <CartesianGrid stroke="var(--color-border)" vertical={false} />
          <XAxis dataKey="month" tick={AXIS_TICK} tickFormatter={monthLabel} />
          <YAxis
            yAxisId="net"
            tick={AXIS_TICK}
            tickFormatter={euroAxisFormat}
            width={64}
            // Only extend below zero as far as the data needs (with a little
            // headroom) — recharts' default rounds to a "nice" bound that leaves
            // a big empty gap under a small negative bar.
            domain={[(dataMin: number) => (dataMin < 0 ? dataMin * 1.1 : 0), 'auto']}
          />
          <YAxis
            yAxisId="rate"
            orientation="right"
            tick={AXIS_TICK}
            tickFormatter={(value) => `${Number(value)}%`}
            width={44}
          />
          <Tooltip
            cursor={{ fill: 'var(--color-muted)' }}
            contentStyle={TOOLTIP_STYLE}
            labelStyle={TOOLTIP_LABEL_STYLE}
            labelFormatter={(label) => monthLabel(String(label))}
            formatter={(value, name) =>
              name === rateLabel ? `${Number(value)}%` : euroFormat(value)
            }
          />
          <Legend wrapperStyle={LEGEND_STYLE} />
          <ReferenceLine yAxisId="net" y={0} stroke="var(--color-muted-foreground)" />
          <Bar
            yAxisId="net"
            dataKey="net"
            name={netLabel}
            fill="var(--color-primary)"
            radius={[4, 4, 0, 0]}
          />
          <Line
            yAxisId="rate"
            type="monotone"
            dataKey="savings_rate"
            name={rateLabel}
            stroke="var(--color-success)"
            strokeWidth={2}
            dot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
