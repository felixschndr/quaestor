import { formatMoney, formatIban } from '@/lib/format'
import { paletteColor, type OtherPartySlice } from '@/lib/statistics'
import { TOOLTIP_STYLE } from './chartTheme'
import { HorizontalDrillBarChart, type DrillBarRow } from './horizontal-drill-bar-chart'

export interface OtherPartyChartProps {
  data: OtherPartySlice[]
  hidden: ReadonlySet<string>
  onToggleHidden: (otherParty: string) => void
  drillHref?: (otherParty: string) => string
}

// Other party names (esp. IBANs) can be long. Give the axis a generous width
// (and start it at the container's left edge) so names use the available room,
// clipping only the still-too-long ones; the full name stays in the tooltip.
const AXIS_LABEL_WIDTH = 190
const MAX_LABEL_CHARS = 30

function OtherPartyTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: Array<{ payload: { label: string; value: number | null } }>
}) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload
  if (!row.value) return null
  return (
    <div style={TOOLTIP_STYLE} className="px-2.5 py-1.5 text-center">
      <div className="text-muted-foreground text-xs">{row.label}</div>
      <div className="text-foreground text-sm font-semibold">{formatMoney(row.value)}</div>
    </div>
  )
}

export function OtherPartyChart({ data, hidden, onToggleHidden, drillHref }: OtherPartyChartProps) {
  const rows: DrillBarRow[] = data.map((slice) => ({
    key: slice.other_party,
    label: formatIban(slice.other_party),
    value: slice.total,
  }))
  const labelByParty = new Map(rows.map((row) => [row.key, row.label]))

  return (
    <HorizontalDrillBarChart
      rows={rows}
      hidden={hidden}
      labelOf={(party) => labelByParty.get(party) ?? party}
      colorOf={(_key, index) => paletteColor(index)}
      maxChars={MAX_LABEL_CHARS}
      axisWidth={AXIS_LABEL_WIDTH}
      tooltip={<OtherPartyTooltip />}
      onToggleHidden={onToggleHidden}
      drillHref={drillHref}
    />
  )
}
