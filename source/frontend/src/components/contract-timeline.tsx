import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { de, enUS, type Locale } from 'date-fns/locale'
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
} from 'recharts'

import { formatEuro } from '@/lib/format'
import { AXIS_TICK } from '@/components/stats/chartTheme'
import type { ContractMemberRead } from '@/lib/contract'

const LOCALES: Record<string, Locale> = { en: enUS, de }

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

interface PeakLabelProps {
  points: TimelinePoint[]
  maxMag: number
  minMag: number
  showMax: boolean
  showMin: boolean
  x?: number
  y?: number
  width?: number
  index?: number
}

function PeakLabel({
  points,
  maxMag,
  minMag,
  showMax,
  showMin,
  x = 0,
  y = 0,
  width = 0,
  index,
}: PeakLabelProps) {
  if (index === undefined) return null

  const point = points[index]
  if (!point) return null

  const isMax = showMax && point.mag === maxMag
  const isMin = showMin && point.mag === minMag
  if (!isMax && !isMin) return null

  const text = formatEuro(point.mag)
  const fill = point.isOutlier ? 'var(--color-warning)' : 'var(--color-foreground)'
  const textWidth = text.length * CHAR_WIDTH

  if (textWidth <= width) {
    const cx = x + width / 2
    return (
      <text x={cx} y={y - 6} textAnchor="middle" fontSize={11} fontWeight={500} fill={fill}>
        {text}
      </text>
    )
  }

  const angle = -Math.min(
    70,
    Math.round((Math.acos(Math.min(1, width / textWidth)) * 180) / Math.PI),
  )
  const ay = y - 4
  return (
    <text
      x={x}
      y={ay}
      transform={`rotate(${angle} ${x} ${ay})`}
      textAnchor="start"
      fontSize={11}
      fontWeight={500}
      fill={fill}
    >
      {text}
    </text>
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
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const locale = LOCALES[i18n.language] ?? enUS

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

  const mags = points.map((point) => point.mag)
  const maxMag = mags.length > 0 ? Math.max(...mags) : 0
  const minMag = mags.length > 0 ? Math.min(...mags) : 0
  const allEqual = points.length > 0 && maxMag === minMag
  const showMax = !allEqual
  const showMin = !allEqual

  const peak = Math.max(...data.map((point) => point.mag), 0)
  const yMax = peak * 1.06 || 1
  const medianMag = median !== null ? Math.abs(median) : null

  const labelByKey = new Map(
    data.map((point) => [
      point.key,
      point.isGhost
        ? t('contracts.expectedShort')
        : format(parseISO(point.date), 'MMM', { locale }),
    ]),
  )

  return (
    <div className="h-44 w-full" aria-label={t('contracts.paymentHistory')}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
          <YAxis hide domain={[0, yMax]} />
          <XAxis
            dataKey="key"
            tickFormatter={(key) => labelByKey.get(String(key)) ?? ''}
            tick={{ ...AXIS_TICK, fontSize: 10 }}
            tickLine={false}
            axisLine={{ stroke: 'var(--color-border)' }}
            interval="preserveStartEnd"
            minTickGap={16}
          />
          {medianMag !== null ? (
            <ReferenceLine
              y={medianMag}
              stroke="var(--color-primary)"
              strokeDasharray="4 3"
              ifOverflow="extendDomain"
              label={<MedianLabel value={formatEuro(median!)} />}
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
            <LabelList
              dataKey="mag"
              content={
                <PeakLabel
                  points={points}
                  maxMag={maxMag}
                  minMag={minMag}
                  showMax={showMax}
                  showMin={showMin}
                />
              }
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
