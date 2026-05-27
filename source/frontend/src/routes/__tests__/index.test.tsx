import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

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

import { OverviewView } from '@/routes/index'

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
  return render(<OverviewView user={user} showProgressBar={false} progressVisualHint={0} />)
}

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
    expect(cta).toHaveAttribute('href', '/settings/credentials')
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
            { id: 1, name: 'TR Cash', display_name: null, balance: 50, balance_factor: 100 },
          ],
          last_fetching_timestamp: null,
          requires_two_factor_authentication: false,
        },
        {
          id: 11,
          bank: 'ing',
          accounts: [
            { id: 2, name: 'Tagesgeld', display_name: null, balance: 1000, balance_factor: 100 },
            { id: 3, name: 'Girokonto', display_name: null, balance: -200, balance_factor: 100 },
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

  it('renders negative account balances in the destructive color', () => {
    const user = buildUser({
      credentials: [
        {
          id: 1,
          bank: 'ing',
          accounts: [
            { id: 7, name: 'Overdrawn', display_name: null, balance: -150.5, balance_factor: 100 },
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
