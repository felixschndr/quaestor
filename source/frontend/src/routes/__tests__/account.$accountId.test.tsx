import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import '@/i18n'
import type { AccountRead, CredentialRead, UseCredentialSyncResult } from '@/lib/auth'
import type { AccountHistoryPage, TransactionRead } from '@/lib/accountHistory'

const { mockUseAuthMe, mockUseCredentialSync, routerPush, toast } = vi.hoisted(() => ({
  mockUseAuthMe: vi.fn(),
  mockUseCredentialSync: vi.fn(),
  routerPush: vi.fn(),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }),
}))

vi.mock('@tanstack/react-router', async () =>
  (await import('./-routerMock')).routerMocks({
    useRouter: () => ({ history: { back: () => {}, push: routerPush } }),
  }),
)
vi.mock('sonner', () => ({ toast }))
vi.mock('@/lib/auth', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/auth')>()),
  useAuthMe: mockUseAuthMe,
  useCredentialSync: mockUseCredentialSync,
}))

const { mockUseExpectedTransactions } = vi.hoisted(() => ({
  mockUseExpectedTransactions: vi.fn(),
}))
vi.mock('@/lib/expectedTransaction', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/expectedTransaction')>()),
  useExpectedTransactions: mockUseExpectedTransactions,
}))

import { AccountDetailView } from '@/pages/account.$accountId'
import { Route } from '@/routes/account.$accountId'
import { ApiError } from '@/lib/api'
import { OFFLINE_BANNER_RESIZE_EVENT } from '@/components/offline-banner'
import { STORAGE_KEY } from '@/lib/collapsedGroups'
import { formatDateWithoutYear } from '@/lib/format'
import type { ExpectedTransactionRead } from '@/lib/expectedTransaction'
import { routeState } from './-routerMock'
import { buildUser, jsonResponse, renderWithQuery } from './-settingsUserTestHelpers'
import {
  ACCOUNT_NAME_CHECKING,
  AMOUNT_L,
  AMOUNT_M,
  AMOUNT_S,
  AMOUNT_XL,
  DATETIME_RECENT,
  DATETIME_UPDATED,
  DATE_MID_MONTH,
  DATE_NEXT_RUN,
  DATE_OLDER,
  DATE_TODAY,
  DATE_YESTERDAY,
  LABEL_RENT,
  PARTY_SUPERMARKET,
  SHARE_OWNER_NAME,
  TEST_BALANCE,
  TEST_IBAN,
  TEST_IBAN_FORMATTED,
  TODAY,
  TWO_FACTOR_CODE,
  money,
} from '@/test/constants'

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
  if (typeof globalThis.IntersectionObserver === 'undefined') {
    class NoopIntersectionObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.IntersectionObserver =
      NoopIntersectionObserver as unknown as typeof IntersectionObserver
  }
})

function scrollTo(y: number) {
  Object.defineProperty(window, 'scrollY', { value: y, writable: true, configurable: true })
  fireEvent.scroll(window)
}

beforeEach(() => {
  mockUseExpectedTransactions.mockReturnValue({ data: undefined })
  globalThis.fetch = vi.fn(() => new Promise<Response>(() => {})) as unknown as typeof fetch
  scrollTo(0)
  toast.mockClear()
  toast.success.mockClear()
  toast.error.mockClear()
  routerPush.mockClear()
  window.localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function serve(routes: Record<string, unknown>) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const route = routes[`${method} ${url}`] ?? routes[`${method} ${url.split('?')[0]}`]
    if (route === undefined) return new Promise<Response>(() => {})
    return Promise.resolve(
      typeof route === 'function'
        ? (route as () => Response)()
        : jsonResponse({ status: 200, body: route }),
    )
  })
  globalThis.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

function requestsTo(fetchMock: ReturnType<typeof serve>, method: string) {
  return fetchMock.mock.calls
    .filter(([, init]) => (init?.method ?? 'GET') === method)
    .map(([input, init]) => ({
      url: String(input),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    }))
}

function stubIntersectionObserver() {
  const callbacks: IntersectionObserverCallback[] = []
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        callbacks.push(callback)
      }
      observe() {}
      disconnect() {}
    },
  )
  return (isIntersecting: boolean) =>
    act(() => {
      for (const callback of callbacks) {
        callback(
          [{ isIntersecting } as IntersectionObserverEntry],
          {} as unknown as IntersectionObserver,
        )
      }
    })
}

const account: AccountRead = {
  id: 42,
  name: ACCOUNT_NAME_CHECKING,
  display_name: null,
  balance: TEST_BALANCE,
  balance_factor: 100,
  is_hidden: false,
  include_by_default: true,
  is_market_valued: false,
}

function buildTransaction(overrides: Partial<TransactionRead> = {}): TransactionRead {
  return {
    id: 1,
    account_id: 42,
    amount: 0,
    purpose: null,
    date: DATE_TODAY,
    other_party: null,
    transaction_type: null,
    category: 'UNKNOWN',
    note: null,
    ...overrides,
  }
}

function withClient(ui: React.ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
}

function buildPage(overrides: Partial<AccountHistoryPage> = {}): AccountHistoryPage {
  return {
    transactions: [],
    balance_at_date: {},
    page: 1,
    page_size: 30,
    total_days: 0,
    ...overrides,
  }
}

function renderView(pages: AccountHistoryPage[], opts: { hasNextPage?: boolean } = {}) {
  const onLoadMore = vi.fn()
  const view = render(
    withClient(
      <AccountDetailView
        account={account}
        pages={pages}
        isFetchingNextPage={false}
        hasNextPage={opts.hasNextPage ?? false}
        onLoadMore={onLoadMore}
        today={TODAY}
      />,
    ),
  )
  return { ...view, onLoadMore }
}

describe('AccountDetailView', () => {
  it('renders the account name and current balance', () => {
    renderView([])
    expect(screen.getAllByText(ACCOUNT_NAME_CHECKING)).toHaveLength(1)
    expect(screen.getByText(money(TEST_BALANCE))).toBeInTheDocument()
  })

  it('renders a negative balance in the destructive color', () => {
    render(
      withClient(
        <AccountDetailView
          account={{ ...account, balance: -200 }}
          pages={[]}
          isFetchingNextPage={false}
          hasNextPage={false}
          onLoadMore={vi.fn()}
          today={TODAY}
        />,
      ),
    )
    const amount = screen.getByText(money(-200))
    expect(amount.className).toMatch(/text-destructive/)
  })

  it('renders the balance exactly once', () => {
    renderView([])
    expect(screen.getAllByText(money(TEST_BALANCE))).toHaveLength(1)
  })

  it('offers the privacy toggle, hiding the balances but not the transactions', async () => {
    renderView([
      buildPage({
        total_days: 1,
        transactions: [buildTransaction({ id: 1, date: DATE_TODAY, amount: -AMOUNT_S })],
        balance_at_date: { [DATE_TODAY]: 500 },
      }),
    ])

    await userEvent.click(screen.getByRole('button', { name: 'Hide amounts' }))
    expect(document.documentElement).toHaveAttribute('data-privacy', 'on')
    expect(screen.getByText(money(TEST_BALANCE)).className).toMatch(/private-amount/)
    expect(screen.getByText(money(500)).className).toMatch(/private-amount/)
    expect(screen.getByText(money(-AMOUNT_S)).className).not.toMatch(/private-amount/)

    await userEvent.click(screen.getByRole('button', { name: 'Show amounts' }))
    expect(document.documentElement).not.toHaveAttribute('data-privacy')
  })

  it('renders the back link to "/"', () => {
    renderView([])
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('href', '/')
  })

  it('shows the prominent add button and no list heading when there are no expected transactions', () => {
    mockUseExpectedTransactions.mockReturnValue({ data: [] })
    renderView([])
    expect(screen.getByRole('button', { name: 'Expected transaction' })).toBeInTheDocument()
    expect(screen.queryByText('Expected transactions')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument()
  })

  it('moves the add button into the list heading labelled "Add" once expectations exist', () => {
    const expectation: ExpectedTransactionRead = {
      id: 1,
      account_id: 42,
      amount: -AMOUNT_M,
      other_party: 'Landlord',
      note: null,
      match_tolerance_percent: 0,
    }
    mockUseExpectedTransactions.mockReturnValue({ data: [expectation] })
    renderView([])
    expect(screen.getByText('Expected transactions')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Expected transaction' })).not.toBeInTheDocument()
  })

  it('shows the personalised name above the IBAN when one is set', () => {
    render(
      withClient(
        <AccountDetailView
          account={{ ...account, name: TEST_IBAN, display_name: ACCOUNT_NAME_CHECKING }}
          pages={[]}
          isFetchingNextPage={false}
          hasNextPage={false}
          onLoadMore={vi.fn()}
          today={TODAY}
        />,
      ),
    )
    expect(screen.getByText(ACCOUNT_NAME_CHECKING)).toBeInTheDocument()
    expect(screen.getByText(TEST_IBAN_FORMATTED)).toBeInTheDocument()
  })

  it('shows the last-updated time beside the IBAN when a timestamp is given', () => {
    render(
      withClient(
        <AccountDetailView
          account={account}
          lastUpdated={DATETIME_UPDATED}
          pages={[]}
          isFetchingNextPage={false}
          hasNextPage={false}
          onLoadMore={vi.fn()}
          today={TODAY}
        />,
      ),
    )
    expect(screen.getByText(/^Last updated /)).toBeInTheDocument()
  })

  it('omits the last-updated time when no timestamp is given', () => {
    renderView([])
    expect(screen.queryByText(/^Last updated /)).not.toBeInTheDocument()
  })

  it('falls back to the IBAN as the header title when no personalised name is set', () => {
    render(
      withClient(
        <AccountDetailView
          account={{ ...account, name: TEST_IBAN, display_name: null }}
          pages={[]}
          isFetchingNextPage={false}
          hasNextPage={false}
          onLoadMore={vi.fn()}
          today={TODAY}
        />,
      ),
    )
    expect(screen.getAllByText(TEST_IBAN_FORMATTED)).toHaveLength(2)
  })

  it('copies the formatted IBAN to the clipboard via the copy button', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    render(
      withClient(
        <AccountDetailView
          account={{ ...account, name: TEST_IBAN, display_name: null }}
          pages={[]}
          isFetchingNextPage={false}
          hasNextPage={false}
          onLoadMore={vi.fn()}
          today={TODAY}
        />,
      ),
    )
    await user.click(screen.getByRole('button', { name: 'Copy IBAN' }))
    expect(writeText).toHaveBeenCalledWith(TEST_IBAN_FORMATTED)
  })

  it('shows no copy button when the account name is not an IBAN', () => {
    renderView([])
    expect(screen.queryByRole('button', { name: 'Copy IBAN' })).not.toBeInTheDocument()
  })

  it('shows a non-IBAN account name below its personalised name, without a copy button', () => {
    render(
      withClient(
        <AccountDetailView
          account={{ ...account, display_name: LABEL_RENT }}
          pages={[]}
          isFetchingNextPage={false}
          hasNextPage={false}
          onLoadMore={vi.fn()}
          today={TODAY}
        />,
      ),
    )
    expect(screen.getByText(LABEL_RENT)).toBeInTheDocument()
    expect(screen.getByRole('group', { name: ACCOUNT_NAME_CHECKING })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copy IBAN' })).not.toBeInTheDocument()
  })

  it('renders the magnifier as a link to search, pre-scoped to this account', () => {
    renderView([])
    const search = screen.getByRole('link', { name: 'Search transactions' })
    expect(search).toHaveAttribute('href', '/search?account_ids=42')
  })

  it('shows the empty-state message when there are no transactions', () => {
    renderView([])
    expect(screen.getByText('No transactions yet.')).toBeInTheDocument()
  })

  it('shows a loading line instead of the empty state while the first page loads', () => {
    render(
      withClient(
        <AccountDetailView
          account={account}
          pages={[]}
          isLoading
          isFetchingNextPage={false}
          hasNextPage={false}
          onLoadMore={vi.fn()}
          today={TODAY}
        />,
      ),
    )
    expect(screen.queryByText('No transactions yet.')).not.toBeInTheDocument()
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('groups transactions by date with day-end balance and relative labels', () => {
    renderView([
      buildPage({
        total_days: 2,
        transactions: [
          buildTransaction({
            id: 1,
            date: DATE_TODAY,
            amount: -AMOUNT_S,
            other_party: PARTY_SUPERMARKET,
          }),
          buildTransaction({ id: 2, date: DATE_TODAY, amount: -AMOUNT_M, other_party: 'Aldi' }),
          buildTransaction({
            id: 3,
            date: DATE_YESTERDAY,
            amount: AMOUNT_XL,
            other_party: 'Employer',
          }),
        ],
        balance_at_date: { [DATE_TODAY]: TEST_BALANCE, [DATE_YESTERDAY]: 1244.5 },
      }),
    ])

    expect(screen.getByRole('heading', { level: 2, name: 'Today' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Yesterday' })).toBeInTheDocument()

    // End-of-day balances appear next to their date header (and in this fixture
    // are distinct from the current-balance number above).
    expect(screen.getByText(money(TEST_BALANCE + AMOUNT_S))).toBeInTheDocument()

    expect(screen.getByText(PARTY_SUPERMARKET)).toBeInTheDocument()
    expect(screen.getByText('Aldi')).toBeInTheDocument()
    expect(screen.getByText('Employer')).toBeInTheDocument()
  })

  it('puts the purpose on a second line, but not when it is already the name', () => {
    renderView([
      buildPage({
        total_days: 1,
        transactions: [
          buildTransaction({
            id: 1,
            date: DATE_TODAY,
            amount: -AMOUNT_S,
            other_party: 'PayPal',
            purpose: 'Steam Games',
          }),
          buildTransaction({ id: 2, date: DATE_TODAY, amount: -AMOUNT_M, purpose: LABEL_RENT }),
        ],
        balance_at_date: { [DATE_TODAY]: 0 },
      }),
    ])

    expect(screen.getByText('PayPal')).toBeInTheDocument()
    expect(screen.getByText('Steam Games')).toBeInTheDocument()
    expect(screen.getAllByText(LABEL_RENT)).toHaveLength(1)
  })

  it('falls back to "Unknown" when other_party is null or blank', () => {
    renderView([
      buildPage({
        total_days: 1,
        transactions: [
          buildTransaction({ id: 1, other_party: null, amount: -AMOUNT_S }),
          buildTransaction({ id: 2, other_party: '   ', amount: -AMOUNT_M }),
        ],
        balance_at_date: { [DATE_TODAY]: 0 },
      }),
    ])
    expect(screen.getAllByText('Unknown')).toHaveLength(2)
  })

  it('colors outgoing amounts destructive and incoming amounts success', () => {
    renderView([
      buildPage({
        total_days: 1,
        transactions: [
          buildTransaction({ id: 1, amount: -AMOUNT_M, other_party: 'Supermarket' }),
          buildTransaction({ id: 2, amount: AMOUNT_L, other_party: 'Refund' }),
        ],
        balance_at_date: { [DATE_TODAY]: 0 },
      }),
    ])
    expect(screen.getByText(money(-AMOUNT_M)).className).toMatch(/text-destructive/)
    expect(screen.getByText(money(AMOUNT_L)).className).toMatch(/text-success/)
  })

  it('links each transaction row to its detail page under the right account', () => {
    renderView([
      buildPage({
        total_days: 1,
        transactions: [buildTransaction({ id: 7, other_party: 'X' })],
        balance_at_date: { [DATE_TODAY]: 0 },
      }),
    ])
    const row = screen.getByText('X').closest('a')
    expect(row).toHaveAttribute('href', '/transactions/7')
  })

  it('renders the older-date format when the date is neither today nor yesterday', () => {
    renderView([
      buildPage({
        total_days: 1,
        transactions: [buildTransaction({ id: 1, date: DATE_OLDER, other_party: 'X' })],
        balance_at_date: { [DATE_OLDER]: 0 },
      }),
    ])
    const heading = screen.getByRole('heading', { level: 2 })
    expect(heading).toHaveTextContent(/May 10, 2026/)
  })

  it('omits the end-of-day number when the backend has no snapshot for the day', () => {
    renderView([
      buildPage({
        total_days: 1,
        transactions: [buildTransaction({ id: 1, date: DATE_TODAY, other_party: 'X' })],
        balance_at_date: {},
      }),
    ])
    // Only the current-account balance and the amount row exist;
    // nothing in the date header should expose a euro-formatted balance.
    const heading = screen.getByRole('heading', { level: 2, name: 'Today' })
    const header = heading.parentElement!
    expect(within(header).queryByText(/€/)).toBeNull()
  })
})

function renderManual(
  pages: AccountHistoryPage[],
  props: Partial<React.ComponentProps<typeof AccountDetailView>> = {},
) {
  return render(
    withClient(
      <AccountDetailView
        account={account}
        bank="manual"
        pages={pages}
        isFetchingNextPage={false}
        hasNextPage={false}
        onLoadMore={vi.fn()}
        today={TODAY}
        {...props}
      />,
    ),
  )
}

const balanceGroup = () => screen.getByRole('group', { name: 'Balance' })

describe('AccountDetailView — balance sparkline', () => {
  const rising = [
    { date: DATE_OLDER, value: AMOUNT_XL },
    { date: DATE_MID_MONTH, value: AMOUNT_XL + AMOUNT_M },
    { date: DATE_TODAY, value: AMOUNT_XL + AMOUNT_L },
  ]

  async function renderChart(series: { date: string; value: number }[]) {
    serve({ 'GET /api/statistics/net-worth': { series, summary: null } })
    const view = render(
      withClient(
        <AccountDetailView
          account={account}
          pages={[]}
          isFetchingNextPage={false}
          hasNextPage={false}
          onLoadMore={vi.fn()}
          today={TODAY}
        />,
      ),
    )
    const link = (await screen.findByText(formatDateWithoutYear(series[0].date))).closest('a')!
    return { ...view, link, chart: link.firstElementChild as HTMLElement }
  }

  it('charts the last month and links it to the account statistics', async () => {
    const { link } = await renderChart(rising)
    expect(link).toHaveAttribute('href', '/stats?account_ids=42')
    expect(link).toHaveAccessibleName('Statistics')
    expect(within(link).getByText(formatDateWithoutYear(DATE_MID_MONTH))).toBeInTheDocument()
    expect(within(link).getByText(formatDateWithoutYear(DATE_TODAY))).toBeInTheDocument()
  })

  it.each([
    ['rising', rising, 'text-success'],
    [
      'falling',
      [rising[0], rising[0], { date: DATE_TODAY, value: AMOUNT_XL - AMOUNT_L }],
      'text-destructive',
    ],
    [
      'flat',
      [rising[0], rising[0], { date: DATE_TODAY, value: AMOUNT_XL + AMOUNT_S }],
      'text-muted-foreground',
    ],
  ])('tints a %s balance line', async (_label, series, tone) => {
    const { chart } = await renderChart(series)
    expect(chart.firstElementChild).toHaveClass(tone)
  })

  it('shows the balance and date of the day under the finger while scrubbing', async () => {
    const { chart } = await renderChart(rising)

    fireEvent.pointerDown(chart, { clientX: 400 })
    expect(within(balanceGroup()).getByText(money(AMOUNT_XL + AMOUNT_M))).toBeInTheDocument()
    expect(screen.getByText(formatDateWithoutYear(DATE_MID_MONTH))).toHaveClass('font-medium')

    fireEvent.pointerMove(chart, { clientX: 800 })
    expect(within(balanceGroup()).getByText(money(AMOUNT_XL + AMOUNT_L))).toBeInTheDocument()

    fireEvent.pointerUp(chart)
    expect(within(balanceGroup()).getByText(money(TEST_BALANCE))).toBeInTheDocument()
    expect(screen.getByText(formatDateWithoutYear(DATE_MID_MONTH))).not.toHaveClass('font-medium')
  })

  it('ignores the pointer while the chart has no width yet', async () => {
    const { chart } = await renderChart(rising)
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 0, 0))
    fireEvent.pointerDown(chart, { clientX: 400 })
    expect(within(balanceGroup()).getByText(money(TEST_BALANCE))).toBeInTheDocument()
  })

  it('does not open the statistics after a scrub, but does on the next tap', async () => {
    const { link, chart } = await renderChart(rising)
    const prevented: boolean[] = []
    const record = (event: Event) => prevented.push(event.defaultPrevented)
    document.body.addEventListener('click', record)

    fireEvent.pointerDown(chart, { clientX: 0 })
    fireEvent.pointerMove(chart, { clientX: 400 })
    fireEvent.pointerUp(chart)
    fireEvent.click(link)
    fireEvent.click(link)

    document.body.removeEventListener('click', record)
    expect(prevented).toEqual([true, false])
  })

  it('previews the day under a hovering mouse without blocking a click', async () => {
    const { link, chart } = await renderChart(rising)
    const prevented: boolean[] = []
    const record = (event: Event) => prevented.push(event.defaultPrevented)
    document.body.addEventListener('click', record)

    fireEvent.pointerMove(chart, { clientX: 400 })
    expect(within(balanceGroup()).getByText(money(AMOUNT_XL + AMOUNT_M))).toBeInTheDocument()
    fireEvent.click(link)
    fireEvent.pointerLeave(chart)

    document.body.removeEventListener('click', record)
    expect(prevented).toEqual([false])
    expect(within(balanceGroup()).getByText(money(TEST_BALANCE))).toBeInTheDocument()
  })

  it('keeps touch gestures on the chart from scrolling or swiping the page', async () => {
    const { chart, unmount } = await renderChart(rising)
    const escaped = vi.fn()
    document.addEventListener('touchstart', escaped)
    document.addEventListener('touchmove', escaped)

    const start = new Event('touchstart', { bubbles: true, cancelable: true })
    const move = new Event('touchmove', { bubbles: true, cancelable: true })
    chart.dispatchEvent(start)
    chart.dispatchEvent(move)
    expect(start.defaultPrevented).toBe(false)
    expect(move.defaultPrevented).toBe(true)
    expect(escaped).not.toHaveBeenCalled()

    const passiveMove = new Event('touchmove', { bubbles: true })
    chart.dispatchEvent(passiveMove)
    expect(escaped).not.toHaveBeenCalled()

    unmount()
    const afterUnmount = new Event('touchmove', { bubbles: true, cancelable: true })
    chart.dispatchEvent(afterUnmount)
    expect(afterUnmount.defaultPrevented).toBe(false)
    document.removeEventListener('touchstart', escaped)
    document.removeEventListener('touchmove', escaped)
  })
})

describe('AccountDetailView — docked balance header', () => {
  const rectOfHeight = (height: number) => new DOMRect(0, 0, 800, height)

  it('docks the balance into the sticky header and re-measures when the layout shifts', () => {
    vi.spyOn(CSS, 'supports').mockReturnValue(true)
    const { unmount } = renderView([])
    const main = screen.getByRole('main')
    const headerHeight = () => main.style.getPropertyValue('--account-header-height')
    expect(headerHeight()).toBe('64px')
    expect(balanceGroup()).toHaveClass('account-balance-dock')
    const balance = balanceGroup()

    const rect = vi
      .spyOn(Element.prototype, 'getBoundingClientRect')
      .mockReturnValue(rectOfHeight(80))
    act(() => window.dispatchEvent(new Event(OFFLINE_BANNER_RESIZE_EVENT)))
    expect(headerHeight()).toBe('80px')

    rect.mockReturnValue(rectOfHeight(96))
    act(() => window.dispatchEvent(new Event('resize')))
    expect(headerHeight()).toBe('80px')

    const width = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { value: width / 2, configurable: true })
    act(() => window.dispatchEvent(new Event('resize')))
    expect(headerHeight()).toBe('96px')
    Object.defineProperty(window, 'innerWidth', { value: width, configurable: true })

    unmount()
    expect(balance).not.toHaveClass('account-balance-dock')
  })

  it('leaves the balance in the flow where scroll-driven animations are unsupported', () => {
    vi.spyOn(CSS, 'supports').mockReturnValue(false)
    renderView([])
    expect(balanceGroup()).not.toHaveClass('account-balance-dock')
  })
})

describe('AccountDetailView — manual account', () => {
  const manualTransaction = buildTransaction({
    id: 5,
    amount: -AMOUNT_S,
    other_party: PARTY_SUPERMARKET,
  })
  const manualPage = buildPage({
    total_days: 1,
    transactions: [manualTransaction],
    balance_at_date: { [DATE_TODAY]: TEST_BALANCE },
  })

  async function openBalanceEditor(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: 'Balance' }))
    return screen.getByRole('textbox', { name: 'Balance' })
  }

  it('saves an edited balance on Enter', async () => {
    const user = userEvent.setup()
    const fetchMock = serve({ 'PATCH /api/account/42': { ...account, balance: AMOUNT_XL } })
    renderManual([])

    const input = await openBalanceEditor(user)
    await user.clear(input)
    await user.type(input, `${AMOUNT_XL}{Enter}`)

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Saved'))
    expect(requestsTo(fetchMock, 'PATCH')).toEqual([
      { url: '/api/account/42', body: { balance: AMOUNT_XL } },
    ])
    expect(screen.queryByRole('textbox', { name: 'Balance' })).toBeNull()
  })

  it('keeps the editor open when saving the balance fails', async () => {
    const user = userEvent.setup()
    serve({ 'PATCH /api/account/42': () => jsonResponse({ status: 422, body: {} }) })
    renderManual([])

    const input = await openBalanceEditor(user)
    await user.clear(input)
    await user.type(input, String(AMOUNT_XL))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Could not save the changes. Please try again.'),
    )
    expect(screen.getByRole('textbox', { name: 'Balance' })).toBeInTheDocument()
  })

  it('discards a balance draft on Escape and on Cancel', async () => {
    const user = userEvent.setup()
    const fetchMock = serve({})
    renderManual([])

    await user.type(await openBalanceEditor(user), '9')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('textbox', { name: 'Balance' })).toBeNull()
    expect(within(balanceGroup()).getByText(money(TEST_BALANCE))).toBeInTheDocument()

    await user.type(await openBalanceEditor(user), '9')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('textbox', { name: 'Balance' })).toBeNull()
    expect(requestsTo(fetchMock, 'PATCH')).toEqual([])
  })

  it('closes the editor without a request for an unchanged or empty balance', async () => {
    const user = userEvent.setup()
    const fetchMock = serve({})
    renderManual([])

    await openBalanceEditor(user)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.queryByRole('textbox', { name: 'Balance' })).toBeNull()

    const input = await openBalanceEditor(user)
    await user.clear(input)
    expect(input).toHaveAttribute('aria-invalid', 'true')
    await user.keyboard('{Enter}')
    expect(screen.queryByRole('textbox', { name: 'Balance' })).toBeNull()
    expect(requestsTo(fetchMock, 'PATCH')).toEqual([])
  })

  it('opens the booking form from "Add transaction" and closes it on cancel', async () => {
    const user = userEvent.setup()
    renderManual([])

    await user.click(screen.getByRole('button', { name: 'Add transaction' }))
    expect(screen.getByRole('switch', { name: 'Recurring' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('switch', { name: 'Recurring' })).toBeNull()
  })

  it('edits a manual transaction in place instead of linking to it', async () => {
    const user = userEvent.setup()
    renderManual([manualPage])
    expect(screen.getByText(PARTY_SUPERMARKET).closest('a')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByRole('textbox', { name: 'Recipient / Sender' })).toHaveValue(
      PARTY_SUPERMARKET,
    )
    expect(screen.queryByRole('switch', { name: 'Recurring' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('textbox', { name: 'Recipient / Sender' })).toBeNull()
    expect(screen.getByText(PARTY_SUPERMARKET)).toBeInTheDocument()
  })

  it.each([
    ['confirms', () => new Response(null, { status: 204 }), toast.success, 'Transaction deleted'],
    [
      'reports a failure of',
      () => jsonResponse({ status: 422, body: {} }),
      toast.error,
      'Could not delete transaction.',
    ],
  ])('%s deleting a manual transaction', async (_label, response, notify, message) => {
    const user = userEvent.setup()
    const fetchMock = serve({ 'DELETE /api/account/42/transactions/5': response })
    renderManual([manualPage])

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Really delete?' }))

    await waitFor(() => expect(notify).toHaveBeenCalledWith(message))
    expect(requestsTo(fetchMock, 'DELETE').map((request) => request.url)).toEqual([
      '/api/account/42/transactions/5',
    ])
  })

  it('lets someone the account is shared with neither book nor edit it', () => {
    renderManual([manualPage], { isOwner: false })
    expect(screen.queryByRole('button', { name: 'Add transaction' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Balance' })).toBeNull()
    expect(screen.getByText(PARTY_SUPERMARKET).closest('a')).toHaveAttribute(
      'href',
      '/transactions/5',
    )
  })
})

describe('AccountDetailView — expected transactions', () => {
  function buildExpectation(
    overrides: Partial<ExpectedTransactionRead> = {},
  ): ExpectedTransactionRead {
    return {
      id: 1,
      account_id: 42,
      amount: -AMOUNT_M,
      other_party: PARTY_SUPERMARKET,
      note: null,
      match_tolerance_percent: 0,
      ...overrides,
    }
  }

  it('opens the form from the add button and closes it on cancel', async () => {
    const user = userEvent.setup()
    mockUseExpectedTransactions.mockReturnValue({ data: [] })
    renderView([])

    await user.click(screen.getByRole('button', { name: 'Expected transaction' }))
    expect(screen.getByLabelText('Tolerance')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('Tolerance')).toBeNull()
  })

  it('toggles the form from the "Add" button in the list heading', async () => {
    const user = userEvent.setup()
    mockUseExpectedTransactions.mockReturnValue({ data: [buildExpectation()] })
    renderView([])

    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(screen.getByLabelText('Tolerance')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(screen.queryByLabelText('Tolerance')).toBeNull()
  })

  it('names an expectation without a party by its direction and shows its note', () => {
    mockUseExpectedTransactions.mockReturnValue({
      data: [
        buildExpectation({ id: 1, other_party: null, note: `  ${LABEL_RENT}  ` }),
        buildExpectation({ id: 2, other_party: '  ', amount: AMOUNT_L }),
      ],
    })
    renderView([])

    expect(screen.getByText('Any recipient')).toBeInTheDocument()
    expect(screen.getByText('Any sender')).toBeInTheDocument()
    expect(screen.getByText(LABEL_RENT)).toBeInTheDocument()
    expect(screen.getByText(money(-AMOUNT_M))).toHaveClass('text-destructive')
    expect(screen.getByText(money(AMOUNT_L))).toHaveClass('text-success')
  })

  it('collapses the list and remembers that across visits', async () => {
    const user = userEvent.setup()
    mockUseExpectedTransactions.mockReturnValue({ data: [buildExpectation()] })
    renderView([])

    await user.click(screen.getByRole('button', { name: 'Expected transactions' }))
    expect(screen.queryByText(PARTY_SUPERMARKET)).toBeNull()
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!)).toEqual(['expectedTransactions'])

    await user.click(screen.getByRole('button', { name: 'Expected transactions' }))
    expect(screen.getByText(PARTY_SUPERMARKET)).toBeInTheDocument()
  })

  it('edits an expectation in place', async () => {
    const user = userEvent.setup()
    mockUseExpectedTransactions.mockReturnValue({ data: [buildExpectation()] })
    renderView([])

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByRole('textbox', { name: 'Sender / recipient' })).toHaveValue(
      PARTY_SUPERMARKET,
    )

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('textbox', { name: 'Sender / recipient' })).toBeNull()
  })

  it.each([
    [
      'confirms',
      () => new Response(null, { status: 204 }),
      toast.success,
      'Expected transaction deleted',
    ],
    [
      'reports a failure of',
      () => jsonResponse({ status: 422, body: {} }),
      toast.error,
      'Could not delete expected transaction',
    ],
  ])('%s deleting an expectation', async (_label, response, notify, message) => {
    const user = userEvent.setup()
    mockUseExpectedTransactions.mockReturnValue({ data: [buildExpectation({ id: 3 })] })
    const fetchMock = serve({ 'DELETE /api/account/42/expected-transactions/3': response })
    renderView([])

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Really delete?' }))

    await waitFor(() => expect(notify).toHaveBeenCalledWith(message))
    expect(requestsTo(fetchMock, 'DELETE')).toHaveLength(1)
  })

  it('hides expectations from someone who may only read the account', () => {
    mockUseExpectedTransactions.mockReturnValue({ data: [buildExpectation()] })
    render(
      withClient(
        <AccountDetailView
          account={account}
          pages={[]}
          isFetchingNextPage={false}
          hasNextPage={false}
          onLoadMore={vi.fn()}
          today={TODAY}
          isOwner={false}
          canWrite={false}
        />,
      ),
    )
    expect(screen.queryByText('Expected transactions')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Expected transaction' })).toBeNull()
  })
})

describe('AccountDetailView — transaction list', () => {
  it('badges a pending transaction', () => {
    renderView([
      buildPage({
        total_days: 1,
        transactions: [buildTransaction({ other_party: PARTY_SUPERMARKET, pending: true })],
      }),
    ])
    expect(screen.getByText('Pending')).toBeInTheDocument()
  })

  it('labels a future booking day as scheduled', () => {
    renderView([
      buildPage({
        total_days: 1,
        transactions: [buildTransaction({ date: DATE_NEXT_RUN, other_party: PARTY_SUPERMARKET })],
      }),
    ])
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(/^Scheduled for /)
  })

  it('marks the day-end value of a market-valued account', () => {
    render(
      withClient(
        <AccountDetailView
          account={{ ...account, is_market_valued: true }}
          pages={[
            buildPage({
              total_days: 1,
              transactions: [buildTransaction({ other_party: PARTY_SUPERMARKET })],
              balance_at_date: { [DATE_TODAY]: AMOUNT_XL },
            }),
          ]}
          isFetchingNextPage={false}
          hasNextPage={false}
          onLoadMore={vi.fn()}
          today={TODAY}
        />,
      ),
    )
    const header = screen.getByRole('heading', { level: 2, name: 'Today' }).parentElement!
    expect(within(header).getByText('Market value')).toBeInTheDocument()
    expect(within(header).getByText(money(AMOUNT_XL))).toBeInTheDocument()
  })

  it('asks for the next page once the end of the list scrolls into view', () => {
    const intersect = stubIntersectionObserver()
    const { onLoadMore } = renderView([buildPage()], { hasNextPage: true })

    intersect(false)
    expect(onLoadMore).not.toHaveBeenCalled()
    intersect(true)
    expect(onLoadMore).toHaveBeenCalledOnce()
  })

  it('says more transactions are loading while the next page is fetched', () => {
    render(
      withClient(
        <AccountDetailView
          account={account}
          pages={[]}
          isFetchingNextPage
          hasNextPage
          onLoadMore={vi.fn()}
          today={TODAY}
        />,
      ),
    )
    expect(screen.getByText('Loading more transactions…')).toBeInTheDocument()
  })
})

describe('AccountDetailPage', () => {
  const Page = Route.options.component!

  function buildCredential(overrides: Partial<CredentialRead> = {}): CredentialRead {
    return {
      id: 100,
      bank: 'fints',
      bank_name: 'ING',
      bank_icon: null,
      accounts: [account],
      last_successful_sync_timestamp: null,
      requires_two_factor_authentication: false,
      sync_enabled: true,
      ...overrides,
    }
  }

  function buildSync(overrides: Partial<UseCredentialSyncResult> = {}): UseCredentialSyncResult {
    return {
      start: vi.fn(),
      status: 'idle',
      jobs: new Map(),
      current2fa: null,
      submit2fa: vi.fn().mockResolvedValue(undefined),
      skip2fa: vi.fn(),
      succeededAt: null,
      failedAt: null,
      startError: null,
      ...overrides,
    }
  }

  function renderPage({
    accountId = '42',
    credential = buildCredential(),
    sync = buildSync(),
  }: { accountId?: string; credential?: CredentialRead; sync?: UseCredentialSyncResult } = {}) {
    routeState.params = { accountId }
    mockUseAuthMe.mockReturnValue({ data: buildUser({ credentials: [credential] }) })
    mockUseCredentialSync.mockReturnValue(sync)
    renderWithQuery(<Page />)
    return sync
  }

  const current2fa = {
    credentialId: 100,
    jobId: 'job',
    bank: 'fints',
    bankName: 'ING',
    bankIcon: null,
    kind: 'awaiting_2fa',
  } as const

  it('renders nothing until the signed-in user is known', () => {
    routeState.params = { accountId: '42' }
    mockUseAuthMe.mockReturnValue({ data: undefined })
    mockUseCredentialSync.mockReturnValue(buildSync())
    const { container } = renderWithQuery(<Page />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the not-found page for an account the user has no access to', () => {
    renderPage({ accountId: '999' })
    expect(screen.getByText('The account you seek, this is not.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to overview' })).toHaveAttribute('href', '/')
    expect(mockUseCredentialSync).toHaveBeenCalledWith(-1)
  })

  it('loads the account history and syncs the owning connection', async () => {
    const user = userEvent.setup()
    serve({
      'GET /api/account/42/history?page=1': buildPage({
        total_days: 1,
        transactions: [buildTransaction({ other_party: PARTY_SUPERMARKET })],
      }),
    })
    const sync = renderPage()

    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(await screen.findByText(PARTY_SUPERMARKET)).toBeInTheDocument()
    expect(mockUseCredentialSync).toHaveBeenCalledWith(100)

    await user.click(screen.getByRole('button', { name: 'Sync account' }))
    expect(sync.start).toHaveBeenCalledOnce()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('fetches the next history page when the end of the list scrolls into view', async () => {
    const intersect = stubIntersectionObserver()
    const fetchMock = serve({
      'GET /api/account/42/history?page=1': buildPage({
        page: 1,
        page_size: 1,
        total_days: 2,
        transactions: [buildTransaction({ id: 1, other_party: PARTY_SUPERMARKET })],
      }),
      'GET /api/account/42/history?page=2': buildPage({
        page: 2,
        page_size: 1,
        total_days: 2,
        transactions: [buildTransaction({ id: 2, date: DATE_YESTERDAY, other_party: LABEL_RENT })],
      }),
    })
    renderPage()
    await screen.findByText(PARTY_SUPERMARKET)

    intersect(true)
    expect(await screen.findByText(LABEL_RENT)).toBeInTheDocument()

    intersect(true)
    const historyRequests = fetchMock.mock.calls.filter(([url]) => String(url).includes('/history'))
    expect(historyRequests).toHaveLength(2)
  })

  it.each([
    ['a manual account', { bank: 'manual' }],
    ['a read-only share', { shared_from: SHARE_OWNER_NAME, share_permission: 'read' as const }],
    [
      'a writable share that needs 2FA',
      {
        shared_from: SHARE_OWNER_NAME,
        share_permission: 'write' as const,
        requires_two_factor_authentication: true,
      },
    ],
  ])('offers no sync for %s', (_label, overrides) => {
    renderPage({ credential: buildCredential(overrides) })
    expect(screen.queryByRole('button', { name: 'Sync account' })).toBeNull()
  })

  it('lets a writable share without 2FA sync', () => {
    renderPage({
      credential: buildCredential({ shared_from: SHARE_OWNER_NAME, share_permission: 'write' }),
    })
    expect(screen.getByRole('button', { name: 'Sync account' })).toBeEnabled()
  })

  it('disables the sync button while a sync runs', () => {
    renderPage({ sync: buildSync({ status: 'running' }) })
    expect(screen.getByRole('button', { name: 'Sync account' })).toBeDisabled()
  })

  it.each([
    [true, 'text-warning'],
    [false, 'text-muted-foreground'],
  ])('with sync enabled=%s colours a days-old update %s', (syncEnabled, colour) => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date(DATETIME_UPDATED).getTime())
    renderPage({
      credential: buildCredential({
        last_successful_sync_timestamp: DATETIME_RECENT,
        sync_enabled: syncEnabled,
      }),
    })
    expect(screen.getByText(/^Last updated /)).toHaveClass(colour)
  })

  it('tells someone the account is shared with that only its owner may sync', () => {
    renderPage({
      credential: buildCredential({ shared_from: SHARE_OWNER_NAME, share_permission: 'write' }),
      sync: buildSync({ failedAt: 1, startError: new ApiError(403, null, 'forbidden') }),
    })
    expect(toast.error).toHaveBeenCalledWith('Only its owner can refresh this account')
  })

  it('reports a failed sync with its reason, linking to the connection', async () => {
    const user = userEvent.setup()
    renderPage({
      sync: buildSync({
        failedAt: 1,
        jobs: new Map([
          [
            100,
            {
              job_id: 'job',
              credential_id: 100,
              status: 'failed',
              expires_at: null,
              error: null,
              error_code: 'rate_limited',
            },
          ],
        ]),
      }),
    })

    expect(toast.error).toHaveBeenCalledOnce()
    render(<>{toast.error.mock.calls[0][0] as React.ReactNode}</>)
    await user.click(screen.getByRole('button', { name: /ING received too many requests/ }))
    expect(routerPush).toHaveBeenCalledWith('/settings/credentials/100')
  })

  it('submits the 2FA code to the running sync', async () => {
    const user = userEvent.setup()
    const sync = renderPage({ sync: buildSync({ status: 'awaiting_2fa', current2fa }) })

    await user.type(screen.getByLabelText('Code'), TWO_FACTOR_CODE)
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(sync.submit2fa).toHaveBeenCalledWith(TWO_FACTOR_CODE)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('toasts when the 2FA code is not accepted', async () => {
    const user = userEvent.setup()
    renderPage({
      sync: buildSync({
        status: 'awaiting_2fa',
        current2fa,
        submit2fa: vi.fn().mockRejectedValue(new Error('rejected')),
      }),
    })

    await user.type(screen.getByLabelText('Code'), TWO_FACTOR_CODE)
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("ING couldn't be synced."))
  })

  it('skips the bank when the 2FA dialog is closed', async () => {
    const user = userEvent.setup()
    const sync = renderPage({ sync: buildSync({ status: 'awaiting_2fa', current2fa }) })

    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(toast).toHaveBeenCalledWith('ING skipped.')
    expect(sync.skip2fa).toHaveBeenCalledOnce()
  })
})
