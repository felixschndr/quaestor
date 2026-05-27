import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

import '@/i18n'
import type { AccountRead } from '@/lib/auth'
import type { AccountHistoryPage, TransactionRead } from '@/lib/accountHistory'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    children,
    ...rest
  }: {
    to: string
    params?: Record<string, string>
    children: React.ReactNode
  } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'children'>) => {
    let href = to
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        href = href.replace(`$${key}`, value)
      }
    }
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    )
  },
  createFileRoute: () => () => ({}),
}))

import { AccountDetailView } from '@/routes/account.$accountId'

const account: AccountRead = {
  id: 42,
  name: 'Girokonto',
  display_name: null,
  balance: 1234.5,
  balance_factor: 100,
  is_hidden: false,
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
        today={new Date(2026, 4, 22)}
      />,
    ),
  )
  return { onLoadMore }
}

describe('AccountDetailView', () => {
  it('renders the account name and current balance', () => {
    renderView([])
    expect(screen.getByText('Girokonto')).toBeInTheDocument()
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

  it('renders the back link to "/"', () => {
    renderView([])
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/')
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
    // Both labels visible; the personalised name dominates visually, the IBAN
    // sits below as the muted secondary label.
    expect(screen.getByText('Gehaltskonto')).toBeInTheDocument()
    expect(screen.getByText('DE12 3456 7890 0001')).toBeInTheDocument()
  })

  it('shows only the IBAN when no personalised name is set', () => {
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
    expect(screen.getByText('DE12 3456 7890 0001')).toBeInTheDocument()
  })

  it('renders the magnifier as a link to the search page for the current account', () => {
    renderView([])
    const search = screen.getByRole('link', { name: 'Search transactions' })
    expect(search).toHaveAttribute('href', '/account/42/search')
  })

  it('shows the empty-state message when there are no transactions', () => {
    renderView([])
    expect(screen.getByText('No transactions yet.')).toBeInTheDocument()
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
    expect(heading).toHaveTextContent(/10\. Mai 2026/)
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
})
