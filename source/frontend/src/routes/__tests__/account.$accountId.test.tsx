import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import '@/i18n'
import type { AccountRead } from '@/lib/auth'
import type { AccountHistoryPage, TransactionRead } from '@/lib/accountHistory'

vi.mock('@tanstack/react-router', async () => (await import('./-routerMock')).routerMocks())

const { mockUseExpectedTransactions } = vi.hoisted(() => ({
  mockUseExpectedTransactions: vi.fn(),
}))
vi.mock('@/lib/expectedTransaction', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/expectedTransaction')>()),
  useExpectedTransactions: mockUseExpectedTransactions,
}))

import { AccountDetailView } from '@/pages/account.$accountId'
import type { ExpectedTransactionRead } from '@/lib/expectedTransaction'
import {
  ACCOUNT_NAME_CHECKING,
  AMOUNT_L,
  AMOUNT_M,
  AMOUNT_S,
  AMOUNT_XL,
  DATETIME_UPDATED,
  DATE_OLDER,
  DATE_TODAY,
  DATE_YESTERDAY,
  LABEL_RENT,
  PARTY_SUPERMARKET,
  TEST_BALANCE,
  TEST_IBAN,
  TEST_IBAN_FORMATTED,
  TODAY,
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
  scrollTo(0)
})

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
  render(
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
  return { onLoadMore }
}

describe('AccountDetailView', () => {
  it('renders the account name and current balance', () => {
    renderView([])
    expect(screen.getAllByText(ACCOUNT_NAME_CHECKING)).toHaveLength(2)
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
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/')
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
