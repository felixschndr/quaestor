import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import '@/i18n'
import { formatDate } from '@/lib/format'
import { STORAGE_KEY } from '@/lib/netWorthPin'
import { AMOUNT_L, AMOUNT_M, AMOUNT_S, DATE_RANGE_END, money } from '@/test/constants'

type ChartState = { activeLabel?: unknown; activeTooltipIndex?: unknown }
type ChartHandler = (state: ChartState) => void

const { PICKED_DAY, chart } = vi.hoisted(() => ({
  PICKED_DAY: '2026-01-02',
  chart: {} as Record<'lineChart' | 'xAxis' | 'yAxis' | 'tooltip', Record<string, unknown>>,
}))

vi.mock('recharts', () => {
  const Passthrough = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>
  const LineChart = (props: {
    children?: React.ReactNode
    onClick?: (state: unknown) => void
    onMouseLeave?: () => void
  }) => {
    chart.lineChart = props
    return (
      <div>
        <button
          data-testid="pick-early"
          onClick={() => props.onClick?.({ activeLabel: PICKED_DAY, activeTooltipIndex: 0 })}
        />
        <button data-testid="leave" onClick={() => props.onMouseLeave?.()} />
        {props.children}
      </div>
    )
  }
  const capture = (key: 'xAxis' | 'yAxis' | 'tooltip') => (props: Record<string, unknown>) => {
    chart[key] = props
    return null
  }
  const Mark =
    (name: string) =>
    ({ x, x1, x2, r }: { x?: string; x1?: string; x2?: string; r?: number }) => (
      <div data-testid={name} data-x={x ?? `${x1}..${x2}`} data-r={r} />
    )
  return {
    ResponsiveContainer: Passthrough,
    LineChart,
    Line: Passthrough,
    XAxis: capture('xAxis'),
    YAxis: capture('yAxis'),
    CartesianGrid: Passthrough,
    Tooltip: capture('tooltip'),
    ReferenceDot: Mark('dot'),
    ReferenceArea: Mark('area'),
    ReferenceLine: Mark('line'),
  }
})

import { NetWorthChart } from '../net-worth-chart'

const MIDDLE_DAY = '2026-01-05'

const data = [
  { date: PICKED_DAY, value: AMOUNT_S },
  { date: MIDDLE_DAY, value: AMOUNT_M },
  { date: DATE_RANGE_END, value: AMOUNT_L },
]

const fire = (
  handler: 'onClick' | 'onMouseDown' | 'onMouseMove' | 'onTouchStart',
  state: ChartState,
) => act(() => (chart.lineChart[handler] as ChartHandler)(state))

const expectHeader = (date: string, value: number) =>
  expect(screen.getByText(`${formatDate(date)}:`).parentElement).toHaveTextContent(
    `${formatDate(date)}: ${money(value)}`,
  )
const marks = (name: string) =>
  screen
    .queryAllByTestId(name)
    .map((mark) => `${mark.dataset.x}${mark.dataset.r ? `@${mark.dataset.r}` : ''}`)

beforeEach(() => {
  sessionStorage.clear()
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

    expect(onOpenDay).toHaveBeenCalledWith(PICKED_DAY)
  })

  it('breaks down the whole shown range when nothing was picked', async () => {
    const user = userEvent.setup()
    const onOpenDay = vi.fn()
    const onOpenRange = vi.fn()
    render(
      <NetWorthChart data={data} summary={null} onOpenDay={onOpenDay} onOpenRange={onOpenRange} />,
    )

    await user.click(viewDayButton())

    expect(onOpenRange).toHaveBeenCalledWith(PICKED_DAY, DATE_RANGE_END)
    expect(onOpenDay).not.toHaveBeenCalled()
  })

  it('restores the pinned day after remounting (e.g. navigating back)', async () => {
    const user = userEvent.setup()
    const onOpenDay = vi.fn()
    const { unmount } = render(<NetWorthChart data={data} summary={null} onOpenDay={onOpenDay} />)

    await user.click(screen.getByTestId('pick-early')) // pin 2026-01-02
    unmount()

    render(<NetWorthChart data={data} summary={null} onOpenDay={onOpenDay} />)
    await user.click(viewDayButton())

    expect(onOpenDay).toHaveBeenCalledWith(PICKED_DAY)
  })

  it('offers no breakdown without a handler for it', () => {
    render(<NetWorthChart data={data} summary={null} onOpenDay={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /Details/ })).toBeNull()
  })

  it('forgets the pinned day when the user taps outside the chart', async () => {
    const user = userEvent.setup()
    render(<NetWorthChart data={data} summary={null} onOpenDay={vi.fn()} />)
    await user.click(screen.getByTestId('pick-early'))
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe(PICKED_DAY)

    await user.click(document.body)

    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull()
    expectHeader(DATE_RANGE_END, AMOUNT_L)
  })
})

describe('NetWorthChart hover', () => {
  it('shows the latest value until a day is hovered, then that day', () => {
    render(<NetWorthChart data={data} summary={null} />)
    expectHeader(DATE_RANGE_END, AMOUNT_L)
    expect(marks('line')).toEqual([])

    fire('onMouseMove', { activeTooltipIndex: 1 })
    expectHeader(MIDDLE_DAY, AMOUNT_M)
    expect(marks('line')).toEqual([MIDDLE_DAY])

    fire('onTouchStart', { activeTooltipIndex: '0' })
    expectHeader(PICKED_DAY, AMOUNT_S)
  })

  it('ignores positions that do not map to a day', () => {
    render(<NetWorthChart data={data} summary={null} />)
    fire('onMouseMove', { activeTooltipIndex: 1 })

    for (const activeTooltipIndex of [null, -1, data.length, 'none']) {
      fire('onMouseMove', { activeTooltipIndex })
    }
    fire('onClick', { activeTooltipIndex: null })

    expectHeader(MIDDLE_DAY, AMOUNT_M)
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('marks a pinned day apart from the hovered one', () => {
    render(<NetWorthChart data={data} summary={null} onOpenDay={vi.fn()} />)
    fire('onClick', { activeTooltipIndex: 0 })
    expect(marks('dot')).toEqual([`${PICKED_DAY}@7`])

    fire('onMouseMove', { activeTooltipIndex: 2 })

    expect(marks('dot')).toEqual([`${PICKED_DAY}@7`, `${PICKED_DAY}@4`, `${DATE_RANGE_END}@7`])
  })

  it('keeps the page from scrolling while scrubbing on touch', () => {
    const { container, unmount } = render(<NetWorthChart data={data} summary={null} />)
    const scrubArea = container.querySelector<HTMLElement>('[style*="touch-action"]')!

    const move = new Event('touchmove', { cancelable: true })
    scrubArea.dispatchEvent(move)
    expect(move.defaultPrevented).toBe(true)

    unmount()
    const afterUnmount = new Event('touchmove', { cancelable: true })
    scrubArea.dispatchEvent(afterUnmount)
    expect(afterUnmount.defaultPrevented).toBe(false)
  })
})

describe('NetWorthChart range drag', () => {
  function renderDraggable(series = data) {
    const onOpenRange = vi.fn()
    const onOpenDay = vi.fn()
    render(
      <NetWorthChart
        data={series}
        summary={null}
        onOpenRange={onOpenRange}
        onOpenDay={onOpenDay}
      />,
    )
    return { onOpenRange }
  }

  it('shows the change across the dragged range and opens it on release', () => {
    const { onOpenRange } = renderDraggable()

    fire('onMouseDown', { activeLabel: DATE_RANGE_END })
    fire('onMouseMove', { activeLabel: DATE_RANGE_END, activeTooltipIndex: 2 })
    expect(marks('area')).toEqual([])
    fire('onMouseMove', { activeLabel: PICKED_DAY, activeTooltipIndex: 0 })

    expect(
      screen.getByText(`${formatDate(PICKED_DAY)} – ${formatDate(DATE_RANGE_END)}:`),
    ).toBeInTheDocument()
    expect(screen.getByText(`+${money(AMOUNT_L - AMOUNT_S)}`)).toHaveClass('text-success')
    expect(marks('area')).toEqual([`${DATE_RANGE_END}..${PICKED_DAY}`])
    expect(screen.queryByRole('button', { name: /Details/ })).toBeNull()

    fireEvent.mouseUp(document)
    expect(onOpenRange).toHaveBeenCalledWith(PICKED_DAY, DATE_RANGE_END)

    fire('onClick', { activeTooltipIndex: 0 })
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('shows a loss across the range in red', () => {
    renderDraggable(
      [...data].reverse().map((point, index) => ({ ...point, date: data[index].date })),
    )

    fire('onMouseDown', { activeLabel: PICKED_DAY })
    fire('onMouseMove', { activeLabel: DATE_RANGE_END })

    expect(screen.getByText(money(AMOUNT_S - AMOUNT_L))).toHaveClass('text-destructive')
  })

  it('leaves out the change when an end of the range has no value', () => {
    renderDraggable()

    fire('onMouseDown', { activeLabel: PICKED_DAY })
    fire('onMouseMove', { activeLabel: '2026-01-03' })

    expect(
      screen.getByText(`${formatDate(PICKED_DAY)} – ${formatDate('2026-01-03')}:`).parentElement,
    ).toHaveTextContent(/:$/)
  })

  it('snaps the range to the first or last day when dragged past the plot', () => {
    const { onOpenRange } = renderDraggable()

    fire('onMouseDown', { activeLabel: MIDDLE_DAY })
    fireEvent.mouseMove(document, { clientX: 400 })
    expect(marks('area')).toEqual([])
    fireEvent.mouseMove(document, { clientX: 10 })
    fireEvent.mouseUp(document)
    expect(onOpenRange).toHaveBeenLastCalledWith(PICKED_DAY, MIDDLE_DAY)

    fire('onMouseDown', { activeLabel: MIDDLE_DAY })
    fireEvent.mouseMove(document, { clientX: 799 })
    fireEvent.mouseUp(document)
    expect(onOpenRange).toHaveBeenLastCalledWith(MIDDLE_DAY, DATE_RANGE_END)
  })

  it('cancels the drag on Escape without pinning a day', () => {
    const { onOpenRange } = renderDraggable()

    fire('onMouseDown', { activeLabel: PICKED_DAY })
    fire('onMouseMove', { activeLabel: MIDDLE_DAY })
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(marks('area')).toHaveLength(1)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(marks('area')).toEqual([])

    fireEvent.mouseUp(document)
    fire('onClick', { activeTooltipIndex: 1 })

    expect(onOpenRange).not.toHaveBeenCalled()
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('treats a press and release on one day as a click that pins it', () => {
    const { onOpenRange } = renderDraggable()

    fire('onMouseDown', { activeLabel: MIDDLE_DAY })
    fireEvent.mouseUp(document)
    fire('onClick', { activeTooltipIndex: 1 })

    expect(onOpenRange).not.toHaveBeenCalled()
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe(MIDDLE_DAY)
  })

  it('does not start a drag outside a day', () => {
    renderDraggable()
    fire('onMouseDown', { activeLabel: null })
    fire('onMouseMove', { activeLabel: MIDDLE_DAY })
    expect(marks('area')).toEqual([])
  })

  it('does not start a drag when ranges cannot be opened', () => {
    render(<NetWorthChart data={data} summary={null} />)
    fire('onMouseDown', { activeLabel: PICKED_DAY })
    fire('onMouseMove', { activeLabel: MIDDLE_DAY })
    expect(marks('area')).toEqual([])
  })
})

describe('NetWorthChart rendering', () => {
  it('renders nothing without data', () => {
    const { container } = render(<NetWorthChart data={[]} summary={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('lists the minimum, average and maximum of the range', () => {
    render(
      <NetWorthChart
        data={data}
        summary={{ minimum: AMOUNT_S, average: AMOUNT_M, maximum: AMOUNT_L }}
      />,
    )

    expect(screen.getByText('Minimum').nextElementSibling).toHaveTextContent(money(AMOUNT_S))
    expect(screen.getByText('Average').nextElementSibling).toHaveTextContent(money(AMOUNT_M))
    expect(screen.getByText('Maximum').nextElementSibling).toHaveTextContent(money(AMOUNT_L))
  })

  it('labels days on the x-axis and pads the y-axis by 2 %', () => {
    render(<NetWorthChart data={data} summary={null} />)

    expect((chart.xAxis.tickFormatter as (value: string) => string)(MIDDLE_DAY)).toBe('5. Jan')
    const [lower, upper] = chart.yAxis.domain as [(min: number) => number, (max: number) => number]
    expect(lower(AMOUNT_L)).toBe(98)
    expect(upper(-AMOUNT_L)).toBe(-98)
    expect((chart.tooltip.content as () => unknown)()).toBeNull()
  })
})
