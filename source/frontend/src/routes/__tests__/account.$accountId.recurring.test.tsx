import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import '@/i18n'
import type { AccountRead } from '@/lib/auth'
import { formatDateWithoutYear } from '@/lib/format'
import type { RecurringTransactionRead } from '@/lib/recurringTransaction'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...rest }: { children: React.ReactNode }) => <a {...rest}>{children}</a>,
  createFileRoute: () => () => ({}),
}))

vi.mock('@/lib/recurringTransaction', () => ({
  useRecurringTransactions: vi.fn(),
  useDeleteRecurringTransaction: vi.fn(),
}))

import { useDeleteRecurringTransaction, useRecurringTransactions } from '@/lib/recurringTransaction'
import { AccountDetailView } from '@/routes/account.$accountId'

const mockedList = vi.mocked(useRecurringTransactions)
const mockedDelete = vi.mocked(useDeleteRecurringTransaction)

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

const account: AccountRead = {
  id: 42,
  name: 'Wallet',
  display_name: null,
  balance: 1000,
  balance_factor: 100,
  is_hidden: false,
}

function buildRule(overrides: Partial<RecurringTransactionRead> = {}): RecurringTransactionRead {
  return {
    id: 1,
    account_id: 42,
    amount: -50,
    purpose: null,
    other_party: null,
    transaction_type: null,
    category: null,
    note: null,
    frequency: 'MONTHLY',
    day_of_month: 15,
    day_of_week: null,
    next_run_date: '2026-07-15',
    ...overrides,
  }
}

function renderManualAccount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <AccountDetailView
        account={account}
        bank="manual"
        pages={[]}
        isFetchingNextPage={false}
        hasNextPage={false}
        onLoadMore={vi.fn()}
        today={new Date(2026, 6, 1)}
      />
    </QueryClientProvider>,
  )
}

const mutateAsync = vi.fn().mockResolvedValue(undefined)

beforeEach(() => {
  mutateAsync.mockClear()
  mockedDelete.mockReturnValue({ mutateAsync, isPending: false } as unknown as ReturnType<
    typeof useDeleteRecurringTransaction
  >)
  mockedList.mockReturnValue({ data: [] } as unknown as ReturnType<typeof useRecurringTransactions>)
})

describe('RecurringTransactionsList', () => {
  it('renders nothing when there are no rules', () => {
    renderManualAccount()
    expect(screen.queryByText('Recurring transactions')).not.toBeInTheDocument()
  })

  it('lists a monthly rule with its amount, schedule and next run date', () => {
    mockedList.mockReturnValue({ data: [buildRule()] } as unknown as ReturnType<
      typeof useRecurringTransactions
    >)
    renderManualAccount()

    expect(screen.getByText('Recurring transactions')).toBeInTheDocument()
    expect(screen.getByText('-50,00 €')).toBeInTheDocument()
    expect(screen.getByText('Day 15 of the month')).toBeInTheDocument()
    expect(
      screen.getByText(`Next booking: ${formatDateWithoutYear('2026-07-15')}`),
    ).toBeInTheDocument()
  })

  it('pads a single-digit day of month with a leading zero', () => {
    mockedList.mockReturnValue({ data: [buildRule({ day_of_month: 5 })] } as unknown as ReturnType<
      typeof useRecurringTransactions
    >)
    renderManualAccount()

    expect(screen.getByText('Day 05 of the month')).toBeInTheDocument()
    expect(
      screen.getByText(`Next booking: ${formatDateWithoutYear('2026-07-15')}`),
    ).toBeInTheDocument()
  })

  it('describes a weekly rule by weekday', () => {
    mockedList.mockReturnValue({
      data: [buildRule({ frequency: 'WEEKLY', day_of_month: null, day_of_week: 2 })],
    } as unknown as ReturnType<typeof useRecurringTransactions>)
    renderManualAccount()

    expect(screen.getByText('Wednesday')).toBeInTheDocument()
    expect(
      screen.getByText(`Next booking: ${formatDateWithoutYear('2026-07-15')}`),
    ).toBeInTheDocument()
  })

  it('deletes a rule after confirmation', async () => {
    const user = userEvent.setup()
    mockedList.mockReturnValue({ data: [buildRule({ id: 99 })] } as unknown as ReturnType<
      typeof useRecurringTransactions
    >)
    renderManualAccount()

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Really delete?' }))

    expect(mutateAsync).toHaveBeenCalledWith(99)
  })
})
