import type { ReactElement } from 'react'
import {
  Bar,
  BarChart,
  Cell,
  matchByDataKey,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { AXIS_TICK, BAR_RADIUS_RIGHT, euroFormat } from './chartTheme'
import { ArrowTick, DRILL_ARROW_WIDTH, ToggleTick, ValueBarShape } from './chart-parts'

export interface DrillBarRow {
  key: string
  label: string
  value: number | null
}

export function HorizontalDrillBarChart({
  rows,
  hidden,
  labelOf,
  colorOf,
  maxChars,
  axisWidth,
  tooltip,
  onToggleHidden,
  onDrill,
}: {
  rows: DrillBarRow[]
  hidden: ReadonlySet<string>
  labelOf: (key: string) => string
  colorOf: (key: string, index: number) => string
  maxChars: number
  axisWidth: number
  tooltip: ReactElement
  onToggleHidden: (key: string) => void
  onDrill?: (key: string) => void
}) {
  const chartRows = rows.map((row) => (hidden.has(row.key) ? { ...row, value: null } : row))
  const height = Math.max(rows.length * 30 + 16, 160)

  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartRows} layout="vertical" margin={{ left: 0, right: onDrill ? 0 : 16 }}>
          <XAxis
            type="number"
            domain={[0, 'dataMax']}
            tick={AXIS_TICK}
            tickFormatter={euroFormat}
          />
          <YAxis
            type="category"
            dataKey="key"
            width={axisWidth}
            interval={0}
            tick={
              <ToggleTick
                labelOf={labelOf}
                hidden={hidden}
                onToggle={onToggleHidden}
                maxChars={maxChars}
              />
            }
          />
          {onDrill ? (
            <YAxis
              yAxisId="drill"
              orientation="right"
              type="category"
              dataKey="key"
              interval={0}
              width={DRILL_ARROW_WIDTH}
              axisLine={false}
              tickLine={false}
              tickSize={0}
              tickMargin={0}
              tick={<ArrowTick onSelect={onDrill} />}
            />
          ) : null}
          <Tooltip cursor={{ fill: 'var(--color-muted)' }} content={tooltip} />
          <Bar
            dataKey="value"
            radius={BAR_RADIUS_RIGHT}
            animationMatchBy={matchByDataKey('key')}
            shape={<ValueBarShape labelHidden={(row) => hidden.has((row as DrillBarRow).key)} />}
          >
            {chartRows.map((row, index) => (
              <Cell key={row.key} fill={colorOf(row.key, index)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
