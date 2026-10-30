import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import '@/i18n'

const navigate = vi.hoisted(() => vi.fn())
const historyPush = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())

// TanStack Router's <Link> needs a router context. Replace with a plain anchor
// so we can assert hrefs; stub createFileRoute / useRouter so the module loads.
vi.mock('@tanstack/react-router', async () =>
  (await import('./-routerMock')).routerMocks({
    useRouter: () => ({ history: { push: historyPush } }),
    useNavigate: () => navigate,
  }),
)
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: toastError } }))

import { SettingsIndexView } from '@/pages/settings.index'
import type { AccountShareInvitation, CredentialRead } from '@/lib/auth'
import { Route } from '@/routes/settings.index'
import { buildUser, jsonResponse, renderWithQuery } from '@/test/helpers'
import { ACCOUNT_NAME_GIRO, VERSION_CURRENT, VERSION_LATEST } from '@/test/constants'

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
      '/settings/user/categorization',
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

  it('reports a failed invitation response and stays in the settings', async () => {
    const user = userEvent.setup()
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ status: 500, body: { detail: 'boom' } }),
    ) as unknown as typeof fetch

    renderWithQuery(
      <SettingsIndexView logoutPending={false} onLogout={vi.fn()} invitations={[INVITATION]} />,
    )
    await user.click(screen.getByRole('button', { name: 'Accept' }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('The response could not be saved'))
    expect(navigate).not.toHaveBeenCalled()
  })
})

describe('SettingsIndexPage', () => {
  const Page = Route.options.component!

  const FAILING_CREDENTIAL: CredentialRead = {
    id: 3,
    bank: 'fints',
    bank_name: null,
    bank_icon: null,
    accounts: [],
    last_successful_sync_timestamp: null,
    requires_two_factor_authentication: false,
    sync_enabled: true,
    last_sync_error_code: 'invalid_credentials',
  }

  function serve(routes: Record<string, () => Response>) {
    const fetchMock = vi.fn((url: string, init?: { method?: string }) =>
      Promise.resolve(
        routes[`${init?.method ?? 'GET'} ${url}`]?.() ?? jsonResponse({ status: 404 }),
      ),
    )
    globalThis.fetch = fetchMock as unknown as typeof fetch
    return fetchMock
  }

  it('logs out and returns to the login page', async () => {
    const user = userEvent.setup()
    const fetchMock = serve({
      'GET /api/auth/me': () => jsonResponse({ status: 200, body: buildUser() }),
      'POST /api/auth/logout': () => jsonResponse({ status: 204 }),
    })

    renderWithQuery(<Page />)
    await user.click(screen.getByRole('button', { name: 'Log out' }))

    await waitFor(() => expect(historyPush).toHaveBeenCalledWith('/login'))
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/logout',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(toastError).not.toHaveBeenCalled()
  })

  it('stays on the page and reports the error when logging out fails', async () => {
    const user = userEvent.setup()
    serve({
      'GET /api/auth/me': () => jsonResponse({ status: 200, body: buildUser() }),
      'POST /api/auth/logout': () => jsonResponse({ status: 500, body: { detail: 'boom' } }),
    })

    renderWithQuery(<Page />)
    await user.click(screen.getByRole('button', { name: 'Log out' }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Logout failed. Please try again.'))
    expect(historyPush).not.toHaveBeenCalled()
  })

  it('flags failing bank connections and lists pending invitations from the profile', async () => {
    serve({
      'GET /api/auth/me': () =>
        jsonResponse({
          status: 200,
          body: buildUser({
            credentials: [
              FAILING_CREDENTIAL,
              { ...FAILING_CREDENTIAL, id: 4, last_sync_error_code: null },
            ],
            account_share_invitations: [INVITATION],
          }),
        }),
    })

    renderWithQuery(<Page />)

    expect(await screen.findByText('1 bank connection needs attention')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Accept' })).toBeInTheDocument()
  })

  it('announces a server update even when the profile is not loaded', async () => {
    serve({
      'GET /api/auth/me': () => jsonResponse({ status: 401 }),
      'GET /api/version': () =>
        jsonResponse({
          status: 200,
          body: {
            current: VERSION_CURRENT,
            latest: VERSION_LATEST,
            update_available: true,
            release_url: null,
          },
        }),
    })

    renderWithQuery(<Page />)

    expect(await screen.findByText(`Update available: ${VERSION_LATEST}`)).toBeInTheDocument()
    expect(screen.getByText('Add, edit or remove banks')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument()
  })
})
