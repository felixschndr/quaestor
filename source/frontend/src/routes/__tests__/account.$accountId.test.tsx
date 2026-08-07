import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
  name: 'Girokonto',
  display_name: null,
  balance: 1234.5,
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
    date: '2026-05-22',
    other_party: null,
    transaction_type: null,
    category: 'UNKNOWN',
    note: null,
    ...overrides,
  }
}

function withClient(ui: React.ReactNode) {
  // BalanceDisplay calls useUpdateAccount even before edit mode is entered, so
  // the tests need a real QueryClient in scope. retry:false keeps failures
  // from being masked by react-query's default retry behavior.
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

function renderView(
  pages: AccountHistoryPage[],
  opts: { hasNextPage?: boolean; focusTransactionId?: number } = {},
) {
  const onLoadMore = vi.fn()
  render(
    withClient(
      <AccountDetailView
        account={account}
        pages={pages}
        isFetchingNextPage={false}
        hasNextPage={opts.hasNextPage ?? false}
        onLoadMore={onLoadMore}
        today={new Date(2026, 4, 22)}
        focusTransactionId={opts.focusTransactionId}
      />,
    ),
  )
  return { onLoadMore }
}

describe('AccountDetailView', () => {
  it('renders the account name and current balance', () => {
    renderView([])
    expect(screen.getAllByText('Girokonto')).toHaveLength(2)
    expect(screen.getByText('1.234,50 €')).toBeInTheDocument()
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
          today={new Date(2026, 4, 22)}
        />,
      ),
    )
    const amount = screen.getByText('-200,00 €')
    expect(amount.className).toMatch(/text-destructive/)
  })

  it('moves the one balance towards the header instead of duplicating it', () => {
    renderView([])
    const moved = () => screen.getByText('1.234,50 €').closest('[style]') as HTMLElement | null

    expect(screen.getAllByText('1.234,50 €')).toHaveLength(1)
    expect(moved()?.style.transform).toMatch(/^translate\(/)

    scrollTo(400)
    expect(screen.getAllByText('1.234,50 €')).toHaveLength(1)
    expect(moved()?.style.transform).toMatch(/^translate\(/)
    expect(screen.getAllByText('Girokonto').length).toBeGreaterThan(0)
  })

  it('offers the privacy toggle, hiding the balances but not the transactions', async () => {
    renderView([
      buildPage({
        total_days: 1,
        transactions: [buildTransaction({ id: 1, date: '2026-05-22', amount: -12.5 })],
        balance_at_date: { '2026-05-22': 500 },
      }),
    ])

    await userEvent.click(screen.getByRole('button', { name: 'Hide amounts' }))
    expect(document.documentElement).toHaveAttribute('data-privacy', 'on')
    expect(screen.getByText('1.234,50 €').className).toMatch(/private-amount/)
    expect(screen.getByText('500,00 €').className).toMatch(/private-amount/)
    expect(screen.getByText('-12,50 €').className).not.toMatch(/private-amount/)

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
      amount: -50,
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
          account={{ ...account, name: 'DE12345678900001', display_name: 'Gehaltskonto' }}
          pages={[]}
          isFetchingNextPage={false}
          hasNextPage={false}
          onLoadMore={vi.fn()}
          today={new Date(2026, 4, 22)}
        />,
      ),
    )
    expect(screen.getByText('Gehaltskonto')).toBeInTheDocument()
    expect(screen.getByText('DE12 3456 7890 0001')).toBeInTheDocument()
  })

  it('shows the last-updated time beside the IBAN when a timestamp is given', () => {
    render(
      withClient(
        <AccountDetailView
          account={account}
          lastUpdated="2026-06-15T08:30:00Z"
          pages={[]}
          isFetchingNextPage={false}
          hasNextPage={false}
          onLoadMore={vi.fn()}
          today={new Date(2026, 4, 22)}
        />,
      ),
    )
    expect(screen.getByText(/^Last updated:/)).toBeInTheDocument()
  })

  it('omits the last-updated time when no timestamp is given', () => {
    renderView([])
    expect(screen.queryByText(/^Last updated:/)).not.toBeInTheDocument()
  })

  it('falls back to the IBAN as the header title when no personalised name is set', () => {
    render(
      withClient(
        <AccountDetailView
          account={{ ...account, name: 'DE12345678900001', display_name: null }}
          pages={[]}
          isFetchingNextPage={false}
          hasNextPage={false}
          onLoadMore={vi.fn()}
          today={new Date(2026, 4, 22)}
        />,
      ),
    )
    expect(screen.getAllByText('DE12 3456 7890 0001')).toHaveLength(2)
  })

  it('copies the compact IBAN to the clipboard via the copy button', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    render(
      withClient(
        <AccountDetailView
          account={{ ...account, name: 'DE12345678900001', display_name: null }}
          pages={[]}
          isFetchingNextPage={false}
          hasNextPage={false}
          onLoadMore={vi.fn()}
          today={new Date(2026, 4, 22)}
        />,
      ),
    )
    await user.click(screen.getByRole('button', { name: 'Copy IBAN' }))
    expect(writeText).toHaveBeenCalledWith('DE12345678900001')
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
          today={new Date(2026, 4, 22)}
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
          buildTransaction({ id: 1, date: '2026-05-22', amount: -10, other_party: 'REWE' }),
          buildTransaction({ id: 2, date: '2026-05-22', amount: -5, other_party: 'Aldi' }),
          buildTransaction({ id: 3, date: '2026-05-21', amount: 1500, other_party: 'Employer' }),
        ],
        balance_at_date: { '2026-05-22': 1234.5, '2026-05-21': 1244.5 },
      }),
    ])

    expect(screen.getByRole('heading', { level: 2, name: 'Today' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Yesterday' })).toBeInTheDocument()

    // End-of-day balances appear next to their date header (and in this fixture
    // are distinct from the current-balance number above).
    expect(screen.getByText('1.244,50 €')).toBeInTheDocument()

    expect(screen.getByText('REWE')).toBeInTheDocument()
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
            date: '2026-05-22',
            amount: -9,
            other_party: 'PayPal',
            purpose: 'Steam Games',
          }),
          buildTransaction({ id: 2, date: '2026-05-22', amount: -8, purpose: 'Miete Mai' }),
        ],
        balance_at_date: { '2026-05-22': 0 },
      }),
    ])

    expect(screen.getByText('PayPal')).toBeInTheDocument()
    expect(screen.getByText('Steam Games')).toBeInTheDocument()
    expect(screen.getAllByText('Miete Mai')).toHaveLength(1)
  })

  it('falls back to "Unknown" when other_party is null or blank', () => {
    renderView([
      buildPage({
        total_days: 1,
        transactions: [
          buildTransaction({ id: 1, other_party: null, amount: -1 }),
          buildTransaction({ id: 2, other_party: '   ', amount: -2 }),
        ],
        balance_at_date: { '2026-05-22': 0 },
      }),
    ])
    expect(screen.getAllByText('Unknown')).toHaveLength(2)
  })

  it('colors outgoing amounts destructive and incoming amounts success', () => {
    renderView([
      buildPage({
        total_days: 1,
        transactions: [
          buildTransaction({ id: 1, amount: -42, other_party: 'Supermarket' }),
          buildTransaction({ id: 2, amount: 100, other_party: 'Refund' }),
        ],
        balance_at_date: { '2026-05-22': 0 },
      }),
    ])
    expect(screen.getByText('-42,00 €').className).toMatch(/text-destructive/)
    expect(screen.getByText('100,00 €').className).toMatch(/text-success/)
  })

  it('links each transaction row to its detail page under the right account', () => {
    renderView([
      buildPage({
        total_days: 1,
        transactions: [buildTransaction({ id: 7, other_party: 'X' })],
        balance_at_date: { '2026-05-22': 0 },
      }),
    ])
    const row = screen.getByText('X').closest('a')
    expect(row).toHaveAttribute('href', '/account/42/transactions/7')
  })

  it('renders the older-date format when the date is neither today nor yesterday', () => {
    renderView([
      buildPage({
        total_days: 1,
        transactions: [buildTransaction({ id: 1, date: '2026-05-10', other_party: 'X' })],
        balance_at_date: { '2026-05-10': 0 },
      }),
    ])
    const heading = screen.getByRole('heading', { level: 2 })
    expect(heading).toHaveTextContent(/May 10, 2026/)
  })

  it('omits the end-of-day number when the backend has no snapshot for the day', () => {
    renderView([
      buildPage({
        total_days: 1,
        transactions: [buildTransaction({ id: 1, date: '2026-05-22', other_party: 'X' })],
        balance_at_date: {},
      }),
    ])
    // Only the current-account balance (1.234,50 €) and the amount row exist;
    // nothing in the date header should expose a euro-formatted balance.
    const heading = screen.getByRole('heading', { level: 2, name: 'Today' })
    const header = heading.parentElement!
    expect(within(header).queryByText(/€/)).toBeNull()
  })

  it('scrolls to the focused transaction when it is already loaded', async () => {
    const pages = [buildPage({ transactions: [buildTransaction({ id: 501, date: '2026-05-20' })] })]
    renderView(pages, { focusTransactionId: 501 })
    await waitFor(() =>
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'center',
      }),
    )
  })

  it('loads more pages until the focused transaction appears', () => {
    const pages = [buildPage({ transactions: [buildTransaction({ id: 999, date: '2026-05-20' })] })]
    const { onLoadMore } = renderView(pages, { focusTransactionId: 501, hasNextPage: true })
    expect(onLoadMore).toHaveBeenCalled()
  })

  it('does not scroll or load when no focus is given', () => {
    const pages = [buildPage({ transactions: [buildTransaction({ id: 1, date: '2026-05-20' })] })]
    const { onLoadMore } = renderView(pages)
    expect(onLoadMore).not.toHaveBeenCalled()
  })

  it('highlights the focused transaction row once it is scrolled into view', async () => {
    const pages = [buildPage({ transactions: [buildTransaction({ id: 501, date: '2026-05-20' })] })]
    renderView(pages, { focusTransactionId: 501 })
    await waitFor(() => {
      const row = document.getElementById('transaction-501')
      expect(row?.className).toMatch(/bg-primary\/20/)
    })
  })

  it('re-scrolls to the same focus id when the navigation key changes', async () => {
    const scrollMock = Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>
    scrollMock.mockClear()
    const pages = [buildPage({ transactions: [buildTransaction({ id: 501, date: '2026-05-20' })] })]
    const view = (navKey: string) =>
      withClient(
        <AccountDetailView
          account={account}
          pages={pages}
          isFetchingNextPage={false}
          hasNextPage={false}
          onLoadMore={vi.fn()}
          today={new Date(2026, 4, 22)}
          focusTransactionId={501}
          focusNavKey={navKey}
        />,
      )
    const { rerender } = render(view('nav-1'))
    await waitFor(() => expect(scrollMock).toHaveBeenCalledTimes(1))
    // Same focus id, fresh navigation: the one-shot guard must re-arm.
    rerender(view('nav-2'))
    await waitFor(() => expect(scrollMock).toHaveBeenCalledTimes(2))
  })
})
