import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import '@/i18n'

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
  const Tooltip = ({ content }: { content: (props: unknown) => React.ReactNode }) => (
    <div data-testid="tooltip">
      {content({ active: true, payload: [{ value: 1234.5 }], label: '2026-06' })}
    </div>
  )
  return {
    ResponsiveContainer: Passthrough,
    BarChart,
    Bar,
    CartesianGrid: Passthrough,
    XAxis: Passthrough,
    YAxis: Passthrough,
    Tooltip,
  }
})

import { TransactionCountChart } from '../transaction-count-chart'

const data = [
  { bucket: '2026-06', count: 2, amount: 50 },
  { bucket: '2026-07', count: 1, amount: 20 },
]

describe('TransactionCountChart', () => {
  it('feeds counts and keeps a stable "value" dataKey so bars animate in place', () => {
    render(<TransactionCountChart data={data} groupBy="month" metric="count" />)

    expect(screen.getByTestId('values')).toHaveTextContent('[2,1]')
    expect(screen.getByTestId('bar-key')).toHaveTextContent('value')
  })

  it('switches the fed values to the amount when the metric is "amount"', () => {
    render(<TransactionCountChart data={data} groupBy="month" metric="amount" />)

    expect(screen.getByTestId('values')).toHaveTextContent('[50,20]')
    expect(screen.getByTestId('bar-key')).toHaveTextContent('value')
  })

  it('formats the amount tooltip as money, but the count tooltip as a plain number', () => {
    const { rerender } = render(
      <TransactionCountChart data={data} groupBy="month" metric="count" />,
    )
    expect(screen.getByTestId('tooltip')).toHaveTextContent('1234.5')

    rerender(<TransactionCountChart data={data} groupBy="month" metric="amount" />)
    expect(screen.getByTestId('tooltip')).not.toHaveTextContent('1234.5')
  })
})
