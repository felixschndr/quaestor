import { cloneElement, type ComponentProps, type ReactElement, type ReactNode } from 'react'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const chartProps = vi.hoisted(() => new Map<string, Record<string, unknown>>())

vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>()
  const capture = (name: string) =>
    function Captured(props: Record<string, unknown>) {
      const id = props.yAxisId ?? props.dataKey
      chartProps.set(id === undefined ? name : `${name}:${String(id)}`, props)
      return <div>{props.children as ReactNode}</div>
    }
  const captured = [
    'ResponsiveContainer',
    'BarChart',
    'ComposedChart',
    'PieChart',
    'Pie',
    'Cell',
    'Bar',
    'Line',
    'XAxis',
    'YAxis',
    'CartesianGrid',
    'Tooltip',
    'Legend',
    'ReferenceLine',
  ]
  return { ...actual, ...Object.fromEntries(captured.map((name) => [name, capture(name)])) }
})

import '@/i18n'
import { formatMoney, formatPercent } from '@/lib/format'
import type { CategorySlice } from '@/lib/statistics'
import {
  AMOUNT_L,
  AMOUNT_M,
  AMOUNT_S,
  AMOUNT_XL,
  PARTY_SUPERMARKET,
  TEST_IBAN,
  TEST_IBAN_FORMATTED,
  TODAY,
  money,
} from '@/test/constants'
import { CashflowChart } from '../cashflow-chart'
import { CategoryChart } from '../category-chart'
import { NetSavingsChart } from '../net-savings-chart'
import { OtherPartyChart } from '../other-party-chart'

function propOf<T>(component: string, prop: string): T {
  const props = chartProps.get(component)
  if (!props) throw new Error(`${component} was not rendered`)
  return props[prop] as T
}

type BarClick = (data: unknown, index: number) => void

const percent = (ratio: number) => formatPercent(ratio).replace(/\u00a0/g, ' ')

const renderWith = (component: string, prop: string, props: object) =>
  render(<svg>{cloneElement(propOf<ReactElement>(component, prop), props)}</svg>)

beforeEach(() => {
  chartProps.clear()
})

describe('CashflowChart', () => {
  const data = [
    { month: '2026-04', income: AMOUNT_XL, expenses: AMOUNT_L },
    { month: '2026-05', income: AMOUNT_L, expenses: AMOUNT_XL },
  ]

  it('opens the month of a clicked bar in that bar’s direction', () => {
    const onSelectMonth = vi.fn()
    render(<CashflowChart data={data} onSelectMonth={onSelectMonth} />)

    act(() => propOf<BarClick>('Bar:expenses', 'onClick')({}, 1))
    act(() => propOf<BarClick>('Bar:income', 'onClick')({}, 0))
    act(() => propOf<BarClick>('Bar:income', 'onClick')({}, data.length))

    expect(onSelectMonth.mock.calls).toEqual([
      ['2026-05', 'OUTGOING'],
      ['2026-04', 'INCOMING'],
    ])
  })

  it('leaves the bars inert without a month handler', () => {
    render(<CashflowChart data={data} />)

    expect(propOf('Bar:expenses', 'onClick')).toBeUndefined()
    expect(propOf('Bar:income', 'onClick')).toBeUndefined()
  })

  it('shows income, expenses and the resulting deficit of the hovered month', () => {
    render(<CashflowChart data={data} />)
    renderWith('Tooltip', 'content', {
      active: true,
      label: '2026-05',
      payload: [
        { dataKey: 'expenses', value: AMOUNT_XL },
        { dataKey: 'income', value: AMOUNT_L },
      ],
    })

    expect(screen.getByText('May 2026')).toBeInTheDocument()
    expect(screen.getByText('Income').nextElementSibling).toHaveTextContent(money(AMOUNT_L))
    expect(screen.getByText('Expenses').nextElementSibling).toHaveTextContent(money(AMOUNT_XL))
    expect(screen.getByText(money(AMOUNT_L - AMOUNT_XL))).toHaveClass('text-destructive')
  })

  it('counts a missing series as zero and keeps a surplus neutral', () => {
    render(<CashflowChart data={data} />)
    renderWith('Tooltip', 'content', {
      active: true,
      label: '2026-04',
      payload: [{ dataKey: 'income', value: AMOUNT_L }],
    })

    expect(screen.getByText('Expenses').nextElementSibling).toHaveTextContent(money(0))
    expect(screen.getByText('Balance').nextElementSibling).not.toHaveClass('text-destructive')
  })

  it('shows no tooltip while no bar is hovered', () => {
    render(<CashflowChart data={data} />)
    const { container } = renderWith('Tooltip', 'content', { active: false, payload: [] })
    expect(container.querySelector('svg')).toBeEmptyDOMElement()
  })
})

describe('NetSavingsChart', () => {
  const data = [
    { month: '2026-04', net: AMOUNT_L, savings_rate: 25 },
    { month: '2026-05', net: -AMOUNT_M, savings_rate: -80 },
  ]

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(TODAY)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('drops the savings rate of the running month but keeps its surplus', () => {
    render(<NetSavingsChart data={data} />)

    expect(propOf('ComposedChart', 'data')).toEqual([data[0], { ...data[1], savings_rate: null }])
  })

  it('extends the surplus axis below zero only for a deficit', () => {
    render(<NetSavingsChart data={data} />)

    const [lower] = propOf<[(dataMin: number) => number]>('YAxis:net', 'domain')
    expect(lower(-AMOUNT_L)).toBeCloseTo(-AMOUNT_L * 1.1)
    expect(lower(AMOUNT_L)).toBe(0)
  })

  it('formats the savings rate as percent and the surplus as money', () => {
    render(<NetSavingsChart data={data} />)

    const formatter = propOf<(value: unknown, name: string) => string>('Tooltip', 'formatter')
    expect(formatter(25, 'Savings rate')).toBe('25%')
    expect(formatter(AMOUNT_L, 'Surplus')).toBe(formatMoney(AMOUNT_L))
    expect(propOf<(value: unknown) => string>('YAxis:rate', 'tickFormatter')(25)).toBe('25%')
    expect(propOf<(label: unknown) => string>('Tooltip', 'labelFormatter')('2026-04')).toBe(
      'Apr 2026',
    )
  })
})

describe('OtherPartyChart', () => {
  const data = [
    { other_party: PARTY_SUPERMARKET, total: AMOUNT_L },
    { other_party: TEST_IBAN, total: AMOUNT_M },
  ]

  it('blanks the bars of hidden parties but keeps their rows', () => {
    render(
      <OtherPartyChart
        data={data}
        hidden={new Set([PARTY_SUPERMARKET])}
        onToggleHidden={vi.fn()}
      />,
    )

    expect(propOf('BarChart', 'data')).toEqual([
      { key: PARTY_SUPERMARKET, label: PARTY_SUPERMARKET, value: null },
      { key: TEST_IBAN, label: TEST_IBAN_FORMATTED, value: AMOUNT_M },
    ])
  })

  it('labels an IBAN party readably and toggles it when its label is clicked', async () => {
    const onToggleHidden = vi.fn()
    render(<OtherPartyChart data={data} hidden={new Set()} onToggleHidden={onToggleHidden} />)
    renderWith('YAxis:key', 'tick', { payload: { value: TEST_IBAN } })

    await userEvent.click(screen.getByText(TEST_IBAN_FORMATTED))

    expect(onToggleHidden).toHaveBeenCalledWith(TEST_IBAN)
  })

  it('labels a party it has no row for by its raw name', () => {
    render(<OtherPartyChart data={data} hidden={new Set()} onToggleHidden={vi.fn()} />)
    renderWith('YAxis:key', 'tick', { payload: { value: 'Elsewhere' } })

    expect(screen.getByText('Elsewhere')).toBeInTheDocument()
  })

  it('drills into a party from its arrow', async () => {
    const onDrill = vi.fn()
    render(
      <OtherPartyChart data={data} hidden={new Set()} onToggleHidden={vi.fn()} onDrill={onDrill} />,
    )
    renderWith('YAxis:drill', 'tick', { payload: { value: PARTY_SUPERMARKET } })

    await userEvent.click(screen.getByRole('button'))

    expect(onDrill).toHaveBeenCalledWith(PARTY_SUPERMARKET)
  })

  it('has no arrow column without a drill handler', () => {
    render(<OtherPartyChart data={data} hidden={new Set()} onToggleHidden={vi.fn()} />)

    expect(chartProps.has('YAxis:drill')).toBe(false)
    expect(propOf('BarChart', 'margin')).toEqual({ left: 0, right: 16 })
  })

  it('shows the full name and amount of the hovered party', () => {
    render(<OtherPartyChart data={data} hidden={new Set()} onToggleHidden={vi.fn()} />)
    renderWith('Tooltip', 'content', {
      active: true,
      payload: [{ payload: { label: TEST_IBAN_FORMATTED, value: AMOUNT_M } }],
    })

    expect(screen.getByText(TEST_IBAN_FORMATTED)).toBeInTheDocument()
    expect(screen.getByText(money(AMOUNT_M))).toBeInTheDocument()
  })

  it('shows no tooltip for a hidden party or without hover', () => {
    render(<OtherPartyChart data={data} hidden={new Set()} onToggleHidden={vi.fn()} />)
    const hidden = renderWith('Tooltip', 'content', {
      active: true,
      payload: [{ payload: { label: PARTY_SUPERMARKET, value: null } }],
    })
    const idle = renderWith('Tooltip', 'content', { active: false })

    expect(hidden.container.querySelector('svg')).toBeEmptyDOMElement()
    expect(idle.container.querySelector('svg')).toBeEmptyDOMElement()
  })
})

describe('CategoryChart', () => {
  const mobility: CategorySlice[] = [
    { category: 'FUEL', total: AMOUNT_L },
    { category: 'PUBLIC_TRANSPORT', total: AMOUNT_M },
    { category: 'RENT', total: AMOUNT_S },
  ]
  const pieKeys = () => propOf<{ category: string }[]>('Pie:value', 'data').map((d) => d.category)
  const clickSlice = (index: number) =>
    act(() => propOf<BarClick>('Pie:value', 'onClick')({}, index))
  const renderCategory = (overrides: Partial<ComponentProps<typeof CategoryChart>> = {}) =>
    render(
      <CategoryChart
        slices={mobility}
        chartType="pie"
        hidden={new Set()}
        onToggleHidden={vi.fn()}
        {...overrides}
      />,
    )

  it('opens a group from its pie slice and drills into a category inside it', async () => {
    const onDrill = vi.fn()
    renderCategory({ onDrill })
    expect(pieKeys()).toEqual(['MOBILITY', 'HOUSING'])

    clickSlice(0)
    expect(screen.getByText('Mobility')).toBeInTheDocument()
    expect(pieKeys()).toEqual(['FUEL', 'PUBLIC_TRANSPORT'])

    clickSlice(1)
    expect(onDrill).toHaveBeenCalledWith(['PUBLIC_TRANSPORT'])

    await userEvent.click(screen.getByRole('button', { name: 'All categories' }))
    expect(pieKeys()).toEqual(['MOBILITY', 'HOUSING'])
  })

  it('drills into every category behind the Other slice', () => {
    const onDrill = vi.fn()
    const categories = [
      'SALARY',
      'SUPERMARKET',
      'RENT',
      'FUEL',
      'STREAMING',
      'CLOTHING',
      'DRUGSTORE',
      'BANK_FEES',
      'CHILDCARE',
      'VET',
    ] as const
    const slices = categories.map((category, index) => ({
      category,
      total: (categories.length - index) * AMOUNT_S,
    }))
    renderCategory({ slices, onDrill })
    expect(pieKeys().at(-1)).toBe('OTHER')

    clickSlice(pieKeys().length - 1)
    clickSlice(pieKeys().length)

    expect(onDrill.mock.calls).toEqual([
      [['CHILDCARE', 'POCKET_MONEY', 'OTHER_CHILDREN', 'PET_SUPPLIES', 'VET']],
    ])
  })

  it('keeps a group it cannot drill into further inert', () => {
    renderCategory()

    clickSlice(0)

    expect(screen.getByText('Mobility')).toBeInTheDocument()
    expect(propOf('Pie:value', 'onClick')).toBeUndefined()
  })

  it('leaves hidden slices out of the pie and out of the share', () => {
    renderCategory({ hidden: new Set(['HOUSING']) })
    expect(pieKeys()).toEqual(['MOBILITY'])

    renderWith('Tooltip', 'content', {
      active: true,
      payload: [{ payload: { label: 'Mobility', value: AMOUNT_L + AMOUNT_M } }],
    })
    expect(screen.getByText(`${money(AMOUNT_L + AMOUNT_M)} · ${percent(1)}`)).toBeInTheDocument()
  })

  it('shows a zero share when every slice is hidden', () => {
    renderCategory({ hidden: new Set(['MOBILITY', 'HOUSING']) })
    renderWith('Tooltip', 'content', {
      active: true,
      payload: [{ payload: { label: 'Mobility', value: AMOUNT_L } }],
    })

    expect(screen.getByText(`${money(AMOUNT_L)} · ${percent(0)}`)).toBeInTheDocument()
  })

  it('shows no tooltip for an empty slice or without hover', () => {
    renderCategory()
    const empty = renderWith('Tooltip', 'content', {
      active: true,
      payload: [{ payload: { label: 'Mobility', value: 0 } }],
    })
    const idle = renderWith('Tooltip', 'content', { active: false })

    expect(empty.container.querySelector('svg')).toBeEmptyDOMElement()
    expect(idle.container.querySelector('svg')).toBeEmptyDOMElement()
  })

  it('prints the share inside slices big enough to hold it', () => {
    renderCategory()
    const label = propOf<(props: object) => ReactElement | null>('Pie:value', 'label')

    expect(label({ percent: 0.05 })).toBeNull()
    render(
      <svg>
        {label({ cx: 100, cy: 100, midAngle: 0, innerRadius: 0, outerRadius: 100, percent: 0.5 })}
      </svg>,
    )
    expect(screen.getByText(percent(0.5))).toHaveAttribute('x', '160')
  })

  it('drills from the bar arrows: a group opens, a category is searched', async () => {
    const user = userEvent.setup()
    const onDrill = vi.fn()
    renderCategory({
      slices: [...mobility, { category: 'CUSTOM_DEADBEEF', total: AMOUNT_S }],
      chartType: 'bar',
      onDrill,
    })
    expect(propOf<{ key: string }[]>('BarChart', 'data').map((row) => row.key)).toEqual([
      'MOBILITY',
      'HOUSING',
      'CUSTOM_DEADBEEF',
    ])

    const arrow = renderWith('YAxis:drill', 'tick', { payload: { value: 'MOBILITY' } })
    await user.click(within(arrow.container).getByRole('button'))
    expect(screen.getByText('Mobility')).toBeInTheDocument()

    const categoryArrow = renderWith('YAxis:drill', 'tick', { payload: { value: 'FUEL' } })
    await user.click(within(categoryArrow.container).getByRole('button'))
    expect(onDrill).toHaveBeenCalledWith(['FUEL'])
  })

  it('drops the bar arrows inside a group when categories cannot be searched', async () => {
    renderCategory({ chartType: 'bar' })
    const arrow = renderWith('YAxis:drill', 'tick', { payload: { value: 'MOBILITY' } })
    chartProps.clear()

    await userEvent.click(within(arrow.container).getByRole('button'))

    expect(screen.getByText('Mobility')).toBeInTheDocument()
    expect(chartProps.has('YAxis:drill')).toBe(false)
  })

  it('closes an open group once its categories drop out of the data', () => {
    const props = { chartType: 'pie' as const, hidden: new Set<string>(), onToggleHidden: vi.fn() }
    const { rerender } = render(<CategoryChart slices={mobility} {...props} />)
    clickSlice(0)
    expect(pieKeys()).toEqual(['FUEL', 'PUBLIC_TRANSPORT'])

    rerender(<CategoryChart slices={[{ category: 'RENT', total: AMOUNT_S }]} {...props} />)

    expect(screen.queryByRole('button', { name: 'All categories' })).toBeNull()
    expect(pieKeys()).toEqual(['HOUSING'])
  })
})
