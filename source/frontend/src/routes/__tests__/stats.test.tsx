import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import '@/i18n'
import type { CredentialRead } from '@/lib/auth'

// Recharts measures its container (0×0 in jsdom) and renders SVG we don't assert
// on — swap every export for a passthrough so the view mounts cleanly.
vi.mock('recharts', () => {
  const Passthrough = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>
  return new Proxy({}, { get: () => Passthrough })
})

// The charts fetch via `api`; resolve to empty so queries settle without network.
vi.mock('@/lib/api', () => ({
  api: vi.fn((path: string) =>
    Promise.resolve(path.includes('/net-worth') ? { series: [], summary: null } : []),
  ),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    ...rest
  }: { to: string; children: React.ReactNode } & Omit<
    React.AnchorHTMLAttributes<HTMLAnchorElement>,
    'children'
  >) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
  createFileRoute: () => () => ({}),
  useNavigate: () => vi.fn(),
}))

import { StatsView, type StatsSearchParams } from '@/routes/stats'

const credentials: CredentialRead[] = [
  {
    id: 1,
    bank: 'ing',
    bank_name: null,
    bank_icon: null,
    accounts: [
      {
        id: 42,
        name: 'Girokonto',
        balance: 0,
        balance_factor: 100,
        display_name: null,
        is_hidden: false,
      },
    ],
    last_fetching_timestamp: null,
    requires_two_factor_authentication: false,
  },
]

function renderView(search: Partial<StatsSearchParams> = {}) {
  const onChange = vi.fn()
  const onOpenSearch = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <StatsView
        credentials={credentials}
        search={search as StatsSearchParams}
        onChange={onChange}
        onOpenSearch={onOpenSearch}
      />
    </QueryClientProvider>,
  )
  return { onChange, onOpenSearch }
}

describe('StatsView', () => {
  it('renders the filter controls and chart sections', () => {
    renderView()
    expect(screen.getByRole('heading', { name: 'Statistics' })).toBeInTheDocument()
    expect(screen.getByLabelText('Accounts')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Direction' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Chart type' })).toBeInTheDocument()
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

  it('fires onChange with chartType pie when switching the category chart to Pie', async () => {
    const user = userEvent.setup()
    const { onChange } = renderView()

    await user.click(screen.getByRole('button', { name: 'Pie' }))

    expect(onChange.mock.calls.at(-1)?.[0].chartType).toBe('pie')
  })

  it('defaults direction to OUTGOING (expense focus)', async () => {
    const user = userEvent.setup()
    const { onChange } = renderView()

    // Any change echoes the current state; direction starts as OUTGOING.
    await user.click(screen.getByRole('button', { name: 'Bar' }))

    expect(onChange.mock.calls.at(-1)?.[0].direction).toBe('OUTGOING')
  })
})
