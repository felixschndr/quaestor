import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import '@/i18n'

const routerState = vi.hoisted(() => ({
  search: { account_ids: [42, 43], end: '2026-05-20' } as Record<string, unknown>,
  navigate: vi.fn(),
  back: vi.fn(),
  canGoBack: true,
}))

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
    useSearch: () => routerState.search,
  }),
  getRouteApi: () => ({
    useSearch: () => routerState.search,
  }),
  useNavigate: () => routerState.navigate,
  useRouter: () => ({ history: { back: routerState.back } }),
  useCanGoBack: () => routerState.canGoBack,
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
              balance_factor: 150,
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

import { NetWorthDetailPage } from '@/pages/stats_.detail'

describe('NetWorthDetailPage', () => {
  beforeEach(() => {
    routerState.search = { account_ids: [42, 43], end: '2026-05-20' }
    routerState.canGoBack = true
    routerState.navigate.mockClear()
    routerState.back.mockClear()
  })

  it('returns through history so the stats filters are restored', async () => {
    render(<NetWorthDetailPage />)

    await userEvent.click(screen.getByRole('link', { name: 'Back to statistics' }))
    expect(routerState.back).toHaveBeenCalledTimes(1)
  })

  it('falls back to the stats link when there is no history to go back to', async () => {
    routerState.canGoBack = false
    render(<NetWorthDetailPage />)

    const back = screen.getByRole('link', { name: 'Back to statistics' })
    expect(back).toHaveAttribute('href', '/stats')
    await userEvent.click(back)
    expect(routerState.back).not.toHaveBeenCalled()
  })

  it('keeps a row collapsed until it is in the expanded URL state', async () => {
    render(<NetWorthDetailPage />)

    expect(screen.getByText('Girokonto')).toBeInTheDocument()
    expect(screen.getByText('Depot')).toBeInTheDocument()
    expect(screen.queryByText('Rewe')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Girokonto/ }))
    expect(routerState.navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '/stats/detail',
        replace: true,
        search: expect.objectContaining({ expanded: [42] }),
      }),
    )
  })

  it('reveals the transactions of rows listed in the expanded URL state', () => {
    routerState.search = { account_ids: [42, 43], end: '2026-05-20', expanded: [42, 43] }
    render(<NetWorthDetailPage />)

    expect(screen.getByText('Rewe')).toBeInTheDocument()
    // The depot has no transactions to explain its market-driven change.
    expect(screen.getByText('No transactions in this period')).toBeInTheDocument()
  })

  it('weighs the total by each account balance factor and shows the factor', async () => {
    render(<NetWorthDetailPage />)

    expect(screen.getByText('x 1,50')).toBeInTheDocument()

    // Total at end = 130 * 1.0 + 500 * 1.5 = 880; difference = 30 * 1.0 + 250 * 1.5 = 405.
    expect(screen.getByText('880,00 €')).toBeInTheDocument()
    expect(screen.getByText('+405,00 €')).toBeInTheDocument()
  })
})
