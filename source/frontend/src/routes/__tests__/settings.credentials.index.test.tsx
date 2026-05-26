import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import '@/i18n'

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
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => {
    let href = to
    if (params)
      for (const [key, value] of Object.entries(params)) href = href.replace(`$${key}`, value)
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    )
  },
  createFileRoute: () => () => ({}),
}))

import { SettingsCredentialsIndexView } from '@/routes/settings.credentials.index'
import type { CredentialRead, UserRead } from '@/lib/auth'

function buildUser(credentials: CredentialRead[] = []): UserRead {
  return {
    id: 1,
    user_name: 'alice',
    display_name: 'Alice',
    language: 'en',
    balance: 0,
    credentials,
  }
}

function buildCredential(overrides: Partial<CredentialRead>): CredentialRead {
  return {
    id: 10,
    bank: 'ing',
    accounts: [],
    last_fetching_timestamp: null,
    requires_two_factor_authentication: false,
    ...overrides,
  }
}

describe('SettingsCredentialsIndexView', () => {
  it('renders the empty state when the user has no credentials', () => {
    render(<SettingsCredentialsIndexView user={buildUser([])} />)

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Bank connections')
    expect(screen.getByText('No banks connected yet.')).toBeInTheDocument()
    // The "Add bank" call-to-action is always visible.
    expect(screen.getByRole('link', { name: /Add bank/i })).toHaveAttribute(
      'href',
      '/settings/credentials/new',
    )
  })

  it('lists each credential with its bank title sorted alphabetically by localised label', () => {
    render(
      <SettingsCredentialsIndexView
        user={buildUser([
          buildCredential({ id: 1, bank: 'trade_republic' }),
          buildCredential({ id: 2, bank: 'ing' }),
          buildCredential({ id: 3, bank: 'dfs' }),
        ])}
      />,
    )

    const rows = screen.getAllByRole('listitem')
    // Banks sorted by localised title: DFS, ING, Trade Republic.
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('DFS'),
      expect.stringContaining('ING'),
      expect.stringContaining('Trade Republic'),
    ])
  })

  it('links each credential to its detail page and shows the last-sync timestamp', () => {
    render(
      <SettingsCredentialsIndexView
        user={buildUser([
          buildCredential({ id: 42, bank: 'ing', last_fetching_timestamp: '2026-05-20T10:00:00Z' }),
        ])}
      />,
    )

    const link = screen.getByRole('link', { name: /ING/ })
    expect(link).toHaveAttribute('href', '/settings/credentials/42')
    // The row's secondary line carries the last-synced caption.
    expect(screen.getByText(/Last synced:/)).toBeInTheDocument()
  })

  it('shows a "never synced" hint when there is no last_fetching_timestamp', () => {
    render(
      <SettingsCredentialsIndexView
        user={buildUser([
          buildCredential({ id: 7, bank: 'manual', last_fetching_timestamp: null }),
        ])}
      />,
    )
    expect(screen.getByText('Never synced')).toBeInTheDocument()
  })

  it('includes a back link to /settings', () => {
    render(<SettingsCredentialsIndexView user={buildUser([])} />)
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/settings')
  })
})
