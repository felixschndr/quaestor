import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import '@/i18n'
import { selectFromPopover } from '@/test/popover-select'
import type { CredentialRead } from '@/lib/auth'

const { apiResponses, chartProps, navigate } = vi.hoisted(() => ({
  apiResponses: {} as Record<string, unknown>,
  chartProps: new Map<string, Record<string, unknown>>(),
  navigate: vi.fn(),
}))

vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>()
  const capture = (name: string) =>
    function Captured(props: Record<string, unknown>) {
      const id = props.yAxisId ?? props.dataKey
      chartProps.set(id === undefined ? name : `${name}:${String(id)}`, props)
      return <div>{props.children as React.ReactNode}</div>
    }
  const captured = [
    'ResponsiveContainer',
    'BarChart',
    'ComposedChart',
    'LineChart',
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
    'ReferenceArea',
    'ReferenceDot',
    'ReferenceLine',
  ]
  return { ...actual, ...Object.fromEntries(captured.map((name) => [name, capture(name)])) }
})

vi.mock('@/lib/api', () => ({
  api: vi.fn((path: string) => {
    const response = apiResponses[path.split('?')[0]]
    if (response instanceof Error) return Promise.reject(response)
    if (response !== undefined) return Promise.resolve(response)
    return Promise.resolve(path.includes('/net-worth') ? { series: [], summary: null } : [])
  }),
}))

vi.mock('@tanstack/react-router', async () =>
  (await import('./-routerMock')).routerMocks({ useNavigate: () => navigate }),
)

import { useState } from 'react'

import { api } from '@/lib/api'
import { STORAGE_KEY } from '@/lib/netWorthPin'
import { TRANSACTION_CATEGORIES, TRANSACTION_TYPES } from '@/lib/transaction'
import { StatsView } from '@/pages/stats'
import { Route, type StatsSearchParams, type StatsViewState } from '@/routes/stats'
import {
  ACCOUNT_NAME_GIRO,
  ACCOUNT_NAME_SAVINGS,
  AMOUNT_L,
  AMOUNT_M,
  AMOUNT_S,
  AMOUNT_XL,
  DATE_RECENT,
  DATE_TODAY,
  PARTY_SUPERMARKET,
  TODAY,
} from '@/test/constants'
import { buildAccount, buildCredential } from '@/test/statsFixtures'
import { routeState } from './-routerMock'
import { buildUser } from './-settingsUserTestHelpers'

const credentials: CredentialRead[] = [
  {
    id: 1,
    bank: 'ing',
    bank_name: null,
    bank_icon: null,
    accounts: [
      {
        id: 42,
        name: ACCOUNT_NAME_GIRO,
        balance: 0,
        balance_factor: 100,
        display_name: null,
        is_archived: false,
        include_by_default: true,
        is_market_valued: false,
      },
    ],
    last_successful_sync_timestamp: null,
    requires_two_factor_authentication: false,
    sync_enabled: true,
  },
]

const MONTH_START = '2026-04-22'
const TWO_WEEKS_START = '2026-05-08'
const TEN_DAYS_START = '2026-05-12'
const RUNWAY_EXCLUDED = ['SAVINGS', 'INVESTMENT']

function toSearch(next: StatsViewState): StatsSearchParams {
  return {
    account_ids: next.accountIds,
    date_from: next.filters.date_from,
    date_to: next.filters.date_to,
    chart_type: next.chartType,
    count_group: next.countGroup,
    trend_periods: next.trendPeriods,
    direction: next.direction,
    transaction_types:
      next.transactionTypes.length === TRANSACTION_TYPES.length ? undefined : next.transactionTypes,
    categories:
      next.categories.length === TRANSACTION_CATEGORIES.length ? undefined : next.categories,
  }
}

function renderView(initialSearch: Partial<StatsSearchParams> = {}) {
  const onChange = vi.fn()
  const onOpenSearch = vi.fn()
  const onOpenDay = vi.fn()
  const onOpenRange = vi.fn()
  const onOpenBalance = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  function Harness() {
    const [search, setSearch] = useState<StatsSearchParams>(initialSearch as StatsSearchParams)
    return (
      <StatsView
        credentials={credentials}
        search={search}
        onChange={(next) => {
          onChange(next)
          setSearch(toSearch(next))
        }}
        onOpenSearch={onOpenSearch}
        onOpenDay={onOpenDay}
        onOpenRange={onOpenRange}
        onOpenBalance={onOpenBalance}
      />
    )
  }

  render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  )
  return { onChange, onOpenSearch, onOpenDay, onOpenRange, onOpenBalance }
}

const lastCall = (mock: ReturnType<typeof vi.fn>) => mock.mock.calls.at(-1)?.[0]
const requestedPaths = () => vi.mocked(api).mock.calls.map(([path]) => path)

beforeEach(() => {
  for (const key of Object.keys(apiResponses)) delete apiResponses[key]
  chartProps.clear()
  navigate.mockClear()
  vi.mocked(api).mockClear()
  sessionStorage.clear()
  routeState.search = {}
})

describe('StatsView', () => {
  it('renders the filter controls and chart sections', () => {
    renderView()
    expect(screen.getByRole('heading', { name: 'Statistics' })).toBeInTheDocument()
    expect(screen.getByLabelText('Accounts')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Direction' })).toBeInTheDocument()
    expect(screen.getByLabelText('Chart type')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'By category' })).toBeInTheDocument()
    // Default direction is OUTGOING → recipients.
    expect(screen.getByRole('heading', { name: 'Top recipients' })).toBeInTheDocument()
  })

  it('switches the other-party title to senders for income', async () => {
    const user = userEvent.setup()
    renderView()
    await user.click(screen.getByRole('button', { name: 'Income' }))
    expect(screen.getByRole('heading', { name: 'Top senders' })).toBeInTheDocument()
  })

  it('fires onChange with direction INCOMING when switching to Income', async () => {
    const user = userEvent.setup()
    const { onChange } = renderView()

    await user.click(screen.getByRole('button', { name: 'Income' }))

    expect(onChange).toHaveBeenCalled()
    expect(onChange.mock.calls.at(-1)?.[0].direction).toBe('INCOMING')
  })

  it('renders the category and type filters together', () => {
    renderView()
    expect(screen.getByLabelText('Categories')).toBeInTheDocument()
    expect(screen.getByLabelText('Type')).toBeInTheDocument()
  })

  it('fires onChange with the picked transaction types', async () => {
    const user = userEvent.setup()
    const { onChange } = renderView()

    await user.click(screen.getByLabelText('Type'))
    await user.click(screen.getByRole('button', { name: 'None' }))
    await user.click(document.getElementById('type-multi-FEES')!)

    expect(onChange.mock.calls.at(-1)?.[0].transactionTypes).toEqual(['FEES'])
  })

  it('has no related filter (net-zero groups are hidden automatically)', () => {
    renderView()
    expect(screen.queryByLabelText('Related transactions')).toBeNull()
  })

  it('fires onChange with chartType pie when switching the category chart to Pie', async () => {
    const user = userEvent.setup()
    const { onChange } = renderView()

    await selectFromPopover(user, 'Chart type', 'Pie')

    expect(onChange.mock.calls.at(-1)?.[0].chartType).toBe('pie')
  })

  it('opens the search for every net-worth transaction (no direction/category) via the arrow', async () => {
    const user = userEvent.setup()
    const { onOpenSearch } = renderView()

    await user.click(screen.getByRole('button', { name: 'Transactions in this period' }))

    expect(onOpenSearch).toHaveBeenCalledTimes(1)
    const drill = onOpenSearch.mock.calls[0][0]
    expect(drill.accountIds).toEqual([42])
    expect(drill.direction).toBeUndefined()
    expect(drill.category).toBeUndefined()
  })

  it('defaults direction to OUTGOING (expense focus)', async () => {
    const user = userEvent.setup()
    const { onChange } = renderView()

    // Any change echoes the current state; direction starts as OUTGOING.
    await selectFromPopover(user, 'Chart type', 'Bar')

    expect(onChange.mock.calls.at(-1)?.[0].direction).toBe('OUTGOING')
  })
})

describe('StatsView with a fixed today', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(TODAY)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('filters', () => {
    it('offers a reset only while a filter deviates, and resets all of them', async () => {
      const user = userEvent.setup()
      const { onChange } = renderView({
        direction: 'INCOMING',
        categories: ['FUEL'],
        hidden_parties: [PARTY_SUPERMARKET],
      })

      await user.click(screen.getByRole('button', { name: 'Reset filters' }))

      expect(lastCall(onChange)).toEqual(
        expect.objectContaining({
          accountIds: [42],
          filters: { date_from: MONTH_START, date_to: DATE_TODAY },
          direction: 'OUTGOING',
          categories: [...TRANSACTION_CATEGORIES],
          transactionTypes: [...TRANSACTION_TYPES],
          hiddenCategories: [],
          hiddenParties: [],
        }),
      )
      expect(screen.queryByRole('button', { name: 'Reset filters' })).toBeNull()
    })

    it('applies a date range preset', async () => {
      const user = userEvent.setup()
      const { onChange } = renderView()
      expect(screen.getByRole('button', { name: '1M' })).toHaveAttribute('aria-pressed', 'true')

      await user.click(screen.getByRole('button', { name: '3M' }))

      expect(lastCall(onChange).filters).toEqual({ date_from: '2026-02-22', date_to: DATE_TODAY })
      expect(screen.getByRole('button', { name: '3M' })).toHaveAttribute('aria-pressed', 'true')
    })

    it('takes custom start and end days from the date pickers', async () => {
      const user = userEvent.setup()
      const { onChange } = renderView()

      await user.click(screen.getByLabelText('From date'))
      await user.click(await screen.findByRole('button', { name: /April 15th, 2026/ }))
      expect(lastCall(onChange).filters).toEqual({ date_from: '2026-04-15', date_to: DATE_TODAY })

      await user.click(screen.getByLabelText('To date'))
      await user.click(await screen.findByRole('button', { name: /May 20th, 2026/ }))
      expect(lastCall(onChange).filters).toEqual({ date_from: '2026-04-15', date_to: DATE_RECENT })
    })

    it('shows no charts once no account is selected', async () => {
      const user = userEvent.setup()
      const { onChange } = renderView()

      await user.click(screen.getByLabelText('Accounts'))
      await user.click(document.getElementById('account-multi-42')!)

      expect(lastCall(onChange).accountIds).toEqual([])
      expect(screen.getByText('No data matches your filters.')).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'By category' })).toBeNull()
    })

    it('shows no charts once no category is selected', async () => {
      const user = userEvent.setup()
      const { onChange } = renderView()

      await user.click(screen.getByLabelText('Categories'))
      await user.click(screen.getByRole('button', { name: 'None' }))

      expect(lastCall(onChange).categories).toEqual([])
      expect(screen.getByText('No data matches your filters.')).toBeInTheDocument()
    })
  })

  describe('category trend', () => {
    beforeEach(() => {
      apiResponses['/statistics/categories/trend'] = [
        { category: 'FUEL', current: AMOUNT_M, baseline: AMOUNT_L },
      ]
    })

    it('compares the range with its average over the chosen multiple', async () => {
      renderView({ chart_type: 'trend' })

      expect(await screen.findByText('Fuel')).toBeInTheDocument()
      expect(
        screen.getByText('Compared to the average of the previous 6 months'),
      ).toBeInTheDocument()
      expect(requestedPaths().some((path) => path.startsWith('/statistics/categories?'))).toBe(
        false,
      )
      const trendRequest = requestedPaths().find((path) =>
        path.startsWith('/statistics/categories/trend?'),
      )!
      expect(new URLSearchParams(trendRequest.split('?')[1]).get('baseline_windows')).toBe('6')
    })

    it.each([
      [TWO_WEEKS_START, 'Compared to the average of the previous 12 weeks'],
      [TEN_DAYS_START, 'Compared to the average of the previous 6×10=60 days'],
    ])('describes the baseline for a range starting %s', async (dateFrom, hint) => {
      renderView({ chart_type: 'trend', date_from: dateFrom, date_to: DATE_TODAY })
      expect(await screen.findByText(hint)).toBeInTheDocument()
    })

    it('changes the baseline multiple', async () => {
      const user = userEvent.setup()
      const { onChange } = renderView({ chart_type: 'trend' })
      await screen.findByText('Fuel')
      const periods = screen.getByRole('group', { name: 'Multiple of the range selected above' })

      await user.click(within(periods).getByRole('button', { name: '12' }))

      expect(lastCall(onChange).trendPeriods).toBe(12)
      expect(within(periods).getByRole('button', { name: '12' })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
    })

    it('drills into the current range and into the baseline range', async () => {
      const user = userEvent.setup()
      const { onOpenSearch } = renderView({ chart_type: 'trend' })
      const row = (await screen.findByText('Fuel')).closest('tr')!

      await user.click(row)
      await user.click(within(row).getByRole('button'))

      const common = {
        accountIds: [42],
        direction: 'OUTGOING',
        transactionTypes: [],
        categories: ['FUEL'],
        sort: 'amount_asc',
      }
      expect(onOpenSearch.mock.calls).toEqual([
        [{ ...common, dateFrom: MONTH_START, dateTo: DATE_TODAY }],
        [{ ...common, dateFrom: '2025-10-18', dateTo: '2026-04-21' }],
      ])
    })
  })

  describe('transaction counts', () => {
    it('regroups the counts and switches the metric', async () => {
      const user = userEvent.setup()
      apiResponses['/statistics/transaction-counts'] = [
        { bucket: DATE_TODAY, count: 1, amount: AMOUNT_S },
      ]
      const { onChange } = renderView()
      await waitFor(() => expect(chartProps.get('Bar:value')?.name).toBe('Transactions'))

      await user.click(screen.getByRole('button', { name: 'Amount' }))
      expect(chartProps.get('Bar:value')?.name).toBe('Amount')

      await selectFromPopover(user, 'Grouping', 'Per week')
      expect(lastCall(onChange).countGroup).toBe('week')
      const counts = requestedPaths().filter((path) =>
        path.startsWith('/statistics/transaction-counts?'),
      )
      expect(new URLSearchParams(counts.at(-1)!.split('?')[1]).get('group_by')).toBe('week')
    })
  })

  describe('drill-downs', () => {
    beforeEach(() => {
      apiResponses['/statistics/cashflow'] = [
        { month: '2026-05', income: AMOUNT_XL, expenses: AMOUNT_L },
      ]
    })

    it('opens the clicked cashflow month in the bar’s direction', async () => {
      const { onOpenSearch } = renderView()
      await waitFor(() => expect(chartProps.has('Bar:expenses')).toBe(true))
      const click = (bar: string) =>
        act(() => (chartProps.get(bar)!.onClick as (data: unknown, index: number) => void)({}, 0))

      click('Bar:expenses')
      click('Bar:income')

      expect(onOpenSearch.mock.calls.map(([drill]) => drill)).toEqual([
        expect.objectContaining({
          dateFrom: '2026-05-01',
          dateTo: '2026-05-31',
          direction: 'OUTGOING',
          sort: 'amount_asc',
        }),
        expect.objectContaining({
          dateFrom: '2026-05-01',
          dateTo: '2026-05-31',
          direction: 'INCOMING',
          sort: 'amount_desc',
        }),
      ])
    })

    it('opens the runway expenses without savings and the balances', async () => {
      const user = userEvent.setup()
      const { onOpenSearch, onOpenBalance } = renderView({ transaction_types: ['FEES'] })
      const expenses = await screen.findAllByRole('button', { name: 'Expenses in this period' })

      await user.click(expenses[0])
      await user.click(screen.getAllByRole('button', { name: 'Current balances' })[0])

      expect(lastCall(onOpenSearch)).toEqual({
        accountIds: [42],
        dateFrom: MONTH_START,
        dateTo: DATE_TODAY,
        direction: 'OUTGOING',
        transactionTypes: ['FEES'],
        categories: TRANSACTION_CATEGORIES.filter((key) => !RUNWAY_EXCLUDED.includes(key)),
        sort: 'amount_asc',
      })
      expect(onOpenBalance).toHaveBeenCalledWith([42])
    })

    it('opens the net-worth breakdown of the shown range or the pinned day', async () => {
      const user = userEvent.setup()
      apiResponses['/statistics/net-worth'] = {
        series: [
          { date: DATE_RECENT, value: AMOUNT_L },
          { date: DATE_TODAY, value: AMOUNT_XL },
        ],
        summary: null,
      }
      const { onOpenRange } = renderView()
      await user.click(await screen.findByRole('button', { name: /Break down this range/ }))
      expect(onOpenRange).toHaveBeenCalledWith(DATE_RECENT, DATE_TODAY, [42])
    })

    it('opens the breakdown of a day pinned earlier', async () => {
      const user = userEvent.setup()
      apiResponses['/statistics/net-worth'] = {
        series: [
          { date: DATE_RECENT, value: AMOUNT_L },
          { date: DATE_TODAY, value: AMOUNT_XL },
        ],
        summary: null,
      }
      sessionStorage.setItem(STORAGE_KEY, DATE_RECENT)
      const { onOpenDay } = renderView()

      await user.click(await screen.findByRole('button', { name: /Break down this day/ }))

      expect(onOpenDay).toHaveBeenCalledWith(DATE_RECENT, [42])
    })
  })
})

describe('stats route', () => {
  const routeUser = buildUser({
    credentials: [
      buildCredential([
        buildAccount({ id: 42, name: ACCOUNT_NAME_GIRO }),
        buildAccount({ id: 43, name: ACCOUNT_NAME_SAVINGS, include_by_default: false }),
      ]),
    ],
  })

  function renderRoute() {
    const Page = Route.options.component!
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
      <QueryClientProvider client={client}>
        <Page />
      </QueryClientProvider>,
    )
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(TODAY)
    apiResponses['/auth/me'] = routeUser
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders nothing until the user is known', async () => {
    apiResponses['/auth/me'] = new Error('unauthorized')
    const { container } = renderRoute()

    await waitFor(() => expect(requestedPaths()).toContain('/auth/me'))
    expect(container).toBeEmptyDOMElement()
  })

  it('writes a change into the URL and leaves the defaults out', async () => {
    const user = userEvent.setup()
    renderRoute()

    await user.click(await screen.findByRole('button', { name: 'Income' }))

    expect(navigate).toHaveBeenLastCalledWith({
      search: {
        account_ids: undefined,
        date_from: MONTH_START,
        date_to: DATE_TODAY,
        chart_type: 'bar',
        count_group: 'day',
        trend_periods: 6,
        direction: 'INCOMING',
        transaction_types: undefined,
        categories: undefined,
        hidden_categories: undefined,
        hidden_parties: undefined,
      },
      replace: true,
      resetScroll: false,
    })
  })

  it('keeps a narrowed selection in the URL', async () => {
    const user = userEvent.setup()
    routeState.search = {
      account_ids: [42, 43],
      transaction_types: ['FEES'],
      categories: ['FUEL'],
      hidden_categories: ['MOBILITY'],
      hidden_parties: [PARTY_SUPERMARKET],
    }
    renderRoute()

    await user.click(await screen.findByRole('button', { name: 'Income' }))

    expect(navigate.mock.calls.at(-1)?.[0].search).toEqual(
      expect.objectContaining({
        account_ids: [42, 43],
        transaction_types: ['FEES'],
        categories: ['FUEL'],
        hidden_categories: ['MOBILITY'],
        hidden_parties: [PARTY_SUPERMARKET],
      }),
    )
  })

  it('opens the transaction search for every net-worth transaction', async () => {
    const user = userEvent.setup()
    renderRoute()

    await user.click(await screen.findByRole('button', { name: 'Transactions in this period' }))

    expect(navigate).toHaveBeenLastCalledWith({
      to: '/search',
      search: {
        account_ids: [42],
        date_from: MONTH_START,
        date_to: DATE_TODAY,
        categories: undefined,
        text: undefined,
        transaction_types: undefined,
        amount_from: undefined,
        amount_to: undefined,
        sort: undefined,
      },
    })
  })

  it('limits an income drill to positive amounts, biggest first', async () => {
    const user = userEvent.setup()
    routeState.search = { direction: 'INCOMING', chart_type: 'trend' }
    apiResponses['/statistics/categories/trend'] = [
      { category: 'SALARY', current: AMOUNT_XL, baseline: AMOUNT_XL },
    ]
    renderRoute()

    await user.click(await screen.findByText('Salary'))

    expect(navigate.mock.calls.at(-1)?.[0]).toEqual({
      to: '/search',
      search: expect.objectContaining({
        categories: ['SALARY'],
        amount_from: 0,
        amount_to: undefined,
        sort: 'amount_desc',
      }),
    })
  })

  it('limits an expense drill to negative amounts and keeps the type filter', async () => {
    const user = userEvent.setup()
    routeState.search = { transaction_types: ['FEES'] }
    apiResponses['/statistics/cashflow'] = [
      { month: '2026-05', income: AMOUNT_XL, expenses: AMOUNT_L },
    ]
    renderRoute()

    await user.click((await screen.findAllByRole('button', { name: 'Expenses in this period' }))[0])

    expect(navigate.mock.calls.at(-1)?.[0].search).toEqual(
      expect.objectContaining({
        transaction_types: ['FEES'],
        amount_from: undefined,
        amount_to: 0,
        sort: 'amount_asc',
      }),
    )
  })

  it('opens the net-worth breakdown of a range, of a day and the balances', async () => {
    const user = userEvent.setup()
    apiResponses['/statistics/net-worth'] = {
      series: [
        { date: DATE_RECENT, value: AMOUNT_L },
        { date: DATE_TODAY, value: AMOUNT_XL },
      ],
      summary: null,
    }
    apiResponses['/statistics/cashflow'] = [
      { month: '2026-05', income: AMOUNT_XL, expenses: AMOUNT_L },
    ]
    renderRoute()

    await user.click(await screen.findByRole('button', { name: /Break down this range/ }))
    expect(navigate).toHaveBeenLastCalledWith({
      to: '/stats/detail',
      search: { start: DATE_RECENT, end: DATE_TODAY, account_ids: [42] },
    })

    act(() =>
      (chartProps.get('LineChart')!.onClick as (state: object) => void)({ activeTooltipIndex: 0 }),
    )
    await user.click(screen.getByRole('button', { name: /Break down this day/ }))
    expect(navigate).toHaveBeenLastCalledWith({
      to: '/stats/detail',
      search: { end: DATE_RECENT, account_ids: [42] },
    })

    await user.click((await screen.findAllByRole('button', { name: 'Current balances' }))[0])
    expect(navigate).toHaveBeenLastCalledWith({
      to: '/stats/balance',
      search: { account_ids: [42] },
    })
  })

  it('parses the URL and drops hidden categories it does not know', () => {
    const validate = Route.options.validateSearch as (search: object) => unknown

    expect(
      validate({
        account_ids: '42',
        trend_periods: '12',
        hidden_categories: ['MOBILITY', 'RETIRED', 'CUSTOM_0A1B2C3D'],
        hidden_parties: 5,
      }),
    ).toEqual({
      account_ids: [42],
      trend_periods: 12,
      hidden_categories: ['MOBILITY', 'CUSTOM_0A1B2C3D'],
      hidden_parties: ['5'],
    })
    expect(() => validate({ chart_type: 'donut' })).toThrow()
  })
})
