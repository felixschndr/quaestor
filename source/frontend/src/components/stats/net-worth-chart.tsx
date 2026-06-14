import { useState } from 'react'
import { de, enUS, type Locale } from 'date-fns/locale'
import { format, parseISO } from 'date-fns'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { formatDate, formatEuro } from '@/lib/format'
import type { DailyNetWorth, NetWorthSummary } from '@/lib/statistics'
import { AXIS_TICK, euroFormat } from './chartTheme'

export interface NetWorthChartProps {
  data: DailyNetWorth[]
  summary: NetWorthSummary | null
  onSelectRange?: (from: string, to: string) => void
  onOpenDay?: (date: string) => void
}

const LOCALES: Record<string, Locale> = { en: enUS, de }

// Recharts' onMouseMove/onTouchMove handlers receive a state object whose
// `activeTooltipIndex` is `number | string | null | undefined` — for cartesian
// charts it's usually a numeric string (e.g. "3"). We accept both shapes.
interface ChartMouseState {
  activeTooltipIndex?: number | string | null
  activeLabel?: string | number | null
}

/**
 * Net worth as a line over time. On touch the user can tap and drag horizontally
 * to scrub through history (à la Trade Republic): the highlighted value above
 * the chart updates live and the cursor follows the finger.
 *
 * The container suppresses long-press selection so dragging never triggers the
 * browser context menu or text selection. `touch-action: pan-y` keeps the page
 * vertically scrollable while reserving horizontal touches for the chart.
 */
export function NetWorthChart({ data, summary, onSelectRange, onOpenDay }: NetWorthChartProps) {
  const { t, i18n } = useTranslation()
  const locale = LOCALES[i18n.language] ?? enUS

  // Two layers drive the headline value + cursor dot: a transient `hoverIndex`
  // that follows the mouse, and a `pinnedIndex` committed on click/touch that
  // survives mouse-leave — so a clicked day stays highlighted (and reachable by
  // the "view day" button) on desktop, the same way scrubbing sticks on touch.
  // Falls back to the last point so the chart opens showing "today".
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const [pinnedIndex, setPinnedIndex] = useState<number | null>(null)
  const rawIndex = hoverIndex ?? pinnedIndex ?? data.length - 1
  const effectiveIndex = Math.min(Math.max(rawIndex, 0), data.length - 1)
  const active = data[effectiveIndex]

  const [selectStart, setSelectStart] = useState<string | null>(null)
  const [selectEnd, setSelectEnd] = useState<string | null>(null)

  const labelOf = (state: ChartMouseState): string | null =>
    typeof state?.activeLabel === 'string' ? state.activeLabel : null

  const indexOf = (state: ChartMouseState): number | null => {
    const raw = state?.activeTooltipIndex
    const index = typeof raw === 'string' ? Number(raw) : raw
    if (typeof index === 'number' && Number.isFinite(index) && index >= 0 && index < data.length) {
      return index
    }
    return null
  }

  const handleMove = (state: ChartMouseState) => {
    const index = indexOf(state)
    if (index != null) setHoverIndex(index)
    if (selectStart != null) {
      const label = labelOf(state)
      if (label != null) setSelectEnd(label)
    }
  }
  // Click (or tap) pins the day so it persists once the cursor leaves the chart.
  const handlePick = (state: ChartMouseState) => {
    const index = indexOf(state)
    if (index != null) {
      setPinnedIndex(index)
      setHoverIndex(index)
    }
  }
  const handleDown = (state: ChartMouseState) => {
    if (!onSelectRange) return
    const label = labelOf(state)
    if (label != null) {
      setSelectStart(label)
      setSelectEnd(label)
    }
  }
  const handleUp = () => {
    if (onSelectRange && selectStart != null && selectEnd != null && selectStart !== selectEnd) {
      const [from, to] =
        selectStart <= selectEnd ? [selectStart, selectEnd] : [selectEnd, selectStart]
      onSelectRange(from, to)
    }
    setSelectStart(null)
    setSelectEnd(null)
  }
  const handleLeave = () => {
    setHoverIndex(null)
    setSelectStart(null)
    setSelectEnd(null)
  }

  if (data.length === 0) {
    return null
  }

  return (
    <div
      className="w-full select-none"
      style={{
        // Keep page-scroll responsive (vertical drags pan the page) while
        // claiming horizontal touch for the chart. WebkitTouchCallout disables
        // the iOS long-press preview/context menu over the chart.
        touchAction: 'pan-y',
        WebkitTouchCallout: 'none',
        WebkitUserSelect: 'none',
        userSelect: 'none',
      }}
    >
      <div className="text-foreground flex items-center justify-between gap-2 px-1 pb-2 text-sm tabular-nums">
        <span className="min-w-0 truncate">
          {active ? (
            <>
              <span>{formatDate(active.date)}: </span>
              <span className="font-semibold">{formatEuro(active.value)}</span>
            </>
          ) : null}
        </span>
        {onOpenDay && active ? (
          <button
            type="button"
            onClick={() => onOpenDay(active.date)}
            className="text-primary hover:text-primary/80 inline-flex shrink-0 items-center gap-1 rounded-md text-xs font-medium transition-colors"
          >
            <span className="sm:hidden">{t('stats.netWorth.viewDayShort')}</span>
            <span className="hidden sm:inline">{t('stats.netWorth.viewDay')}</span>
            <ChevronRight className="size-3.5" />
          </button>
        ) : null}
      </div>
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ left: 8, right: 8, top: 4, bottom: 0 }}
            onClick={handlePick}
            onMouseDown={handleDown}
            onMouseMove={handleMove}
            onMouseUp={handleUp}
            onMouseLeave={handleLeave}
            // onTouchStart fires on a tap without movement; onTouchMove handles
            // the scrub. We deliberately do not reset on touchend so the picked
            // value stays on screen until the next tap (TR-style).
            onTouchStart={handleMove}
            onTouchMove={handleMove}
          >
            <CartesianGrid stroke="var(--color-border)" vertical={false} />
            <XAxis
              dataKey="date"
              tick={AXIS_TICK}
              tickFormatter={(value: string) => format(parseISO(value), 'd. MMM', { locale })}
              minTickGap={32}
            />
            <YAxis
              tick={AXIS_TICK}
              tickFormatter={euroFormat}
              width={64}
              // Tight to the data so subtle movements remain visible; recharts'
              // default 'nice' bound otherwise flattens lines that move only a
              // few percent across the range.
              domain={[
                (dataMin: number) => dataMin - Math.abs(dataMin) * 0.02,
                (dataMax: number) => dataMax + Math.abs(dataMax) * 0.02,
              ]}
            />
            <Tooltip content={() => null} cursor={false} />
            {active ? (
              <ReferenceLine
                x={active.date}
                stroke="var(--color-muted-foreground)"
                strokeDasharray="3 3"
                ifOverflow="visible"
              />
            ) : null}
            <Line
              type="monotone"
              dataKey="value"
              name={t('stats.netWorth.value')}
              stroke="var(--color-primary)"
              strokeWidth={2}
              dot={false}
              activeDot={{
                r: 4,
                fill: 'var(--color-primary)',
                stroke: 'var(--color-background)',
                strokeWidth: 2,
              }}
              isAnimationActive={false}
            />
            {active ? (
              <ReferenceDot
                x={active.date}
                y={active.value}
                r={7}
                fill="var(--color-primary)"
                stroke="var(--color-background)"
                strokeWidth={2}
                ifOverflow="visible"
              />
            ) : null}
            {selectStart != null && selectEnd != null && selectStart !== selectEnd ? (
              <ReferenceArea
                x1={selectStart}
                x2={selectEnd}
                fill="var(--color-primary)"
                fillOpacity={0.12}
                stroke="var(--color-primary)"
                strokeOpacity={0.3}
              />
            ) : null}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {summary ? (
        <dl className="text-foreground mt-2 grid grid-cols-3 gap-2 px-1 text-xs tabular-nums">
          {(
            [
              ['min', summary.minimum],
              ['average', summary.average],
              ['max', summary.maximum],
            ] as const
          ).map(([key, value]) => (
            <div key={key} className="flex flex-col items-center gap-0.5">
              <dt className="text-muted-foreground">{t(`stats.netWorth.${key}`)}</dt>
              <dd className="font-semibold">{formatEuro(value)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  )
}
