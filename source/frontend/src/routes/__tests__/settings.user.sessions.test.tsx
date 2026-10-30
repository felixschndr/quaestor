import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from 'i18next'

import '@/i18n'
import {
  buildUser,
  jsonResponse,
  renderWithQuery,
  requestsTo,
  serve,
  type Served,
} from '@/test/helpers'
import { DATETIME_CREATED_NEWER, DATETIME_RECENT, DATETIME_UPDATED } from '@/test/constants'

const historyPush = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-router', async () =>
  (await import('./-routerMock')).routerMocks({
    useRouter: () => ({ history: { push: historyPush } }),
  }),
)

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

import { SettingsSessionsView } from '@/pages/settings.user.sessions'
import { Route } from '@/routes/settings.user.sessions'
import type { SessionRead } from '@/lib/sessions'

function buildSession(overrides: Partial<SessionRead> = {}): SessionRead {
  return {
    id: 10,
    created_at: DATETIME_RECENT,
    last_used_at: '2026-05-26T09:00:00Z',
    ip: '203.0.113.7',
    user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Safari/605.1.15',
    is_current: false,
    ...overrides,
  }
}

beforeEach(async () => {
  globalThis.fetch = vi.fn() as unknown as typeof fetch
  document.cookie = ''
  await i18n.changeLanguage('en')
})

const GENERIC_ERROR = 'Something went wrong. Please try again.'
const FAILURE = { status: 500, body: { detail: 'boom' } }
const SESSIONS_URL = '/api/users/1/sessions'
const CURRENT = buildSession({ id: 11, is_current: true, user_agent: 'Chrome/130' })
const OTHER = buildSession({ id: 10, is_current: false, user_agent: 'Firefox/120' })

function serveSessions(sessions: SessionRead[], extra: Served = {}) {
  serve({ [`GET ${SESSIONS_URL}`]: { status: 200, body: sessions }, ...extra })
}

describe('SettingsSessionsView', () => {
  it('renders one row per session and marks the current one with a badge', async () => {
    serveSessions([OTHER, CURRENT])

    renderWithQuery(<SettingsSessionsView user={buildUser()} />)

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Sessions')
    // Wait for the rows to render.
    const items = await screen.findAllByRole('listitem')
    expect(items).toHaveLength(2)
    // Current session is sorted first.
    expect(within(items[0]).getByText('Current')).toBeInTheDocument()
    expect(within(items[0]).getByText('Chrome/130')).toBeInTheDocument()
    expect(within(items[1]).getByText('Firefox/120')).toBeInTheDocument()
    // Current row exposes a "Log out" button instead of "End session"; the
    // other row uses the regular revoke action.
    expect(within(items[0]).getByRole('button', { name: 'Log out' })).toBeEnabled()
    expect(within(items[0]).queryByRole('button', { name: 'End session' })).not.toBeInTheDocument()
    expect(within(items[1]).getByRole('button', { name: 'End session' })).toBeEnabled()
    expect(within(items[1]).queryByRole('button', { name: 'Log out' })).not.toBeInTheDocument()
  })

  it('logs out via POST /api/auth/logout when the current row button is clicked', async () => {
    const user = userEvent.setup()
    serveSessions([CURRENT], { 'POST /api/auth/logout': { status: 204 } })

    renderWithQuery(<SettingsSessionsView user={buildUser()} />)
    await screen.findByText('Chrome/130')

    await user.click(screen.getByRole('button', { name: 'Log out' }))

    await waitFor(() => expect(requestsTo('POST', '/api/auth/logout')).toHaveLength(1))
    await waitFor(() => expect(historyPush).toHaveBeenCalledWith('/login'))
  })

  it('stays on the page and reports the error when logging out fails', async () => {
    const user = userEvent.setup()
    serveSessions([CURRENT], { 'POST /api/auth/logout': FAILURE })
    renderWithQuery(<SettingsSessionsView user={buildUser()} />)

    await user.click(await screen.findByRole('button', { name: 'Log out' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(GENERIC_ERROR))
    expect(historyPush).not.toHaveBeenCalled()
  })

  it('keeps a session listed and reports the error when ending it fails', async () => {
    const user = userEvent.setup()
    serveSessions([OTHER], { [`DELETE ${SESSIONS_URL}/10`]: FAILURE })
    renderWithQuery(<SettingsSessionsView user={buildUser()} />)

    await user.click(await screen.findByRole('button', { name: 'End session' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(GENERIC_ERROR))
    expect(toast.success).not.toHaveBeenCalled()
    expect(screen.getByText('Firefox/120')).toBeInTheDocument()
  })

  it('reports the error when signing out everywhere else fails', async () => {
    const user = userEvent.setup()
    serveSessions([CURRENT, OTHER], { [`DELETE ${SESSIONS_URL}`]: FAILURE })
    renderWithQuery(<SettingsSessionsView user={buildUser()} />)

    await user.click(await screen.findByRole('button', { name: /Sign out elsewhere/i }))
    await user.click(screen.getByRole('button', { name: /Yes, sign out everywhere else/i }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(GENERIC_ERROR))
    expect(screen.getByText('Firefox/120')).toBeInTheDocument()
  })

  it('confirms an ended session with a toast', async () => {
    const user = userEvent.setup()
    serveSessions([buildSession({ id: 10 })], { [`DELETE ${SESSIONS_URL}/10`]: { status: 204 } })
    renderWithQuery(<SettingsSessionsView user={buildUser()} />)

    await user.click(await screen.findByRole('button', { name: 'End session' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Session ended'))
  })

  it('only disables the row whose session is being ended', async () => {
    const user = userEvent.setup()
    serve(
      {
        [`GET ${SESSIONS_URL}`]: {
          status: 200,
          body: [
            buildSession({ id: 10, user_agent: 'Firefox/120' }),
            buildSession({ id: 12, user_agent: 'Edge/120' }),
          ],
        },
      },
      (_url, init) => (init?.method === 'DELETE' ? new Promise(() => {}) : null),
    )
    renderWithQuery(<SettingsSessionsView user={buildUser()} />)

    const firefox = (await screen.findByText('Firefox/120')).closest('li') as HTMLElement
    const edge = screen.getByText('Edge/120').closest('li') as HTMLElement
    await user.click(within(firefox).getByRole('button', { name: 'End session' }))

    await waitFor(() =>
      expect(within(firefox).getByRole('button', { name: 'End session' })).toBeDisabled(),
    )
    expect(within(edge).getByRole('button', { name: 'End session' })).toBeEnabled()
  })

  it('orders other sessions by last use and fills in unknown device and IP', async () => {
    serveSessions([
      buildSession({ id: 1, user_agent: 'Old/1', last_used_at: DATETIME_RECENT }),
      buildSession({ id: 2, user_agent: null, ip: null, last_used_at: DATETIME_UPDATED }),
      buildSession({ id: 3, user_agent: 'Mid/1', last_used_at: DATETIME_CREATED_NEWER }),
    ])

    renderWithQuery(<SettingsSessionsView user={buildUser()} />)

    const items = await screen.findAllByRole('listitem')
    expect(items.map((item) => item.querySelector('span')?.textContent)).toEqual([
      'Unknown device',
      'Mid/1',
      'Old/1',
    ])
    expect(within(items[0]).getByText('Unknown')).toBeInTheDocument()
  })

  it('revokes a non-current session via DELETE and refetches the list', async () => {
    const user = userEvent.setup()
    let sessions = [CURRENT, OTHER]
    serve({
      [`GET ${SESSIONS_URL}`]: () => jsonResponse({ status: 200, body: sessions }),
      [`DELETE ${SESSIONS_URL}/10`]: () => {
        sessions = [CURRENT]
        return jsonResponse({ status: 204 })
      },
    })

    renderWithQuery(<SettingsSessionsView user={buildUser()} />)

    // Wait for both rows, then click the enabled end-session button.
    await screen.findByText('Firefox/120')
    const items = screen.getAllByRole('listitem')
    await user.click(within(items[1]).getByRole('button', { name: 'End session' }))

    await waitFor(() => expect(requestsTo('DELETE', `${SESSIONS_URL}/10`)).toHaveLength(1))
    // The list is refetched and now only the current session remains.
    await waitFor(() => {
      expect(screen.queryByText('Firefox/120')).not.toBeInTheDocument()
    })
  })

  it('signs out everywhere else via DELETE /sessions after a confirm step', async () => {
    const user = userEvent.setup()
    serveSessions([CURRENT, OTHER], { [`DELETE ${SESSIONS_URL}`]: { status: 204 } })

    renderWithQuery(<SettingsSessionsView user={buildUser()} />)
    await screen.findByText('Firefox/120')

    // First click: switch to confirm mode. No DELETE yet.
    await user.click(screen.getByRole('button', { name: /Sign out elsewhere/i }))
    expect(requestsTo('DELETE', SESSIONS_URL)).toHaveLength(0)

    // Second click: confirm → DELETE fires.
    await user.click(screen.getByRole('button', { name: /Yes, sign out everywhere else/i }))
    await waitFor(() => expect(requestsTo('DELETE', SESSIONS_URL)).toHaveLength(1))
  })

  it('hides the sign-out-elsewhere button when only the current session is left', async () => {
    serveSessions([CURRENT])

    renderWithQuery(<SettingsSessionsView user={buildUser()} />)
    await screen.findByText('Chrome/130')

    expect(screen.queryByRole('button', { name: /Sign out elsewhere/i })).not.toBeInTheDocument()
  })

  it('shows a translated error toast when the list fails to load', async () => {
    serve({ [`GET ${SESSIONS_URL}`]: { status: 500, body: { detail: 'Internal' } } })

    renderWithQuery(<SettingsSessionsView user={buildUser()} />)

    expect(await screen.findByText('Could not load sessions.')).toBeInTheDocument()
  })
})

describe('SettingsSessionsView loading', () => {
  it('shows skeleton rows while still announcing the loading state', () => {
    serve({}, () => new Promise(() => {}))
    renderWithQuery(<SettingsSessionsView user={buildUser()} />)
    expect(screen.getByText('Loading…')).toHaveClass('sr-only')
    expect(document.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
  })
})

describe('SettingsSessionsPage', () => {
  const Page = Route.options.component!

  it('lists the sessions of the signed-in user', async () => {
    serveSessions([buildSession({ user_agent: 'Chrome/130' })], {
      'GET /api/auth/me': { status: 200, body: buildUser() },
    })

    renderWithQuery(<Page />)

    expect(await screen.findByText('Chrome/130')).toBeInTheDocument()
  })

  it('renders nothing while the signed-in user is unknown', async () => {
    serve({ 'GET /api/auth/me': { status: 401 } })

    const { container } = renderWithQuery(<Page />)

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})
