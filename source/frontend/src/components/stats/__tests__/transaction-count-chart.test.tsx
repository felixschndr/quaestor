import { render, screen } from '@testing-library/react'
import type { TransactionCountsGroupBy } from '@/lib/statistics'
import { describe, expect, it, vi } from 'vitest'

import '@/i18n'
import { formatDate } from '@/lib/format'
import { AMOUNT_S, AMOUNT_M, TEST_BALANCE } from '@/test/constants'

const captured = vi.hoisted(() => ({
  tickLabel: (() => '') as (bucket: string) => string,
  tooltip: (() => null) as (props: unknown) => React.ReactNode,
}))

vi.mock('recharts', () => {
  const Passthrough = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>
  const BarChart = ({
    children,
    data,
  }: {
    children?: React.ReactNode
    data: { value: number }[]
  }) => (
    <div>
      <div data-testid="values">{JSON.stringify(data.map((datum) => datum.value))}</div>
      {children}
    </div>
  )
  const Bar = ({ dataKey }: { dataKey: string }) => <div data-testid="bar-key">{dataKey}</div>
  const Tooltip = ({ content }: { content: (props: unknown) => React.ReactNode }) => {
    captured.tooltip = content
    return (
      <div data-testid="tooltip">
        {content({ active: true, payload: [{ value: TEST_BALANCE }], label: '2026-06' })}
      </div>
    )
  }
  const XAxis = ({ tickFormatter }: { tickFormatter: (bucket: string) => string }) => {
    captured.tickLabel = tickFormatter
    return null
  }
  return {
    ResponsiveContainer: Passthrough,
    BarChart,
    Bar,
    CartesianGrid: Passthrough,
    XAxis,
    YAxis: Passthrough,
    Tooltip,
  }
})

import { TransactionCountChart } from '../transaction-count-chart'

const data = [
  { bucket: '2026-06', count: 2, amount: AMOUNT_M },
  { bucket: '2026-07', count: 1, amount: AMOUNT_S },
]

describe('TransactionCountChart', () => {
  it('feeds counts and keeps a stable "value" dataKey so bars animate in place', () => {
    render(<TransactionCountChart data={data} groupBy="month" metric="count" />)

    expect(screen.getByTestId('values')).toHaveTextContent('[2,1]')
    expect(screen.getByTestId('bar-key')).toHaveTextContent('value')
  })

  it('switches the fed values to the amount when the metric is "amount"', () => {
    render(<TransactionCountChart data={data} groupBy="month" metric="amount" />)

    expect(screen.getByTestId('values')).toHaveTextContent(`[${AMOUNT_M},${AMOUNT_S}]`)
    expect(screen.getByTestId('bar-key')).toHaveTextContent('value')
  })

  it('formats the amount tooltip as money, but the count tooltip as a plain number', () => {
    const { rerender } = render(
      <TransactionCountChart data={data} groupBy="month" metric="count" />,
    )
    expect(screen.getByTestId('tooltip')).toHaveTextContent(String(TEST_BALANCE))

    rerender(<TransactionCountChart data={data} groupBy="month" metric="amount" />)
    expect(screen.getByTestId('tooltip')).not.toHaveTextContent(String(TEST_BALANCE))
  })
})

describe('TransactionCountChart labels', () => {
  const renderTooltip = (label: string) =>
    render(
      <div data-testid="hovered">
        {captured.tooltip({ active: true, payload: [{ value: 2 }], label })}
      </div>,
    )

  it.each<[TransactionCountsGroupBy, string, string]>([
    ['day', '2026-06-02', 'Jun 2'],
    ['week', '2026-06-01', 'Week 23'],
    ['month', '2026-06', 'Jun 2026'],
    ['weekday', '1', 'Mondays'],
  ])('labels %s buckets on the axis (%s → %s)', (groupBy, bucket, label) => {
    render(<TransactionCountChart data={data} groupBy={groupBy} metric="count" />)
    expect(captured.tickLabel(bucket)).toBe(label)
  })

  it('names the hovered week and the days it spans', () => {
    render(<TransactionCountChart data={data} groupBy="week" metric="count" />)
    renderTooltip('2026-06-01')

    expect(screen.getByTestId('hovered')).toHaveTextContent(
      /^Week 23 \(June 1\D+7, 2026\)Transactions: 2$/,
    )
  })

  it.each<[TransactionCountsGroupBy, string, string]>([
    ['day', '2026-06-02', formatDate('2026-06-02')],
    ['month', '2026-06', 'Jun 2026'],
    ['weekday', '0', 'Sundays'],
  ])('names the hovered %s bucket', (groupBy, bucket, label) => {
    render(<TransactionCountChart data={data} groupBy={groupBy} metric="count" />)
    renderTooltip(bucket)

    expect(screen.getByTestId('hovered')).toHaveTextContent(`${label}: 2`)
  })

  it('shows no tooltip while nothing is hovered', () => {
    render(<TransactionCountChart data={data} groupBy="day" metric="count" />)
    render(<div data-testid="hovered">{captured.tooltip({ active: false, payload: [] })}</div>)

    expect(screen.getByTestId('hovered')).toBeEmptyDOMElement()
  })
})
