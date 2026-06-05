import { useState } from 'react'
import { de, enUS, type Locale } from 'date-fns/locale'
import { format, parseISO } from 'date-fns'
import { useTranslation } from 'react-i18next'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
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
  // Minimum / average / maximum of the series, computed server-side.
  summary: NetWorthSummary | null
}

const LOCALES: Record<string, Locale> = { en: enUS, de }

// Recharts' onMouseMove/onTouchMove handlers receive a state object whose
// `activeTooltipIndex` is `number | string | null | undefined` — for cartesian
// charts it's usually a numeric string (e.g. "3"). We accept both shapes.
interface ChartMouseState {
  activeTooltipIndex?: number | string | null
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
export function NetWorthChart({ data, summary }: NetWorthChartProps) {
  const { t, i18n } = useTranslation()
  const locale = LOCALES[i18n.language] ?? enUS

  // Active index drives the headline value + cursor dot. Defaults to the last
  // point so opening the chart shows "today" without requiring interaction.
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const effectiveIndex = activeIndex ?? data.length - 1
  const active = data[effectiveIndex]

  const handleMove = (state: ChartMouseState) => {
    const raw = state?.activeTooltipIndex
    const index = typeof raw === 'string' ? Number(raw) : raw
    if (typeof index === 'number' && Number.isFinite(index) && index >= 0 && index < data.length) {
      setActiveIndex(index)
    }
  }
  const handleLeave = () => setActiveIndex(null)

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
      <div className="text-foreground px-1 pb-2 text-sm tabular-nums">
        {active ? (
          <>
            <span>{formatDate(active.date)}: </span>
            <span className="font-semibold">{formatEuro(active.value)}</span>
          </>
        ) : null}
      </div>
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ left: 8, right: 8, top: 4, bottom: 0 }}
            onClick={handleMove}
            onMouseMove={handleMove}
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
            {/* No visible tooltip — the headline above the chart carries the
                active value. The Tooltip stays mounted so recharts emits the
                activeTooltipIndex on mouse/touch move. */}
            <Tooltip
              content={() => null}
              cursor={{ stroke: 'var(--color-muted-foreground)', strokeDasharray: '3 3' }}
            />
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
                r={5}
                fill="var(--color-primary)"
                stroke="var(--color-background)"
                strokeWidth={2}
                ifOverflow="visible"
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
