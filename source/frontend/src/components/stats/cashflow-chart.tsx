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
import { useHorizontalScrubLock } from '@/lib/use-horizontal-scrub'
import {
  AXIS_TICK,
  euroAxisFormat,
  euroFormat,
  LEGEND_STYLE,
  TOOLTIP_LABEL_STYLE,
  TOOLTIP_STYLE,
  useMonthLabel,
} from './chartTheme'
import { AxisValueTick } from './chart-parts'

export interface CashflowChartProps {
  data: MonthlyCashflow[]
}

export function CashflowChart({ data }: CashflowChartProps) {
  const { t } = useTranslation()
  const scrubLockRef = useHorizontalScrubLock<HTMLDivElement>()
  const monthLabel = useMonthLabel()

  return (
    <div ref={scrubLockRef} className="h-72 w-full touch-pan-y">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ left: 0, right: 0 }}>
          <CartesianGrid stroke="var(--color-border)" vertical={false} />
          <XAxis dataKey="month" tick={AXIS_TICK} tickFormatter={monthLabel} />
          <YAxis tick={<AxisValueTick format={euroAxisFormat} />} width={60} />
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
            name={t('stats.direction.OUTGOING')}
            fill="var(--color-destructive)"
            radius={[4, 4, 0, 0]}
          />
          <Bar
            dataKey="income"
            name={t('stats.direction.INCOMING')}
            fill="var(--color-success)"
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
