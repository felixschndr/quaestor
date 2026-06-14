import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import '@/i18n'

vi.mock('recharts', () => {
  const Passthrough = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>
  const LineChart = ({
    children,
    onClick,
    onMouseDown,
    onMouseMove,
    onMouseUp,
    onMouseLeave,
  }: {
    children?: React.ReactNode
    onClick?: (state: unknown) => void
    onMouseDown?: (state: unknown) => void
    onMouseMove?: (state: unknown) => void
    onMouseUp?: () => void
    onMouseLeave?: () => void
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
      <button
        data-testid="pick-early"
        onClick={() => onClick?.({ activeLabel: '2026-01-02', activeTooltipIndex: 0 })}
      />
      <button data-testid="leave" onClick={() => onMouseLeave?.()} />
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
    ReferenceLine: Passthrough,
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

describe('NetWorthChart view day', () => {
  const viewDayButton = () => screen.getByRole('button', { name: /aufschlüsseln|Details/i })

  it('opens the clicked day and keeps it after the cursor leaves the chart', async () => {
    const user = userEvent.setup()
    const onOpenDay = vi.fn()
    render(<NetWorthChart data={data} summary={null} onOpenDay={onOpenDay} />)

    await user.click(screen.getByTestId('pick-early')) // pin 2026-01-02
    await user.click(screen.getByTestId('leave')) // cursor leaves; pinned day must survive
    await user.click(viewDayButton())

    expect(onOpenDay).toHaveBeenCalledWith('2026-01-02')
  })

  it('defaults to the last day when nothing was picked', async () => {
    const user = userEvent.setup()
    const onOpenDay = vi.fn()
    render(<NetWorthChart data={data} summary={null} onOpenDay={onOpenDay} />)

    await user.click(viewDayButton())

    expect(onOpenDay).toHaveBeenCalledWith('2026-01-10')
  })
})
