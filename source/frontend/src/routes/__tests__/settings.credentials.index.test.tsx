import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import '@/i18n'

vi.mock('@tanstack/react-router', async () => (await import('./-routerMock')).routerMocks())

import { SettingsCredentialsIndexView } from '@/pages/settings.credentials.index'
import { Route } from '@/routes/settings.credentials.index'
import type { CredentialRead } from '@/lib/auth'
import { buildUser, jsonResponse, renderWithQuery } from '@/test/helpers'
import { DATETIME_RECENT } from '@/test/constants'
import { buildCredential } from '@/test/statsFixtures'

function renderList(...credentials: CredentialRead[]) {
  render(<SettingsCredentialsIndexView user={buildUser({ credentials })} />)
}

describe('SettingsCredentialsIndexView', () => {
  it('renders the empty state with a back link and no groups editor link', () => {
    renderList()

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Bank connections')
    expect(screen.getByText('No banks connected yet.')).toBeInTheDocument()
    // The "Add bank" call-to-action is always visible.
    expect(screen.getByRole('link', { name: /Add bank/i })).toHaveAttribute(
      'href',
      '/settings/credentials/new',
    )
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/settings')
    expect(screen.queryByRole('link', { name: /Arrange & group accounts/ })).not.toBeInTheDocument()
  })

  it('lists each credential with its bank title sorted alphabetically by localised label', () => {
    renderList(
      buildCredential([], { id: 1, bank: 'trade_republic' }),
      buildCredential([], { id: 2, bank: 'fints' }),
      buildCredential([], { id: 3, bank: 'dfs' }),
    )

    const rows = screen.getAllByRole('listitem')
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('DFS'),
      expect.stringContaining('FinTS bank'),
      expect.stringContaining('Trade Republic'),
    ])
  })

  it('links each credential to its detail page and shows the last-sync timestamp', () => {
    renderList(
      buildCredential([], {
        id: 42,
        bank: 'fints',
        bank_name: 'ING',
        bank_icon: '/static/banks/ing-diba.png',
        last_successful_sync_timestamp: DATETIME_RECENT,
      }),
    )

    // A generic FinTS credential shows its resolved bank name + logo, not "FinTS bank".
    const link = screen.getByRole('link', { name: /ING/ })
    expect(link).toHaveAttribute('href', '/settings/credentials/42')
    expect(link.querySelector('img')).toHaveAttribute('src', '/static/banks/ing-diba.png')
    // The row's secondary line carries the last-synced caption.
    expect(screen.getByText(/Last updated:/)).toBeInTheDocument()
  })

  it('shows a "never synced" hint when there is no last_successful_sync_timestamp', () => {
    renderList(buildCredential([], { bank: 'fints', last_successful_sync_timestamp: null }))
    expect(screen.getByText('Never synced')).toBeInTheDocument()
  })

  it('says nothing about syncing on a manual credential — it never syncs', () => {
    renderList(buildCredential([], { bank: 'manual', last_successful_sync_timestamp: null }))
    expect(screen.queryByText('Never synced')).not.toBeInTheDocument()
    expect(screen.queryByText(/Last updated/)).not.toBeInTheDocument()
  })

  it('replaces the last-synced caption with a failure hint when the last sync failed', () => {
    renderList(
      buildCredential([], {
        bank: 'fints',
        last_successful_sync_timestamp: DATETIME_RECENT,
        last_sync_error: 'the bank rejected the login',
        last_sync_error_code: 'invalid_credentials',
      }),
    )

    expect(screen.getByText('Sync failed')).toBeInTheDocument()
    expect(screen.queryByText(/Last updated:/)).not.toBeInTheDocument()
  })

  it('shows a link to the groups editor when at least one credential exists', () => {
    renderList(buildCredential([], { id: 1, bank: 'ing' }))
    const link = screen.getByRole('link', { name: /Arrange & group accounts/ })
    expect(link).toHaveAttribute('href', '/settings/credentials/groups')
  })
})

describe('/settings/credentials/ route', () => {
  it('renders nothing until the signed-in user is loaded, then lists their banks', async () => {
    let respond: (response: Response) => void = () => {}
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () => new Promise((resolve) => (respond = resolve)),
    )
    const Page = Route.options.component!
    const { container } = renderWithQuery(<Page />)
    expect(container).toBeEmptyDOMElement()

    respond(
      jsonResponse({
        status: 200,
        body: buildUser({ credentials: [buildCredential([], { bank: 'trade_republic' })] }),
      }),
    )

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Bank connections')
    expect(screen.getByRole('link', { name: /Trade Republic/ })).toHaveAttribute(
      'href',
      '/settings/credentials/1',
    )
  })
})
