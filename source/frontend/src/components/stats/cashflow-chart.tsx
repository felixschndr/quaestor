import { useTranslation } from 'react-i18next'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import type { MonthlyCashflow } from '@/lib/statistics'
import {
  AXIS_TICK,
  euroAxisFormat,
  euroFormat,
  LEGEND_STYLE,
  TOOLTIP_LABEL_STYLE,
  TOOLTIP_STYLE,
  useMonthLabel,
} from './chartTheme'

export interface CashflowChartProps {
  data: MonthlyCashflow[]
}

/** Grouped bars: income vs. expenses per month — shows whether a month was net positive. */
export function CashflowChart({ data }: CashflowChartProps) {
  const { t } = useTranslation()
  const monthLabel = useMonthLabel()

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ left: 8, right: 8 }}>
          <CartesianGrid stroke="var(--color-border)" vertical={false} />
          <XAxis dataKey="month" tick={AXIS_TICK} tickFormatter={monthLabel} />
          <YAxis tick={AXIS_TICK} tickFormatter={euroAxisFormat} width={64} />
          <Tooltip
            cursor={{ fill: 'var(--color-muted)' }}
            contentStyle={TOOLTIP_STYLE}
            labelStyle={TOOLTIP_LABEL_STYLE}
            labelFormatter={(label) => monthLabel(String(label))}
            formatter={euroFormat}
          />
          <Legend wrapperStyle={LEGEND_STYLE} />
          {/* Expenses first so they render to the LEFT of income, matching the
              legend order beneath the chart. */}
          <Bar
            dataKey="expenses"
            name={t('stats.cashflow.expenses')}
            fill="var(--color-destructive)"
            radius={[4, 4, 0, 0]}
          />
          <Bar
            dataKey="income"
            name={t('stats.cashflow.income')}
            fill="var(--color-success)"
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
