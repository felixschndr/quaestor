import { useCallback, useEffect, useRef, useState } from 'react'
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

import { cn } from '@/lib/utils'
import { formatDate, formatMoney } from '@/lib/format'
import { readPinnedDate, writePinnedDate } from '@/lib/netWorthPin'
import type { DailyNetWorth, NetWorthSummary } from '@/lib/statistics'
import { AXIS_TICK, euroAxisFormat } from './chartTheme'
import { AxisValueTick } from './chart-parts'
import { useDateFnsLocale } from '@/components/stats/chartTheme'

export interface NetWorthChartProps {
  data: DailyNetWorth[]
  summary: NetWorthSummary | null
  onOpenDay?: (date: string) => void
  onOpenRange?: (start: string, end: string) => void
}

interface ChartMouseState {
  activeTooltipIndex?: number | string | null
  activeLabel?: string | number | null
}

const Y_AXIS_WIDTH = 60
const RIGHT_MARGIN = 8

export function NetWorthChart({ data, summary, onOpenDay, onOpenRange }: NetWorthChartProps) {
  const { t } = useTranslation()
  const locale = useDateFnsLocale()

  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const [pinnedDate, setPinnedDate] = useState<string | null>(() => readPinnedDate())
  const pinnedIndex = pinnedDate != null ? data.findIndex((point) => point.date === pinnedDate) : -1
  const rawIndex = hoverIndex ?? (pinnedIndex >= 0 ? pinnedIndex : null) ?? data.length - 1
  const effectiveIndex = Math.min(Math.max(rawIndex, 0), data.length - 1)
  const active = data[effectiveIndex]
  const hasSelection = hoverIndex != null || pinnedIndex >= 0
  const pinnedPoint = pinnedIndex >= 0 ? data[pinnedIndex] : null

  const containerRef = useRef<HTMLDivElement>(null)
  const detachTouchGuard = useRef<(() => void) | undefined>(undefined)
  const setScrubRef = useCallback((node: HTMLDivElement | null) => {
    detachTouchGuard.current?.()
    detachTouchGuard.current = undefined
    if (!node) return
    const onTouchMove = (event: TouchEvent) => {
      if (event.cancelable) event.preventDefault()
    }
    node.addEventListener('touchmove', onTouchMove, { passive: false })
    detachTouchGuard.current = () => node.removeEventListener('touchmove', onTouchMove)
  }, [])

  const indexOf = (state: ChartMouseState): number | null => {
    const raw = state?.activeTooltipIndex
    const index = typeof raw === 'string' ? Number(raw) : raw
    if (typeof index === 'number' && Number.isFinite(index) && index >= 0 && index < data.length) {
      return index
    }
    return null
  }

  const [dragStart, setDragStart] = useState<string | null>(null)
  const [dragEnd, setDragEnd] = useState<string | null>(null)
  const draggedRef = useRef(false)
  const labelOf = (state: ChartMouseState): string | null =>
    typeof state?.activeLabel === 'string' ? state.activeLabel : null

  const handleDown = (state: ChartMouseState) => {
    if (!onOpenRange) return
    const label = labelOf(state)
    if (label != null) {
      setDragStart(label)
      setDragEnd(null)
      draggedRef.current = false
    }
  }
  const handleMove = (state: ChartMouseState) => {
    const index = indexOf(state)
    if (index != null) setHoverIndex(index)
    if (dragStart != null) {
      const label = labelOf(state)
      if (label != null && label !== dragStart) {
        setDragEnd(label)
        draggedRef.current = true
      }
    }
  }
  const handlePick = (state: ChartMouseState) => {
    if (draggedRef.current) {
      draggedRef.current = false
      return
    }
    const index = indexOf(state)
    if (index != null) {
      setPinnedDate(data[index].date)
      setHoverIndex(index)
      writePinnedDate(data[index].date)
    }
  }
  const handleLeave = () => {
    setHoverIndex(null)
  }

  const dragRange =
    dragStart != null && dragEnd != null
      ? (() => {
          const [start, end] = dragStart <= dragEnd ? [dragStart, dragEnd] : [dragEnd, dragStart]
          const startValue = data.find((point) => point.date === start)?.value
          const endValue = data.find((point) => point.date === end)?.value
          const diff = startValue != null && endValue != null ? endValue - startValue : null
          return { start, end, diff }
        })()
      : null

  useEffect(() => {
    if (dragStart == null) return
    const finish = () => {
      if (onOpenRange && dragEnd != null && dragStart !== dragEnd) {
        const [start, end] = dragStart <= dragEnd ? [dragStart, dragEnd] : [dragEnd, dragStart]
        onOpenRange(start, end)
      }
      setDragStart(null)
      setDragEnd(null)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDragStart(null)
        setDragEnd(null)
        draggedRef.current = true // swallow the trailing click so it doesn't pin a day
      }
    }
    const onMove = (event: MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      if (event.clientX <= rect.left + Y_AXIS_WIDTH) {
        setDragEnd(data[0].date)
        draggedRef.current = true
      } else if (event.clientX >= rect.right - RIGHT_MARGIN) {
        setDragEnd(data[data.length - 1].date)
        draggedRef.current = true
      }
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', finish)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', finish)
    }
  }, [dragStart, dragEnd, onOpenRange, data])

  useEffect(() => {
    if (!hasSelection) return
    const handleOutside = (event: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setHoverIndex(null)
        setPinnedDate(null)
        writePinnedDate(null)
      }
    }
    document.addEventListener('pointerdown', handleOutside)
    return () => document.removeEventListener('pointerdown', handleOutside)
  }, [hasSelection])

  if (data.length === 0) {
    return null
  }

  return (
    <div
      ref={containerRef}
      className="w-full select-none"
      style={{
        WebkitTouchCallout: 'none',
        WebkitUserSelect: 'none',
        userSelect: 'none',
      }}
    >
      <div className="text-foreground flex items-center justify-between gap-2 pb-2 text-sm tabular-nums">
        <span className="min-w-0 truncate">
          {dragRange ? (
            <>
              <span>
                {formatDate(dragRange.start)} – {formatDate(dragRange.end)}:{' '}
              </span>
              {dragRange.diff != null ? (
                <span
                  className={cn(
                    'font-semibold',
                    dragRange.diff < 0 ? 'text-destructive' : 'text-success',
                  )}
                >
                  {dragRange.diff > 0 ? '+' : ''}
                  {formatMoney(dragRange.diff)}
                </span>
              ) : null}
            </>
          ) : active ? (
            <>
              <span>{formatDate(active.date)}: </span>
              <span className="font-semibold">{formatMoney(active.value)}</span>
            </>
          ) : null}
        </span>
        {!dragRange && (pinnedPoint ? onOpenDay : onOpenRange) ? (
          <button
            type="button"
            onClick={() =>
              pinnedPoint
                ? onOpenDay?.(pinnedPoint.date)
                : onOpenRange?.(data[0].date, data[data.length - 1].date)
            }
            className="text-primary hover:text-primary/80 inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md text-xs font-medium transition-colors"
          >
            <span className="sm:hidden">{t('stats.netWorth.viewDayShort')}</span>
            <span className="hidden sm:inline">
              {t(pinnedPoint ? 'stats.netWorth.viewDay' : 'stats.netWorth.viewRange')}
            </span>
            <ChevronRight className="size-3.5" />
          </button>
        ) : null}
      </div>
      <div ref={setScrubRef} className="h-72 w-full" style={{ touchAction: 'none' }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ left: 0, right: RIGHT_MARGIN, top: 4, bottom: 0 }}
            onClick={handlePick}
            onMouseDown={handleDown}
            onMouseMove={handleMove}
            onMouseLeave={handleLeave}
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
              tick={<AxisValueTick format={euroAxisFormat} />}
              width={Y_AXIS_WIDTH}
              domain={[
                (dataMin: number) => dataMin - Math.abs(dataMin) * 0.02,
                (dataMax: number) => dataMax + Math.abs(dataMax) * 0.02,
              ]}
            />
            <Tooltip content={() => null} cursor={false} />
            {dragStart != null && dragEnd != null ? (
              <ReferenceArea
                x1={dragStart}
                x2={dragEnd}
                fill="var(--color-primary)"
                fillOpacity={0.12}
                stroke="var(--color-primary)"
                strokeOpacity={0.4}
                ifOverflow="visible"
              />
            ) : null}
            {hasSelection && active ? (
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
            {pinnedPoint && pinnedPoint.date !== active?.date ? (
              <ReferenceDot
                x={pinnedPoint.date}
                y={pinnedPoint.value}
                r={7}
                fill="var(--color-primary)"
                stroke="var(--color-background)"
                strokeWidth={2}
                ifOverflow="visible"
              />
            ) : null}
            {pinnedPoint && pinnedPoint.date !== active?.date ? (
              <ReferenceDot
                x={pinnedPoint.date}
                y={pinnedPoint.value}
                r={4}
                fill="var(--color-primary)"
                stroke="var(--color-background)"
                strokeWidth={2}
                ifOverflow="visible"
              />
            ) : null}
            {hasSelection && active ? (
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
          </LineChart>
        </ResponsiveContainer>
      </div>
      {summary ? (
        <dl className="text-foreground mt-2 grid grid-cols-3 gap-2 text-xs tabular-nums">
          {(
            [
              ['min', summary.minimum],
              ['average', summary.average],
              ['max', summary.maximum],
            ] as const
          ).map(([key, value]) => (
            <div key={key} className="flex flex-col items-center gap-0.5">
              <dt className="text-muted-foreground">{t(`stats.netWorth.${key}`)}</dt>
              <dd className="font-semibold">{formatMoney(value)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  )
}
