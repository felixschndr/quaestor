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

import { cn } from '@/lib/utils'
import type { MonthlyCashflow } from '@/lib/statistics'
import { useHorizontalScrubLock } from '@/lib/use-horizontal-scrub'
import {
  AXIS_TICK,
  BAR_RADIUS_TOP,
  euroAxisFormat,
  euroFormat,
  LEGEND_STYLE,
  TOOLTIP_STYLE,
  useMonthLabel,
} from './chartTheme'
import { AxisValueTick } from './chart-parts'

export interface CashflowChartProps {
  data: MonthlyCashflow[]
  onSelectMonth?: (month: string, direction: 'INCOMING' | 'OUTGOING') => void
}

function CashflowTooltip({
  active,
  payload,
  label,
  monthLabel,
}: {
  active?: boolean
  payload?: Array<{ dataKey?: string | number; value?: number }>
  label?: string
  monthLabel: (month: string) => string
}) {
  const { t } = useTranslation()
  if (!active || !payload?.length) return null
  const income = payload.find((entry) => entry.dataKey === 'income')?.value ?? 0
  const expenses = payload.find((entry) => entry.dataKey === 'expenses')?.value ?? 0
  const balance = income - expenses
  return (
    <div style={TOOLTIP_STYLE} className="min-w-40 px-2.5 py-1.5">
      <div className="text-muted-foreground pb-1 text-xs">{monthLabel(String(label))}</div>
      <div className="flex justify-between gap-4 text-xs">
        <span style={{ color: 'var(--color-success)' }}>{t('common.income')}</span>
        <span className="tabular-nums">{euroFormat(income)}</span>
      </div>
      <div className="flex justify-between gap-4 text-xs">
        <span style={{ color: 'var(--color-destructive)' }}>{t('common.expenses')}</span>
        <span className="tabular-nums">{euroFormat(expenses)}</span>
      </div>
      <div className="border-border mt-1 flex justify-between gap-4 border-t pt-1 text-xs font-semibold">
        <span>{t('common.balance')}</span>
        <span className={cn('tabular-nums', balance < 0 && 'text-destructive')}>
          {euroFormat(balance)}
        </span>
      </div>
    </div>
  )
}

export function CashflowChart({ data, onSelectMonth }: CashflowChartProps) {
  const { t } = useTranslation()
  const scrubLockRef = useHorizontalScrubLock<HTMLDivElement>()
  const monthLabel = useMonthLabel()

  const drill = (index: number, direction: 'INCOMING' | 'OUTGOING') => {
    const month = data[index]?.month
    if (month) onSelectMonth?.(month, direction)
  }
  const clickable = Boolean(onSelectMonth)

  return (
    <div ref={scrubLockRef} className="h-72 w-full touch-pan-y">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ left: 0, right: 0 }}>
          <CartesianGrid stroke="var(--color-border)" vertical={false} />
          <XAxis dataKey="month" tick={AXIS_TICK} tickFormatter={monthLabel} />
          <YAxis tick={<AxisValueTick format={euroAxisFormat} />} width={60} />
          <Tooltip
            cursor={{ fill: 'var(--color-muted)' }}
            content={<CashflowTooltip monthLabel={monthLabel} />}
          />
          <Legend wrapperStyle={LEGEND_STYLE} />
          {/* Expenses first so they render to the LEFT of income, matching the
              legend order beneath the chart. */}
          <Bar
            dataKey="expenses"
            name={t('common.expenses')}
            fill="var(--color-destructive)"
            radius={BAR_RADIUS_TOP}
            className={cn(clickable && 'cursor-pointer')}
            onClick={clickable ? (_, index) => drill(index, 'OUTGOING') : undefined}
          />
          <Bar
            dataKey="income"
            name={t('common.income')}
            fill="var(--color-success)"
            radius={BAR_RADIUS_TOP}
            className={cn(clickable && 'cursor-pointer')}
            onClick={clickable ? (_, index) => drill(index, 'INCOMING') : undefined}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
