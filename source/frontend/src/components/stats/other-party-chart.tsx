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

import { formatMoney, formatIban } from '@/lib/format'
import { paletteColor, type OtherPartySlice } from '@/lib/statistics'
import { AXIS_TICK, euroFormat, TOOLTIP_STYLE } from './chartTheme'
import { ArrowTick, DRILL_ARROW_WIDTH, ToggleTick, ValueBarShape } from './chart-parts'

export interface OtherPartyChartProps {
  data: OtherPartySlice[]
  hidden: ReadonlySet<string>
  onToggleHidden: (otherParty: string) => void
  onDrill?: (otherParty: string) => void
}

// Other party names (esp. IBANs) can be long. Give the axis a generous width
// (and start it at the container's left edge) so names use the available room,
// clipping only the still-too-long ones; the full name stays in the tooltip.
const AXIS_LABEL_WIDTH = 190
const MAX_LABEL_CHARS = 30

interface OtherPartyRow extends OtherPartySlice {
  label: string
}

function OtherPartyTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: Array<{ payload: { label: string; total: number | null } }>
}) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload
  if (!row.total) return null
  return (
    <div style={TOOLTIP_STYLE} className="px-2.5 py-1.5 text-center">
      <div className="text-muted-foreground text-xs">{row.label}</div>
      <div className="text-foreground text-sm font-semibold">{formatMoney(row.total)}</div>
    </div>
  )
}

export function OtherPartyChart({ data, hidden, onToggleHidden, onDrill }: OtherPartyChartProps) {
  const rows: OtherPartyRow[] = data.map((slice) => ({
    ...slice,
    label: formatIban(slice.other_party),
  }))
  const labelByParty = new Map(rows.map((row) => [row.other_party, row.label]))
  const chartRows = rows.map((row) => (hidden.has(row.other_party) ? { ...row, total: null } : row))
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
            dataKey="other_party"
            width={AXIS_LABEL_WIDTH}
            interval={0}
            tick={
              <ToggleTick
                labelOf={(party) => labelByParty.get(party) ?? party}
                hidden={hidden}
                onToggle={onToggleHidden}
                maxChars={MAX_LABEL_CHARS}
              />
            }
          />
          {onDrill ? (
            <YAxis
              yAxisId="drill"
              orientation="right"
              type="category"
              dataKey="other_party"
              interval={0}
              width={DRILL_ARROW_WIDTH}
              axisLine={false}
              tickLine={false}
              tickSize={0}
              tickMargin={0}
              tick={<ArrowTick onSelect={onDrill} />}
            />
          ) : null}
          <Tooltip cursor={{ fill: 'var(--color-muted)' }} content={<OtherPartyTooltip />} />
          <Bar
            dataKey="total"
            radius={[0, 4, 4, 0]}
            animationMatchBy={matchByDataKey('other_party')}
            shape={
              <ValueBarShape
                labelHidden={(row) => hidden.has((row as OtherPartyRow).other_party)}
              />
            }
          >
            {chartRows.map((row, index) => (
              <Cell key={row.other_party} fill={paletteColor(index)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
