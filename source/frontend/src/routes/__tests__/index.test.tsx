import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import '@/i18n'
import type { UserRead } from '@/lib/auth'

// TanStack Router's <Link> needs a router context, which is more setup than
// this test needs. Replace it with a plain anchor so we can assert on href.
// Also stub createFileRoute so importing the route module doesn't try to wire
// itself into a real route tree at import time.
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

import { OverviewView, sumFactoredBalance } from '@/routes/index'

function buildUser(overrides: Partial<UserRead> = {}): UserRead {
  return {
    id: 1,
    user_name: 'alice',
    display_name: 'Alice',
    language: 'en',
    theme: 'SYSTEM',
    balance: 0,
    credentials: [],
    ...overrides,
  }
}

function render_(user: UserRead) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <OverviewView user={user} onSyncClick={() => {}} syncDisabled={false} syncSpinning={false} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  // Collapsed-group state is persisted to localStorage; clear it so each test
  // starts with every group expanded.
  window.localStorage.clear()
  // Stub the /account_groups/layout fetch; the default (no custom groups)
  // returns an empty layout so the overview falls back to "by bank".
  globalThis.fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ groups: [], ungrouped: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  ) as unknown as typeof fetch
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('OverviewView', () => {
  it('greets with display_name when set', () => {
    render_(buildUser({ display_name: 'Alice' }))
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Hello, Alice')
  })

  it('falls back to user_name when display_name is blank', () => {
    render_(buildUser({ display_name: '', user_name: 'alice_user' }))
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Hello, alice_user')
  })

  it('renders the total balance formatted as EUR (de-DE locale)', () => {
    render_(buildUser({ balance: 1234.5 }))
    expect(screen.getByText('1.234,50 €')).toBeInTheDocument()
  })

  it('shows the empty state and a CTA linking to /settings/credentials when there are no accounts', () => {
    render_(buildUser({ credentials: [] }))
    expect(screen.getByText('No accounts yet')).toBeInTheDocument()
    const cta = screen.getByRole('link', { name: 'Connect your first bank' })
    expect(cta).toHaveAttribute('href', '/settings/credentials/new')
  })

  it('renders the cog link to /settings', () => {
    render_(buildUser())
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings')
  })

  it('groups accounts by bank (alphabetical) and sorts accounts within each bank', () => {
    const user = buildUser({
      credentials: [
        {
          id: 10,
          bank: 'trade_republic',
          accounts: [
            {
              id: 1,
              name: 'TR Cash',
              display_name: null,
              balance: 50,
              balance_factor: 100,
              is_hidden: false,
            },
          ],
          last_fetching_timestamp: null,
          requires_two_factor_authentication: false,
        },
        {
          id: 11,
          bank: 'ing',
          accounts: [
            {
              id: 2,
              name: 'Tagesgeld',
              display_name: null,
              balance: 1000,
              balance_factor: 100,
              is_hidden: false,
            },
            {
              id: 3,
              name: 'Girokonto',
              display_name: null,
              balance: -200,
              balance_factor: 100,
              is_hidden: false,
            },
          ],
          last_fetching_timestamp: null,
          requires_two_factor_authentication: false,
        },
      ],
    })

    render_(user)
    const accountLinks = screen
      .getAllByRole('link')
      .filter((link) => link.getAttribute('href')?.startsWith('/account/'))
    // ing rows come first (banks alphabetical: ing < trade_republic);
    // within ing, Girokonto < Tagesgeld.
    expect(accountLinks.map((link) => link.textContent)).toEqual([
      expect.stringContaining('Girokonto'),
      expect.stringContaining('Tagesgeld'),
      expect.stringContaining('TR Cash'),
    ])
    expect(accountLinks.map((link) => link.getAttribute('href'))).toEqual([
      '/account/3',
      '/account/2',
      '/account/1',
    ])
  })

  it('uses the personalised name instead of the IBAN when set, and only that', () => {
    const user = buildUser({
      credentials: [
        {
          id: 1,
          bank: 'ing',
          accounts: [
            {
              id: 8,
              name: 'DE12345678900001',
              display_name: 'Gehaltskonto',
              balance: 100,
              balance_factor: 100,
              is_hidden: false,
            },
          ],
          last_fetching_timestamp: null,
          requires_two_factor_authentication: false,
        },
      ],
    })
    render_(user)
    // The personalised name shows up.
    expect(screen.getByText('Gehaltskonto')).toBeInTheDocument()
    // The IBAN does NOT — the overview is supposed to be just the personalised name.
    expect(screen.queryByText('DE12 3456 7890 0001')).not.toBeInTheDocument()
  })

  it('renders custom group headings when the user has defined account groups', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          groups: [{ id: 100, name: 'Spar', accounts: [{ id: 8 }] }],
          ungrouped: [],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as unknown as typeof fetch

    const user = buildUser({
      credentials: [
        {
          id: 1,
          bank: 'ing',
          accounts: [
            {
              id: 8,
              name: 'DE12345678900001',
              display_name: 'Gehaltskonto',
              balance: 100,
              balance_factor: 100,
              is_hidden: false,
            },
          ],
          last_fetching_timestamp: null,
          requires_two_factor_authentication: false,
        },
      ],
    })
    render_(user)

    const heading = await screen.findByRole('heading', { level: 2, name: 'Spar' })
    expect(heading).toBeInTheDocument()
  })

  it('shows a factored total next to each custom group heading', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          groups: [{ id: 100, name: 'Spar', accounts: [{ id: 8 }, { id: 9 }] }],
          ungrouped: [{ id: 10 }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as unknown as typeof fetch

    const user = buildUser({
      credentials: [
        {
          id: 1,
          bank: 'ing',
          accounts: [
            // Factored: 100 * 100 / 100 = 100
            {
              id: 8,
              name: 'Acc8',
              display_name: null,
              balance: 100,
              balance_factor: 100,
              is_hidden: false,
            },
            // Factored: 200 * 50 / 100 = 100  →  group total = 200,00 €
            {
              id: 9,
              name: 'Acc9',
              display_name: null,
              balance: 200,
              balance_factor: 50,
              is_hidden: false,
            },
            // Ungrouped factored: -50 * 100 / 100 = -50  →  destructive color
            {
              id: 10,
              name: 'Acc10',
              display_name: null,
              balance: -50,
              balance_factor: 100,
              is_hidden: false,
            },
          ],
          last_fetching_timestamp: null,
          requires_two_factor_authentication: false,
        },
      ],
    })
    render_(user)

    const sparHeading = await screen.findByRole('heading', { level: 2, name: 'Spar' })
    expect(sparHeading.parentElement).toHaveTextContent('200,00 €')

    const ungroupedHeading = await screen.findByRole('heading', { level: 2, name: 'Without group' })
    const total = ungroupedHeading.parentElement?.querySelector('span')
    expect(total).toHaveTextContent('-50,00 €')
    // Group totals share the muted heading color regardless of sign — they're a
    // subtle subtotal, not a primary number.
    expect(total?.className).toMatch(/text-muted-foreground/)
  })

  it('renders the "without group" heading when the layout has ungrouped accounts', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          groups: [{ id: 100, name: 'Spar', accounts: [] }],
          ungrouped: [{ id: 8 }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as unknown as typeof fetch

    const user = buildUser({
      credentials: [
        {
          id: 1,
          bank: 'ing',
          accounts: [
            {
              id: 8,
              name: 'DE12345678900001',
              display_name: 'Gehaltskonto',
              balance: 100,
              balance_factor: 100,
              is_hidden: false,
            },
          ],
          last_fetching_timestamp: null,
          requires_two_factor_authentication: false,
        },
      ],
    })
    render_(user)

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Without group' }),
    ).toBeInTheDocument()
  })

  it('omits hidden accounts from the list and from group totals', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          groups: [{ id: 1, name: 'Spar', accounts: [{ id: 11 }, { id: 12 }] }],
          ungrouped: [],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as unknown as typeof fetch

    const user = buildUser({
      credentials: [
        {
          id: 1,
          bank: 'ing',
          accounts: [
            {
              id: 11,
              name: 'Visible',
              display_name: null,
              balance: 100,
              balance_factor: 100,
              is_hidden: false,
            },
            {
              id: 12,
              name: 'HiddenSub',
              display_name: null,
              balance: 9999,
              balance_factor: 100,
              is_hidden: true,
            },
          ],
          last_fetching_timestamp: null,
          requires_two_factor_authentication: false,
        },
      ],
    })
    render_(user)

    const heading = await screen.findByRole('heading', { level: 2, name: 'Spar' })
    // Group total = 100 only (hidden 9999 doesn't count).
    expect(heading.parentElement).toHaveTextContent('100,00 €')
    expect(screen.getByText('Visible')).toBeInTheDocument()
    // The hidden account's IBAN-formatted name must not surface anywhere.
    expect(screen.queryByText('HiddenSub')).not.toBeInTheDocument()
  })

  it('applies balance_factor as a percentage when summing group totals', () => {
    expect(
      sumFactoredBalance([
        { balance: 100, balance_factor: 100 },
        { balance: 200, balance_factor: 50 },
        { balance: -40, balance_factor: 25 },
      ]),
    ).toBe(100 + 100 - 10)
    expect(sumFactoredBalance([])).toBe(0)
  })

  function buildGroupedUser() {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          groups: [{ id: 100, name: 'Spar', accounts: [{ id: 8 }] }],
          ungrouped: [],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as unknown as typeof fetch

    return buildUser({
      credentials: [
        {
          id: 1,
          bank: 'ing',
          accounts: [
            {
              id: 8,
              name: 'Gehaltskonto',
              display_name: 'Gehaltskonto',
              balance: 100,
              balance_factor: 100,
              is_hidden: false,
            },
          ],
          last_fetching_timestamp: null,
          requires_two_factor_authentication: false,
        },
      ],
    })
  }

  it('collapses a group when its heading is clicked, hiding the accounts', async () => {
    render_(buildGroupedUser())
    const trigger = await screen.findByRole('button', { name: /Spar/ })
    expect(screen.getByText('Gehaltskonto')).toBeInTheDocument()

    await userEvent.click(trigger)

    await waitFor(() => expect(screen.queryByText('Gehaltskonto')).not.toBeInTheDocument())
  })

  it('flips aria-expanded on the group trigger when toggled', async () => {
    render_(buildGroupedUser())
    const trigger = await screen.findByRole('button', { name: /Spar/ })
    expect(trigger).toHaveAttribute('aria-expanded', 'true')

    await userEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('keeps the group total visible while collapsed', async () => {
    render_(buildGroupedUser())
    const trigger = await screen.findByRole('button', { name: /Spar/ })

    await userEvent.click(trigger)

    await waitFor(() => expect(screen.queryByText('Gehaltskonto')).not.toBeInTheDocument())
    expect(trigger).toHaveTextContent('100,00 €')
  })

  it('does not render a collapse trigger for the legacy by-bank layout', () => {
    const user = buildUser({
      credentials: [
        {
          id: 1,
          bank: 'ing',
          accounts: [
            {
              id: 2,
              name: 'Girokonto',
              display_name: null,
              balance: 100,
              balance_factor: 100,
              is_hidden: false,
            },
          ],
          last_fetching_timestamp: null,
          requires_two_factor_authentication: false,
        },
      ],
    })
    render_(user)
    expect(screen.getByText('Girokonto')).toBeInTheDocument()
    expect(document.querySelector('[aria-expanded]')).toBeNull()
  })

  it('renders negative account balances in the destructive color', () => {
    const user = buildUser({
      credentials: [
        {
          id: 1,
          bank: 'ing',
          accounts: [
            {
              id: 7,
              name: 'Overdrawn',
              display_name: null,
              balance: -150.5,
              balance_factor: 100,
              is_hidden: false,
            },
          ],
          last_fetching_timestamp: null,
          requires_two_factor_authentication: false,
        },
      ],
    })
    render_(user)
    const amount = screen.getByText('-150,50 €')
    expect(amount.className).toMatch(/text-destructive/)
  })
})
