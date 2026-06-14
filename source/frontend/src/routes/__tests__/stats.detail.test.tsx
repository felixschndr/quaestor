import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import '@/i18n'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    params,
    ...rest
  }: {
    to: string
    children: React.ReactNode
    params?: Record<string, string>
  } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'children'>) => {
    void params // not forwarded to the DOM <a> in this mock
    return (
      <a href={to} {...rest}>
        {children}
      </a>
    )
  },
  createFileRoute: () => () => ({
    useSearch: () => ({ account_ids: [42, 43], end: '2026-05-20' }),
  }),
  useNavigate: () => vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  useAuthMe: () => ({
    data: {
      credentials: [
        {
          id: 1,
          bank: 'ing',
          bank_name: null,
          bank_icon: null,
          last_fetching_timestamp: null,
          requires_two_factor_authentication: false,
          accounts: [
            {
              id: 42,
              name: 'Girokonto',
              display_name: null,
              balance: 130,
              balance_factor: 100,
              is_hidden: false,
            },
            {
              id: 43,
              name: 'Depot',
              display_name: null,
              balance: 500,
              balance_factor: 100,
              is_hidden: false,
            },
          ],
        },
      ],
    },
  }),
}))

vi.mock('@/lib/accountGroups', () => ({
  useAccountGroupLayout: () => ({ data: undefined }),
}))

vi.mock('@/lib/statistics', () => ({
  useNetWorthRange: () => ({
    isLoading: false,
    isError: false,
    data: {
      start: '2026-05-19',
      end: '2026-05-20',
      total_at_start: 350,
      total_at_end: 630,
      total_difference: 280,
      accounts: [
        {
          account_id: 42,
          balance_at_start: 100,
          balance_at_end: 130,
          difference: 30,
          transactions: [
            {
              id: 1,
              account_id: 42,
              amount: 30,
              purpose: null,
              date: '2026-05-20',
              other_party: 'Rewe',
              transaction_type: null,
              category: 'UNKNOWN',
              note: null,
            },
          ],
        },
        // A depot whose balance moved without any booked transaction (market valuation).
        {
          account_id: 43,
          balance_at_start: 250,
          balance_at_end: 500,
          difference: 250,
          transactions: [],
        },
      ],
    },
  }),
}))

import { NetWorthDetailPage } from '@/routes/stats_.detail'

describe('NetWorthDetailPage', () => {
  it('lists the selected accounts and reveals their transactions on expand', async () => {
    render(<NetWorthDetailPage />)

    expect(screen.getByText('Girokonto')).toBeInTheDocument()
    expect(screen.getByText('Depot')).toBeInTheDocument()
    // Transactions are collapsed initially.
    expect(screen.queryByText('Rewe')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Girokonto/ }))
    expect(screen.getByText('Rewe')).toBeInTheDocument()

    // The depot has no transactions to explain its market-driven change.
    await userEvent.click(screen.getByRole('button', { name: /Depot/ }))
    expect(screen.getByText('No transactions in this period')).toBeInTheDocument()
  })
})
