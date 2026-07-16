import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { format, parseISO } from 'date-fns'
import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
  usePlotArea,
  useXAxisScale,
} from 'recharts'

import { formatEuro } from '@/lib/format'
import { AXIS_TICK } from '@/components/stats/chartTheme'
import type { ContractMemberRead } from '@/lib/contract'
import { useDateFnsLocale } from '@/components/stats/chartTheme'

export interface ContractTimelineProps {
  members: ContractMemberRead[]
  median: number | null
  expectedNextDate: string | null
}

interface TimelinePoint {
  key: string
  accountId: number | null
  date: string
  amount: number
  mag: number
  isOutlier: boolean
  isGhost: boolean
}

function barColor(point: TimelinePoint): string {
  return point.isOutlier ? 'var(--color-warning)' : 'var(--color-success)'
}

const CHAR_WIDTH = 6.5
// Above this tilt the label is snapped straight to vertical (90°).
const SNAP_TO_VERTICAL_ANGLE = 60
// Glyphs sit above the baseline; half their height offsets the rotated text
// sideways, so it's added back when centring (most visible at 90°).
const GLYPH_HALF_HEIGHT = 3.5

interface AmountLabelProps {
  points: TimelinePoint[]
  x?: number
  y?: number
  width?: number
  index?: number
}

function labelFill(point: TimelinePoint): string {
  if (point.isGhost) return 'var(--color-primary)'
  return point.isOutlier ? 'var(--color-warning)' : 'var(--color-foreground)'
}

function AmountLabel({ points, x = 0, y = 0, width = 0, index }: AmountLabelProps) {
  if (index === undefined) return null

  const point = points[index]
  if (!point) return null

  const text = formatEuro(point.mag)
  const fill = labelFill(point)
  const textWidth = text.length * CHAR_WIDTH

  if (textWidth <= width) {
    const cx = x + width / 2
    return (
      <text x={cx} y={y - 6} textAnchor="middle" fontSize={11} fontWeight={500} fill={fill}>
        {text}
      </text>
    )
  }

  const naturalAngle = Math.round((Math.acos(Math.min(1, width / textWidth)) * 180) / Math.PI)
  const angle = naturalAngle > SNAP_TO_VERTICAL_ANGLE ? 90 : naturalAngle
  const radians = (angle * Math.PI) / 180
  const anchorX =
    x + width / 2 - (Math.cos(radians) * textWidth) / 2 + GLYPH_HALF_HEIGHT * Math.sin(radians)
  const ay = y - 4
  return (
    <text
      x={anchorX}
      y={ay}
      transform={`rotate(${-angle} ${anchorX} ${ay})`}
      textAnchor="start"
      fontSize={11}
      fontWeight={500}
      fill={fill}
    >
      {text}
    </text>
  )
}

interface YearGroup {
  year: number
  startKey: string
  endKey: string
}

function YearBand({ groups }: { groups: YearGroup[] }) {
  const scale = useXAxisScale()
  const plotArea = usePlotArea()
  if (!scale || !plotArea) return null

  const yLine = plotArea.y + plotArea.height + 24
  const yText = yLine + 15
  return (
    <g>
      {groups.map((group) => {
        const left = scale(group.startKey, { position: 'start' })
        const right = scale(group.endKey, { position: 'end' })
        if (left === undefined || right === undefined) return null
        return (
          <g key={group.year}>
            <foreignObject x={left + 3} y={yLine} width={Math.max(0, right - left - 6)} height={1}>
              <span className="bg-foreground/20 block h-px w-full" />
            </foreignObject>
            <text
              x={(left + right) / 2}
              y={yText}
              textAnchor="middle"
              fontSize={11}
              fill="var(--color-muted-foreground)"
            >
              {group.year}
            </text>
          </g>
        )
      })}
    </g>
  )
}

interface MedianLabelProps {
  value: string
  viewBox?: { x?: number; y?: number; width?: number }
}

function MedianLabel({ value, viewBox }: MedianLabelProps) {
  const { x = 0, y = 0, width = 0 } = viewBox ?? {}
  return (
    <text x={x + width} y={y - 5} textAnchor="end" fontSize={13} fill="var(--color-primary)">
      {value}
    </text>
  )
}

export function ContractTimeline({ members, median, expectedNextDate }: ContractTimelineProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const locale = useDateFnsLocale()

  const goToTransaction = (point: TimelinePoint) => {
    if (point.isGhost || point.accountId === null) return
    void navigate({
      to: '/account/$accountId/transactions/$transactionId',
      params: { accountId: String(point.accountId), transactionId: point.key },
    })
  }

  const points: TimelinePoint[] = members
    .filter((member) => member.contract_assignment !== 'EXCLUDED')
    .map((member) => ({
      key: String(member.id),
      accountId: member.account_id,
      date: member.date,
      amount: member.amount,
      mag: Math.abs(member.amount),
      isOutlier: member.is_outlier,
      isGhost: false,
    }))
    .reverse()

  const ghost: TimelinePoint | null =
    expectedNextDate && median !== null
      ? {
          key: 'ghost',
          accountId: null,
          date: expectedNextDate,
          amount: median,
          mag: Math.abs(median),
          isOutlier: false,
          isGhost: true,
        }
      : null
  const data = ghost ? [...points, ghost] : points

  const yearGroups: YearGroup[] = []
  for (const point of data) {
    const year = parseISO(point.date).getFullYear()
    const last = yearGroups.at(-1)
    if (last && last.year === year) last.endKey = point.key
    else yearGroups.push({ year, startKey: point.key, endKey: point.key })
  }
  const hasMultipleYears = yearGroups.length > 1

  const peak = Math.max(...data.map((point) => point.mag), 0)
  const yMax = peak * 1.02 || 1
  const medianMag = median !== null ? Math.abs(median) : null

  const maxLabelWidth = Math.max(
    0,
    ...data.map((point) => formatEuro(point.mag).length * CHAR_WIDTH),
  )
  const topMargin = Math.min(88, Math.ceil(maxLabelWidth) + 6)

  const labelByKey = new Map(
    data.map((point) => [
      point.key,
      point.isGhost
        ? t('contracts.expectedShort')
        : format(parseISO(point.date), 'MMM', { locale }),
    ]),
  )

  return (
    <div className="h-52 w-full" aria-label={t('contracts.paymentHistory')}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: topMargin, right: 12, left: 4, bottom: 0 }}>
          <YAxis hide domain={[0, yMax]} />
          <XAxis
            dataKey="key"
            tickFormatter={(key) => labelByKey.get(String(key)) ?? ''}
            tick={{ ...AXIS_TICK, fontSize: 10 }}
            tickLine={false}
            axisLine={{ stroke: 'var(--color-border)' }}
            interval={0}
            height={hasMultipleYears ? 44 : undefined}
          />
          {medianMag !== null ? (
            <ReferenceLine
              y={medianMag}
              stroke="var(--color-primary)"
              strokeDasharray="4 3"
              ifOverflow="extendDomain"
              label={ghost ? undefined : <MedianLabel value={formatEuro(median!)} />}
            />
          ) : null}
          <Bar
            dataKey="mag"
            radius={[3, 3, 0, 0]}
            isAnimationActive={false}
            onClick={(entry: { payload?: TimelinePoint }) =>
              entry.payload && goToTransaction(entry.payload)
            }
          >
            {data.map((point) => (
              <Cell
                key={point.key}
                className={point.isGhost ? undefined : 'cursor-pointer'}
                fill={point.isGhost ? 'transparent' : barColor(point)}
                stroke={point.isGhost ? 'var(--color-primary)' : undefined}
                strokeWidth={point.isGhost ? 1.5 : 0}
                strokeDasharray={point.isGhost ? '3 2' : undefined}
              />
            ))}
            <LabelList dataKey="mag" content={<AmountLabel points={data} />} />
          </Bar>
          {hasMultipleYears ? <YearBand groups={yearGroups} /> : null}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
