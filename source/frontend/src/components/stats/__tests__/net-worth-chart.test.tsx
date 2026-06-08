import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import '@/i18n'

vi.mock('recharts', () => {
  const Passthrough = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>
  const LineChart = ({
    children,
    onMouseDown,
    onMouseMove,
    onMouseUp,
  }: {
    children?: React.ReactNode
    onMouseDown?: (state: unknown) => void
    onMouseMove?: (state: unknown) => void
    onMouseUp?: () => void
  }) => (
    <div>
      <button data-testid="down" onClick={() => onMouseDown?.({ activeLabel: '2026-01-05' })} />
      <button
        data-testid="move-late"
        onClick={() => onMouseMove?.({ activeLabel: '2026-01-10', activeTooltipIndex: 2 })}
      />
      <button
        data-testid="move-early"
        onClick={() => onMouseMove?.({ activeLabel: '2026-01-02', activeTooltipIndex: 0 })}
      />
      <button data-testid="up" onClick={() => onMouseUp?.()} />
      {children}
    </div>
  )
  return {
    ResponsiveContainer: Passthrough,
    LineChart,
    Line: Passthrough,
    XAxis: Passthrough,
    YAxis: Passthrough,
    CartesianGrid: Passthrough,
    Tooltip: Passthrough,
    ReferenceDot: Passthrough,
    ReferenceArea: Passthrough,
  }
})

import { NetWorthChart } from '../net-worth-chart'

const data = [
  { date: '2026-01-02', value: 100 },
  { date: '2026-01-05', value: 110 },
  { date: '2026-01-10', value: 120 },
]

describe('NetWorthChart drag-to-select', () => {
  it('commits the dragged range as the date filter', async () => {
    const user = userEvent.setup()
    const onSelectRange = vi.fn()
    render(<NetWorthChart data={data} summary={null} onSelectRange={onSelectRange} />)

    await user.click(screen.getByTestId('down')) // start at 2026-01-05
    await user.click(screen.getByTestId('move-late')) // drag to 2026-01-10
    await user.click(screen.getByTestId('up'))

    expect(onSelectRange).toHaveBeenCalledWith('2026-01-05', '2026-01-10')
  })

  it('orders the endpoints when dragging right-to-left', async () => {
    const user = userEvent.setup()
    const onSelectRange = vi.fn()
    render(<NetWorthChart data={data} summary={null} onSelectRange={onSelectRange} />)

    await user.click(screen.getByTestId('down')) // 2026-01-05
    await user.click(screen.getByTestId('move-early')) // 2026-01-02 (earlier)
    await user.click(screen.getByTestId('up'))

    expect(onSelectRange).toHaveBeenCalledWith('2026-01-02', '2026-01-05')
  })

  it('does not commit a plain click (no drag)', async () => {
    const user = userEvent.setup()
    const onSelectRange = vi.fn()
    render(<NetWorthChart data={data} summary={null} onSelectRange={onSelectRange} />)

    await user.click(screen.getByTestId('down'))
    await user.click(screen.getByTestId('up'))

    expect(onSelectRange).not.toHaveBeenCalled()
  })
})
