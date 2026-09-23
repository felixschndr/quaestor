import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft } from 'lucide-react'
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'

import { cn } from '@/lib/utils'
import { formatMoney, formatPercent } from '@/lib/format'
import {
  aggregateTopN,
  sliceColor,
  type CategoryChartDatum,
  type CategorySlice,
  type ChartType,
} from '@/lib/statistics'
import { useCategoryCatalog, type CategoryCatalog } from '@/lib/categoryCatalog'
import {
  expandCategorySelection,
  isCategoryGroup,
  type CategoryGroup,
  type CategoryKey,
} from '@/lib/transaction'
import { Button } from '@/components/ui/button'
import { TOOLTIP_STYLE } from './chartTheme'
import { HorizontalDrillBarChart, type DrillBarRow } from './horizontal-drill-bar-chart'

// Beyond this many slices the pie collapses the tail into a single "Other"
// wedge so it stays legible on a phone.
const MAX_PIE_SLICES = 8

// Below this share a pie slice is too thin to hold its percentage legibly.
const MIN_PIE_LABEL_SHARE = 0.1

// Snappier than the recharts default (1500ms) so the pie doesn't crawl in.
const PIE_ANIMATION_MS = 350

const RADIAN = Math.PI / 180

export interface CategoryChartProps {
  slices: CategorySlice[]
  chartType: ChartType
  hidden: ReadonlySet<string>
  onToggleHidden: (key: CategoryKey | CategoryGroup | 'OTHER') => void
  onDrill?: (categories: CategoryKey[]) => void
}

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
      fill="var(--chart-label)"
      fontSize={11}
      fontWeight={600}
      textAnchor="middle"
      dominantBaseline="central"
    >
      {formatPercent(percent)}
    </text>
  )
}

type ChartKey = CategoryKey | CategoryGroup | 'OTHER'

function groupSlices(
  slices: CategorySlice[],
  groupOf: CategoryCatalog['groupOf'],
): { key: CategoryKey | CategoryGroup; total: number }[] {
  const totals = new Map<CategoryKey | CategoryGroup, number>()
  for (const slice of slices) {
    const key = groupOf(slice.category) ?? slice.category
    totals.set(key, (totals.get(key) ?? 0) + slice.total)
  }
  return [...totals].map(([key, total]) => ({ key, total: Math.round(total * 100) / 100 }))
}

export function CategoryChart({
  slices,
  chartType,
  hidden,
  onToggleHidden,
  onDrill,
}: CategoryChartProps) {
  const { t } = useTranslation()
  const catalog = useCategoryCatalog()
  const [openGroup, setOpenGroup] = useState<CategoryGroup | null>(null)
  const toggle = (key: string) => onToggleHidden(key as ChartKey)
  const colorOf = (key: string) => sliceColor(key, catalog.custom)
  const activeGroup =
    openGroup && slices.some((slice) => catalog.groupOf(slice.category) === openGroup)
      ? openGroup
      : null

  const data: CategoryChartDatum[] = useMemo(() => {
    const entries = activeGroup
      ? slices
          .filter((slice) => catalog.groupOf(slice.category) === activeGroup)
          .map((slice) => ({ key: slice.category, total: slice.total }))
      : groupSlices(slices, catalog.groupOf)
    return entries
      .map((entry) => ({
        category: entry.key,
        label: catalog.label(entry.key),
        value: entry.total,
      }))
      .sort((a, b) => b.value - a.value)
  }, [slices, activeGroup, catalog])

  const drill = (keys: string[]) => {
    if (keys.length === 1 && isCategoryGroup(keys[0])) {
      setOpenGroup(keys[0])
      return
    }
    onDrill?.(expandCategorySelection(keys, catalog.custom))
  }
  const canDrill = !activeGroup || Boolean(onDrill)

  const header = activeGroup ? (
    <div className="flex items-center gap-2 pb-2 text-sm">
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpenGroup(null)}>
        <ChevronLeft className="size-4" aria-hidden="true" />
        {t('common.allCategories')}
      </Button>
      <span className="text-muted-foreground" aria-hidden="true">
        /
      </span>
      <span className="font-medium">{t(`common.transactionLabel.${activeGroup}`)}</span>
    </div>
  ) : null

  if (chartType === 'pie') {
    const pieData: PieDatum[] = aggregateTopN(data, MAX_PIE_SLICES, t('stats.other')).map(
      (datum) => ({ ...datum, color: colorOf(datum.category) }),
    )
    const visible = pieData.filter((datum) => !hidden.has(datum.category))
    const total = visible.reduce((sum, datum) => sum + datum.value, 0)
    const shown = new Set(pieData.map((datum) => datum.category))
    const otherKeys = data
      .filter((datum) => !shown.has(datum.category))
      .map((datum) => datum.category)
    return (
      <div className="w-full">
        {header}
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
                className={cn(canDrill && 'cursor-pointer')}
                onClick={
                  canDrill
                    ? (_, index) => {
                        const datum = visible[index]
                        if (!datum) return
                        drill(datum.category === 'OTHER' ? otherKeys : [datum.category])
                      }
                    : undefined
                }
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
      </div>
    )
  }

  const rows: DrillBarRow[] = data.map((datum) => ({
    key: datum.category,
    label: datum.label,
    value: datum.value,
  }))
  const total = data
    .filter((datum) => !hidden.has(datum.category))
    .reduce((sum, datum) => sum + datum.value, 0)
  return (
    <div className="w-full">
      {header}
      <HorizontalDrillBarChart
        rows={rows}
        hidden={hidden}
        labelOf={catalog.label}
        colorOf={colorOf}
        maxChars={18}
        axisWidth={130}
        tooltip={<CategoryTooltip total={total} />}
        onToggleHidden={toggle}
        onDrill={canDrill ? (key) => drill([key]) : undefined}
      />
    </div>
  )
}
