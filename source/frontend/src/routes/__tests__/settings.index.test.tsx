import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import '@/i18n'

const navigate = vi.hoisted(() => vi.fn())

// TanStack Router's <Link> needs a router context. Replace with a plain anchor
// so we can assert hrefs; stub createFileRoute / useRouter so the module loads.
vi.mock('@tanstack/react-router', async () =>
  (await import('./-routerMock')).routerMocks({
    useRouter: () => ({ history: { push: vi.fn() } }),
    useNavigate: () => navigate,
  }),
)

import { SettingsIndexView } from '@/pages/settings.index'
import type { AccountShareInvitation } from '@/lib/auth'
import { jsonResponse, renderWithQuery } from './-settingsUserTestHelpers'
import { ACCOUNT_NAME_GIRO } from '@/test/constants'

const INVITATION: AccountShareInvitation = {
  id: 7,
  credential_id: 12,
  account_name: ACCOUNT_NAME_GIRO,
  bank_name: 'FinTS',
  owner_name: 'Bob',
  permission: 'read',
}

describe('SettingsIndexView', () => {
  it('renders the heading and links to each settings sub-page', () => {
    render(<SettingsIndexView logoutPending={false} onLogout={vi.fn()} />)

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Settings')
    const links = screen
      .getAllByRole('link')
      .filter((link) => link.getAttribute('href')?.startsWith('/settings/'))
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/settings/credentials',
      '/settings/user/notifications',
      '/settings/user/profile',
      '/settings/user/appearance',
      '/settings/user/authentication',
      '/settings/user/api-keys',
      '/settings/user/sessions',
      '/settings/version',
      '/settings/attributions',
      '/settings/user/delete',
    ])
    expect(screen.getByRole('link', { name: /Notification history/ })).toHaveAttribute(
      'href',
      '/notifications',
    )
  })

  it('shows the default version description when no update is available', () => {
    render(
      <SettingsIndexView
        logoutPending={false}
        onLogout={vi.fn()}
        serverVersion={{
          current: '0.1.11',
          latest: '0.1.9',
          update_available: false,
          release_url: null,
        }}
      />,
    )
    expect(screen.getByText('Current and latest available version')).toBeInTheDocument()
  })

  it('announces an available update in the description', () => {
    render(
      <SettingsIndexView
        logoutPending={false}
        onLogout={vi.fn()}
        serverVersion={{
          current: '0.1.0',
          latest: '0.1.9',
          update_available: true,
          release_url: 'https://x/0.1.9',
        }}
      />,
    )
    expect(screen.getByText('Update available: 0.1.9')).toBeInTheDocument()
  })

  it('includes a back link to the overview', () => {
    render(<SettingsIndexView logoutPending={false} onLogout={vi.fn()} />)
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/')
  })

  it('invokes onLogout when the logout button is clicked', async () => {
    const user = userEvent.setup()
    const onLogout = vi.fn()
    render(<SettingsIndexView logoutPending={false} onLogout={onLogout} />)

    await user.click(screen.getByRole('button', { name: 'Log out' }))
    expect(onLogout).toHaveBeenCalledTimes(1)
  })

  it('disables the logout button while a logout is in flight', () => {
    render(<SettingsIndexView logoutPending={true} onLogout={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Log out' })).toBeDisabled()
  })

  it('opens the shared connection settings after an invitation is accepted', async () => {
    const user = userEvent.setup()
    navigate.mockClear()
    globalThis.fetch = vi.fn(async () => jsonResponse({ status: 204 })) as unknown as typeof fetch

    renderWithQuery(
      <SettingsIndexView logoutPending={false} onLogout={vi.fn()} invitations={[INVITATION]} />,
    )
    await user.click(screen.getByRole('button', { name: 'Accept' }))

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: '/settings/credentials/$credentialId',
        params: { credentialId: '12' },
      }),
    )
  })

  it('stays in the settings when an invitation is declined', async () => {
    const user = userEvent.setup()
    navigate.mockClear()
    globalThis.fetch = vi.fn(async () => jsonResponse({ status: 204 })) as unknown as typeof fetch

    renderWithQuery(
      <SettingsIndexView logoutPending={false} onLogout={vi.fn()} invitations={[INVITATION]} />,
    )
    await user.click(screen.getByRole('button', { name: 'Decline' }))

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    expect(navigate).not.toHaveBeenCalled()
  })
})
