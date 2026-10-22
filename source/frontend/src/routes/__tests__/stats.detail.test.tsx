import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import '@/i18n'
import type { TransactionRead } from '@/lib/accountHistory'
import type { NetWorthRangeResponse } from '@/lib/statistics'
import {
  ACCOUNT_NAME_GIRO,
  AMOUNT_M,
  AMOUNT_S,
  DATE_RECENT,
  DATE_TODAY,
  DATE_YESTERDAY,
  PARTY_SUPERMARKET,
  TEST_IBAN,
  TEST_IBAN_FORMATTED,
  TODAY,
  money,
} from '@/test/constants'

const routerState = vi.hoisted(() => ({
  search: { account_ids: [42, 43], end: '2026-05-20' } as Record<string, unknown>,
  navigate: vi.fn(),
  back: vi.fn(),
  canGoBack: true,
}))

const hookState = vi.hoisted(() => ({
  loggedIn: true,
  range: undefined as unknown,
  rangeArgs: [] as unknown[],
}))

vi.mock('@tanstack/react-router', async () =>
  (await import('./-routerMock')).routerMocks({
    createFileRoute: () => (options: object) => ({
      options,
      useSearch: () => routerState.search,
    }),
    getRouteApi: () => ({
      useSearch: () => routerState.search,
    }),
    useNavigate: () => routerState.navigate,
    useRouter: () => ({ history: { back: routerState.back } }),
    useCanGoBack: () => routerState.canGoBack,
  }),
)

vi.mock('@/lib/auth', () => ({
  useAuthMe: () => ({
    data: hookState.loggedIn
      ? {
          credentials: [
            {
              id: 1,
              bank: 'ing',
              bank_name: null,
              bank_icon: null,
              last_successful_sync_timestamp: null,
              requires_two_factor_authentication: false,
              sync_enabled: true,
              accounts: [
                {
                  id: 42,
                  name: ACCOUNT_NAME_GIRO,
                  display_name: null,
                  balance: 130,
                  balance_factor: 100,
                  is_hidden: false,
                  include_by_default: true,
                },
                {
                  id: 43,
                  name: 'Depot',
                  display_name: null,
                  balance: 500,
                  balance_factor: 150,
                  is_hidden: false,
                  include_by_default: true,
                },
              ],
            },
          ],
        }
      : undefined,
  }),
}))

vi.mock('@/lib/accountGroups', () => ({
  useAccountGroupLayout: () => ({ data: undefined }),
}))

vi.mock(import('@/lib/statistics'), async (importOriginal) => ({
  // Keep the real module (preset helpers) and only stub the query hook.
  ...(await importOriginal()),
  useNetWorthRange: ((...args: unknown[]) => {
    hookState.rangeArgs = args
    return hookState.range
  }) as unknown as (typeof import('@/lib/statistics'))['useNetWorthRange'],
}))

import { NetWorthDetailPage } from '@/pages/stats_.detail'
import { Route } from '@/routes/stats_.detail'

function transaction(overrides: Partial<TransactionRead> & Pick<TransactionRead, 'id'>) {
  return {
    account_id: 42,
    amount: 30,
    purpose: null,
    date: DATE_RECENT,
    other_party: PARTY_SUPERMARKET,
    transaction_type: null,
    category: 'UNKNOWN',
    note: null,
    ...overrides,
  } as TransactionRead
}

function rangeResponse(overrides: Partial<NetWorthRangeResponse> = {}): NetWorthRangeResponse {
  return {
    start: '2026-05-19',
    end: DATE_RECENT,
    total_at_start: 475,
    total_at_end: 880,
    total_difference: 405,
    accounts: [
      {
        account_id: 42,
        balance_at_start: 100,
        balance_at_end: 130,
        difference: 30,
        transactions: [transaction({ id: 1 })],
      },
      {
        account_id: 43,
        balance_at_start: 250,
        balance_at_end: 500,
        difference: 250,
        transactions: [],
      },
    ],
    ...overrides,
  }
}

const loaded = (data: NetWorthRangeResponse) => ({ isLoading: false, isError: false, data })

const lastNavigation = () => routerState.navigate.mock.calls.at(-1)?.[0]

describe('NetWorthDetailPage', () => {
  beforeEach(() => {
    routerState.search = { account_ids: [42, 43], end: DATE_RECENT }
    routerState.canGoBack = true
    routerState.navigate.mockClear()
    routerState.back.mockClear()
    hookState.loggedIn = true
    hookState.range = loaded(rangeResponse())
  })

  it('returns through history so the stats filters are restored', async () => {
    render(<NetWorthDetailPage />)

    await userEvent.click(screen.getByRole('link', { name: 'Back' }))
    expect(routerState.back).toHaveBeenCalledTimes(1)
  })

  it('falls back to the stats link when there is no history to go back to', async () => {
    routerState.canGoBack = false
    render(<NetWorthDetailPage />)

    const back = screen.getByRole('link', { name: 'Back' })
    expect(back).toHaveAttribute('href', '/stats')
    await userEvent.click(back)
    expect(routerState.back).not.toHaveBeenCalled()
  })

  it('keeps a row collapsed until it is in the expanded URL state', async () => {
    render(<NetWorthDetailPage />)

    expect(screen.getByText(ACCOUNT_NAME_GIRO)).toBeInTheDocument()
    expect(screen.getByText('Depot')).toBeInTheDocument()
    expect(screen.queryByText(PARTY_SUPERMARKET)).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: new RegExp(ACCOUNT_NAME_GIRO) }))
    expect(routerState.navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '/stats/detail',
        replace: true,
        search: expect.objectContaining({ expanded: [42] }),
      }),
    )
  })

  it('reveals the transactions of rows listed in the expanded URL state', () => {
    routerState.search = { account_ids: [42, 43], end: DATE_RECENT, expanded: [42, 43] }
    render(<NetWorthDetailPage />)

    expect(screen.getByText(PARTY_SUPERMARKET)).toBeInTheDocument()
    // The depot has no transactions to explain its market-driven change.
    expect(screen.getByText('No transactions in this period')).toBeInTheDocument()
  })

  it('removes a collapsed row from the URL and drops the param once none is open', async () => {
    routerState.search = { account_ids: [42, 43], end: DATE_RECENT, expanded: [42] }
    render(<NetWorthDetailPage />)

    await userEvent.click(screen.getByRole('button', { name: new RegExp(ACCOUNT_NAME_GIRO) }))

    expect(lastNavigation().search).toEqual({
      account_ids: [42, 43],
      end: DATE_RECENT,
      expanded: undefined,
    })
  })

  it('weighs the total by each account balance factor and shows the factor', async () => {
    render(<NetWorthDetailPage />)

    expect(screen.getByText('x 1,50')).toBeInTheDocument()

    // Total at end = 130 * 1.0 + 500 * 1.5 = 880; difference = 30 * 1.0 + 250 * 1.5 = 405.
    expect(screen.getByText(money(880))).toBeInTheDocument()
    expect(screen.getByText(`+${money(405)}`)).toBeInTheDocument()
  })

  it('colours a loss red and leaves an unchanged account neutral', () => {
    hookState.range = loaded(
      rangeResponse({
        total_difference: -AMOUNT_M,
        accounts: [
          {
            account_id: 42,
            balance_at_start: null,
            balance_at_end: null,
            difference: -AMOUNT_M,
            transactions: [],
          },
        ],
      }),
    )
    render(<NetWorthDetailPage />)

    const giro = screen.getByRole('button', { name: new RegExp(ACCOUNT_NAME_GIRO) })
    expect(within(giro).getByText(money(-AMOUNT_M))).toHaveClass('text-destructive')
    const depot = screen.getByRole('button', { name: /Depot/ })
    expect(depot).toHaveTextContent(`${money(0)} → ${money(0)}`)
    expect(within(depot).getByText(money(0))).toHaveClass('text-muted-foreground')
  })

  it('lists transactions in the chosen order with purpose and a readable party', () => {
    routerState.search = {
      account_ids: [42],
      end: DATE_RECENT,
      expanded: [42],
      sort: 'amount_asc',
    }
    hookState.range = loaded(
      rangeResponse({
        accounts: [
          {
            account_id: 42,
            balance_at_start: 100,
            balance_at_end: 130,
            difference: 30,
            transactions: [
              transaction({ id: 1, amount: AMOUNT_M, other_party: TEST_IBAN, purpose: 'Refund' }),
              transaction({ id: 2, amount: -AMOUNT_S, other_party: '  ' }),
            ],
          },
        ],
      }),
    )
    render(<NetWorthDetailPage />)

    const rows = screen.getAllByRole('link', { name: /€/ })
    expect(rows.map((row) => row.getAttribute('href'))).toEqual([
      '/transactions/2',
      '/transactions/1',
    ])
    expect(rows[0]).toHaveTextContent('Unknown')
    expect(rows[1]).toHaveTextContent(TEST_IBAN_FORMATTED)
    expect(rows[1]).toHaveTextContent('Refund')
  })

  it('stores a picked sort order in the URL and drops it for the default', async () => {
    const user = userEvent.setup()
    routerState.search = { account_ids: [42], end: DATE_RECENT, sort: 'amount_asc' }
    render(<NetWorthDetailPage />)

    const pickSort = async (label: string) => {
      await user.click(screen.getAllByLabelText('Sort')[0])
      const list = await screen.findByRole('list', { name: 'Sort' })
      await user.click(within(list).getByRole('button', { name: label }))
    }

    await pickSort('Oldest first')
    expect(lastNavigation()).toEqual({
      to: '/stats/detail',
      search: { account_ids: [42], end: DATE_RECENT, sort: 'date_asc' },
      replace: true,
    })

    await pickSort('Newest first')
    expect(lastNavigation().search.sort).toBeUndefined()
  })

  it('shows loading, error and empty states', () => {
    hookState.range = { isLoading: true, isError: false, data: undefined }
    const { unmount } = render(<NetWorthDetailPage />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    unmount()

    hookState.range = { isLoading: false, isError: true, data: undefined }
    const errored = render(<NetWorthDetailPage />)
    expect(screen.getByText('Could not load the breakdown.')).toBeInTheDocument()
    errored.unmount()

    routerState.search = {}
    hookState.range = { isLoading: false, isError: false, data: undefined }
    render(<NetWorthDetailPage />)
    expect(screen.getByText('No data for this period.')).toBeInTheDocument()
  })

  it('omits the total until the breakdown has loaded', () => {
    hookState.range = { isLoading: false, isError: false, data: undefined }
    render(<NetWorthDetailPage />)

    expect(screen.getByText(ACCOUNT_NAME_GIRO)).toBeInTheDocument()
    expect(screen.queryByText('Total')).toBeNull()
  })

  it('renders nothing until the user is known', () => {
    hookState.loggedIn = false
    const { container } = render(<NetWorthDetailPage />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('NetWorthDetailPage range', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(TODAY)
    routerState.navigate.mockClear()
    hookState.loggedIn = true
    hookState.range = loaded(rangeResponse())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function pickDay(user: ReturnType<typeof userEvent.setup>, field: string, day: RegExp) {
    await user.click(screen.getByLabelText(field))
    await user.click(await screen.findByRole('button', { name: day }))
  }

  it('defaults to the change since yesterday', () => {
    routerState.search = { account_ids: [42] }
    render(<NetWorthDetailPage />)

    expect(hookState.rangeArgs).toEqual([DATE_YESTERDAY, DATE_TODAY, [42]])
    expect(screen.getByRole('button', { name: '1D' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('applies a range preset ending today', async () => {
    const user = userEvent.setup()
    routerState.search = { account_ids: [42], end: DATE_RECENT, expanded: [42] }
    render(<NetWorthDetailPage />)

    await user.click(screen.getByRole('button', { name: '1W' }))

    expect(lastNavigation()).toEqual({
      to: '/stats/detail',
      search: { account_ids: [42], expanded: [42], start: '2026-05-15', end: DATE_TODAY },
      replace: true,
    })
  })

  it('keeps the start no later than the end', async () => {
    const user = userEvent.setup()
    routerState.search = { account_ids: [42], start: DATE_RECENT, end: DATE_YESTERDAY }
    render(<NetWorthDetailPage />)

    await pickDay(user, 'From date', /May 22nd, 2026/)

    expect(lastNavigation().search).toEqual({
      account_ids: [42],
      start: DATE_YESTERDAY,
      end: DATE_YESTERDAY,
    })
  })

  it('moves the start along with the picked start day', async () => {
    const user = userEvent.setup()
    routerState.search = { account_ids: [42], end: DATE_YESTERDAY }
    render(<NetWorthDetailPage />)

    await pickDay(user, 'From date', /May 15th, 2026/)

    expect(lastNavigation().search).toEqual({
      account_ids: [42],
      start: '2026-05-15',
      end: DATE_YESTERDAY,
    })
  })

  it('keeps an explicit start only while it still precedes the new end', async () => {
    const user = userEvent.setup()
    routerState.search = { account_ids: [42], start: DATE_RECENT, end: DATE_YESTERDAY }
    const { unmount } = render(<NetWorthDetailPage />)

    await pickDay(user, 'To date', /May 22nd, 2026/)
    expect(lastNavigation().search).toEqual({
      account_ids: [42],
      start: DATE_RECENT,
      end: DATE_TODAY,
    })
    unmount()

    render(<NetWorthDetailPage />)
    await pickDay(user, 'To date', /May 15th, 2026/)
    expect(lastNavigation().search).toEqual({
      account_ids: [42],
      start: undefined,
      end: '2026-05-15',
    })
  })

  it('ignores re-picking the current end day', async () => {
    const user = userEvent.setup()
    routerState.search = { account_ids: [42], end: DATE_YESTERDAY }
    render(<NetWorthDetailPage />)

    await pickDay(user, 'To date', /May 21st, 2026/)

    expect(routerState.navigate).not.toHaveBeenCalled()
  })
})

describe('stats detail route', () => {
  it('parses ids and the sort order from the URL', () => {
    const validate = Route.options.validateSearch as (search: object) => unknown

    expect(
      validate({ account_ids: '42', expanded: ['42', '43'], sort: 'amount_asc', end: DATE_RECENT }),
    ).toEqual({ account_ids: [42], expanded: [42, 43], sort: 'amount_asc', end: DATE_RECENT })
    expect(() => validate({ sort: 'sideways' })).toThrow()
  })

  it('renders the breakdown page', () => {
    routerState.search = { account_ids: [42], end: DATE_RECENT }
    hookState.loggedIn = true
    hookState.range = loaded(rangeResponse())
    const Component = Route.options.component!
    render(<Component />)

    expect(screen.getByRole('heading', { name: 'Net worth change' })).toBeInTheDocument()
  })
})
