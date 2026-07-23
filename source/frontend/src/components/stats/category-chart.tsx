import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Bar,
  BarChart,
  Cell,
  Legend,
  matchByDataKey,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { cn } from '@/lib/utils'
import { formatMoney, formatPercent } from '@/lib/format'
import {
  aggregateTopN,
  sliceColor,
  type CategoryChartDatum,
  type CategorySlice,
  type ChartType,
} from '@/lib/statistics'
import type { TransactionCategory } from '@/lib/transaction'
import { AXIS_TICK, euroFormat, TOOLTIP_STYLE } from './chartTheme'
import { ArrowTick, DRILL_ARROW_WIDTH, ToggleTick, ValueBarShape } from './chart-parts'

// Beyond this many slices the pie collapses the tail into a single "Other"
// wedge so it stays legible on a phone.
const MAX_PIE_SLICES = 8

// Below this share a pie slice is too thin to hold its percentage legibly.
const MIN_PIE_LABEL_SHARE = 0.1

// Snappier than the recharts default (1500ms) so the pie doesn't crawl in.
const PIE_ANIMATION_MS = 350

// Pie-slice percentages use the foreground color (white in dark mode), matching
// the in-bar value labels.
const PIE_LABEL_FILL = 'var(--color-foreground)'

const RADIAN = Math.PI / 180

export interface CategoryChartProps {
  slices: CategorySlice[]
  chartType: ChartType
  hidden: ReadonlySet<string>
  onToggleHidden: (category: TransactionCategory | 'OTHER') => void
  onDrill?: (category: TransactionCategory) => void
}

/**
 * Tooltip showing the category, its amount and its share of the period total.
 * Custom (not the default Tooltip) so the value is always rendered in the accent
 * color — the default colors it with the series/slice color, which is
 * unreadable on the dark popover — and drops the "value :" prefix.
 */
function CategoryTooltip({
  active,
  payload,
  total,
}: {
  active?: boolean
  payload?: Array<{ payload: CategoryChartDatum }>
  total: number
}) {
  if (!active || !payload?.length) return null
  const datum = payload[0].payload
  if (!datum.value) return null
  const share = total > 0 ? datum.value / total : 0
  return (
    <div style={TOOLTIP_STYLE} className="px-2.5 py-1.5 text-center">
      <div className="text-muted-foreground text-xs">{datum.label}</div>
      <div className="text-foreground text-sm font-semibold">
        {formatMoney(datum.value)} · {formatPercent(share)}
      </div>
    </div>
  )
}

interface PieDatum extends CategoryChartDatum {
  color: string
}

function PieLegend({
  data,
  hidden,
  onToggle,
}: {
  data: PieDatum[]
  hidden: ReadonlySet<string>
  onToggle: (category: string) => void
}) {
  return (
    <ul className="text-foreground flex flex-wrap justify-center gap-x-3 gap-y-1 pt-2 text-xs">
      {data.map((datum) => {
        const isHidden = hidden.has(datum.category)
        return (
          <li key={datum.category}>
            <button
              type="button"
              aria-pressed={!isHidden}
              onClick={() => onToggle(datum.category)}
              className={cn(
                'flex cursor-pointer items-center gap-1.5 transition-opacity',
                isHidden && 'text-muted-foreground line-through opacity-50',
              )}
            >
              <span
                aria-hidden="true"
                className="inline-block size-2.5 rounded-[2px]"
                style={{ background: datum.color }}
              />
              {datum.label}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function renderPieLabel(props: {
  cx?: number
  cy?: number
  midAngle?: number
  innerRadius?: number
  outerRadius?: number
  percent?: number
}) {
  const { cx = 0, cy = 0, midAngle = 0, innerRadius = 0, outerRadius = 0, percent = 0 } = props
  if (percent < MIN_PIE_LABEL_SHARE) return null
  const radius = innerRadius + (outerRadius - innerRadius) * 0.6
  const x = cx + radius * Math.cos(-midAngle * RADIAN)
  const y = cy + radius * Math.sin(-midAngle * RADIAN)
  return (
    <text
      x={x}
      y={y}
      fill={PIE_LABEL_FILL}
      fontSize={11}
      fontWeight={600}
      textAnchor="middle"
      dominantBaseline="central"
    >
      {formatPercent(percent)}
    </text>
  )
}

export function CategoryChart({
  slices,
  chartType,
  hidden,
  onToggleHidden,
  onDrill,
}: CategoryChartProps) {
  const { t } = useTranslation()
  const toggle = (category: string) => onToggleHidden(category as TransactionCategory | 'OTHER')

  const data: CategoryChartDatum[] = useMemo(
    () =>
      slices.map((slice) => ({
        category: slice.category,
        label: t(`category.${slice.category}`),
        value: slice.total,
      })),
    [slices, t],
  )

  if (chartType === 'pie') {
    const pieData: PieDatum[] = aggregateTopN(data, MAX_PIE_SLICES, t('stats.other')).map(
      (datum, index) => ({ ...datum, color: sliceColor(datum.category, index) }),
    )
    const visible = pieData.filter((datum) => !hidden.has(datum.category))
    const total = visible.reduce((sum, datum) => sum + datum.value, 0)
    return (
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={visible}
              dataKey="value"
              nameKey="label"
              outerRadius="75%"
              stroke="none"
              labelLine={false}
              label={renderPieLabel}
              animationDuration={PIE_ANIMATION_MS}
            >
              {visible.map((datum) => (
                <Cell key={datum.category} fill={datum.color} />
              ))}
            </Pie>
            <Tooltip content={<CategoryTooltip total={total} />} />
            <Legend content={<PieLegend data={pieData} hidden={hidden} onToggle={toggle} />} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    )
  }

  const chartData = data.map((datum) =>
    hidden.has(datum.category) ? { ...datum, value: null } : datum,
  )
  const total = data
    .filter((datum) => !hidden.has(datum.category))
    .reduce((sum, datum) => sum + datum.value, 0)
  const height = Math.max(data.length * 30 + 16, 160)
  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} layout="vertical" margin={{ left: 0, right: onDrill ? 0 : 16 }}>
          <XAxis
            type="number"
            domain={[0, 'dataMax']}
            tick={AXIS_TICK}
            tickFormatter={euroFormat}
          />
          <YAxis
            type="category"
            dataKey="category"
            width={130}
            interval={0}
            tick={
              <ToggleTick
                labelOf={(category) => t(`category.${category}`)}
                hidden={hidden}
                onToggle={toggle}
                maxChars={18}
              />
            }
          />
          {onDrill ? (
            <YAxis
              yAxisId="drill"
              orientation="right"
              type="category"
              dataKey="category"
              interval={0}
              width={DRILL_ARROW_WIDTH}
              axisLine={false}
              tickLine={false}
              tickSize={0}
              tickMargin={0}
              tick={<ArrowTick onSelect={(category) => onDrill(category as TransactionCategory)} />}
            />
          ) : null}
          <Tooltip
            cursor={{ fill: 'var(--color-muted)' }}
            content={<CategoryTooltip total={total} />}
          />
          <Bar
            dataKey="value"
            radius={[0, 4, 4, 0]}
            animationMatchBy={matchByDataKey('category')}
            shape={
              <ValueBarShape
                labelHidden={(row) => hidden.has((row as CategoryChartDatum).category)}
              />
            }
          >
            {chartData.map((datum, index) => (
              <Cell key={datum.category} fill={sliceColor(datum.category, index)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
