import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

import i18n from 'i18next'

import '@/i18n'
import { buildUser, jsonResponse, renderWithQuery } from './-settingsUserTestHelpers'
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

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

const GENERIC_ERROR = 'Something went wrong. Please try again.'

function serveFailingWrites(sessions: SessionRead[]) {
  ;(globalThis.fetch as Mock).mockImplementation((url: string, init?: { method?: string }) =>
    Promise.resolve(
      url === '/api/users/1/sessions' && (init?.method ?? 'GET') === 'GET'
        ? jsonResponse({ status: 200, body: sessions })
        : jsonResponse({ status: 500, body: { detail: 'boom' } }),
    ),
  )
}

describe('SettingsSessionsView', () => {
  it('renders one row per session and marks the current one with a badge', async () => {
    ;(globalThis.fetch as Mock).mockImplementation((url: string) => {
      if (url === '/api/users/1/sessions') {
        return Promise.resolve(
          jsonResponse({
            status: 200,
            body: [
              buildSession({ id: 10, is_current: false, user_agent: 'Firefox/120' }),
              buildSession({ id: 11, is_current: true, user_agent: 'Chrome/130' }),
            ],
          }),
        )
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    })

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
    const fetchMock = globalThis.fetch as Mock
    fetchMock.mockImplementation((url: string, init?: { method?: string }) => {
      if (url === '/api/users/1/sessions') {
        return Promise.resolve(
          jsonResponse({
            status: 200,
            body: [buildSession({ id: 11, is_current: true, user_agent: 'Chrome/130' })],
          }),
        )
      }
      if (url === '/api/auth/logout' && init?.method === 'POST') {
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      return Promise.reject(new Error(`unexpected fetch: ${url} ${init?.method}`))
    })

    renderWithQuery(<SettingsSessionsView user={buildUser()} />)
    await screen.findByText('Chrome/130')

    await user.click(screen.getByRole('button', { name: 'Log out' }))

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([url, payload]) => url === '/api/auth/logout' && payload?.method === 'POST',
      )
      expect(post).toBeTruthy()
    })
    await waitFor(() => expect(historyPush).toHaveBeenCalledWith('/login'))
  })

  it('stays on the page and reports the error when logging out fails', async () => {
    const user = userEvent.setup()
    serveFailingWrites([buildSession({ id: 11, is_current: true, user_agent: 'Chrome/130' })])
    renderWithQuery(<SettingsSessionsView user={buildUser()} />)

    await user.click(await screen.findByRole('button', { name: 'Log out' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(GENERIC_ERROR))
    expect(historyPush).not.toHaveBeenCalled()
  })

  it('keeps a session listed and reports the error when ending it fails', async () => {
    const user = userEvent.setup()
    serveFailingWrites([buildSession({ id: 10, is_current: false, user_agent: 'Firefox/120' })])
    renderWithQuery(<SettingsSessionsView user={buildUser()} />)

    await user.click(await screen.findByRole('button', { name: 'End session' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(GENERIC_ERROR))
    expect(toast.success).not.toHaveBeenCalled()
    expect(screen.getByText('Firefox/120')).toBeInTheDocument()
  })

  it('reports the error when signing out everywhere else fails', async () => {
    const user = userEvent.setup()
    serveFailingWrites([
      buildSession({ id: 11, is_current: true, user_agent: 'Chrome/130' }),
      buildSession({ id: 10, is_current: false, user_agent: 'Firefox/120' }),
    ])
    renderWithQuery(<SettingsSessionsView user={buildUser()} />)

    await user.click(await screen.findByRole('button', { name: /Sign out elsewhere/i }))
    await user.click(screen.getByRole('button', { name: /Yes, sign out everywhere else/i }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(GENERIC_ERROR))
    expect(screen.getByText('Firefox/120')).toBeInTheDocument()
  })

  it('confirms an ended session with a toast', async () => {
    const user = userEvent.setup()
    ;(globalThis.fetch as Mock).mockImplementation((_url: string, init?: { method?: string }) =>
      Promise.resolve(
        init?.method === 'DELETE'
          ? jsonResponse({ status: 204 })
          : jsonResponse({ status: 200, body: [buildSession({ id: 10 })] }),
      ),
    )
    renderWithQuery(<SettingsSessionsView user={buildUser()} />)

    await user.click(await screen.findByRole('button', { name: 'End session' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Session ended'))
  })

  it('only disables the row whose session is being ended', async () => {
    const user = userEvent.setup()
    ;(globalThis.fetch as Mock).mockImplementation((_url: string, init?: { method?: string }) =>
      init?.method === 'DELETE'
        ? new Promise(() => {})
        : Promise.resolve(
            jsonResponse({
              status: 200,
              body: [
                buildSession({ id: 10, user_agent: 'Firefox/120' }),
                buildSession({ id: 12, user_agent: 'Edge/120' }),
              ],
            }),
          ),
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
    ;(globalThis.fetch as Mock).mockResolvedValue(
      jsonResponse({
        status: 200,
        body: [
          buildSession({ id: 1, user_agent: 'Old/1', last_used_at: DATETIME_RECENT }),
          buildSession({ id: 2, user_agent: null, ip: null, last_used_at: DATETIME_UPDATED }),
          buildSession({ id: 3, user_agent: 'Mid/1', last_used_at: DATETIME_CREATED_NEWER }),
        ],
      }),
    )

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
    const fetchMock = globalThis.fetch as Mock
    let listCallNumber = 0
    fetchMock.mockImplementation((url: string, init?: { method?: string }) => {
      if (
        url === '/api/users/1/sessions' &&
        (!init || init.method === undefined || init.method === 'GET')
      ) {
        listCallNumber += 1
        // First call returns two sessions, second (after revoke) returns just the current one.
        const sessions =
          listCallNumber === 1
            ? [
                buildSession({ id: 11, is_current: true, user_agent: 'Chrome/130' }),
                buildSession({ id: 10, is_current: false, user_agent: 'Firefox/120' }),
              ]
            : [buildSession({ id: 11, is_current: true, user_agent: 'Chrome/130' })]
        return Promise.resolve(jsonResponse({ status: 200, body: sessions }))
      }
      if (url === '/api/users/1/sessions/10' && init?.method === 'DELETE') {
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      return Promise.reject(new Error(`unexpected fetch: ${url} ${init?.method}`))
    })

    renderWithQuery(<SettingsSessionsView user={buildUser()} />)

    // Wait for both rows, then click the enabled end-session button.
    await screen.findByText('Firefox/120')
    const items = screen.getAllByRole('listitem')
    await user.click(within(items[1]).getByRole('button', { name: 'End session' }))

    await waitFor(() => {
      const del = fetchMock.mock.calls.find(
        ([url, payload]) => url === '/api/users/1/sessions/10' && payload?.method === 'DELETE',
      )
      expect(del).toBeTruthy()
    })
    // The list is refetched and now only the current session remains.
    await waitFor(() => {
      expect(screen.queryByText('Firefox/120')).not.toBeInTheDocument()
    })
  })

  it('signs out everywhere else via DELETE /sessions after a confirm step', async () => {
    const user = userEvent.setup()
    const fetchMock = globalThis.fetch as Mock
    fetchMock.mockImplementation((url: string, init?: { method?: string }) => {
      if (
        url === '/api/users/1/sessions' &&
        (!init || init.method === undefined || init.method === 'GET')
      ) {
        return Promise.resolve(
          jsonResponse({
            status: 200,
            body: [
              buildSession({ id: 11, is_current: true, user_agent: 'Chrome/130' }),
              buildSession({ id: 10, is_current: false, user_agent: 'Firefox/120' }),
            ],
          }),
        )
      }
      if (url === '/api/users/1/sessions' && init?.method === 'DELETE') {
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      return Promise.reject(new Error(`unexpected fetch: ${url} ${init?.method}`))
    })

    renderWithQuery(<SettingsSessionsView user={buildUser()} />)
    await screen.findByText('Firefox/120')

    // First click: switch to confirm mode. No DELETE yet.
    await user.click(screen.getByRole('button', { name: /Sign out elsewhere/i }))
    expect(
      fetchMock.mock.calls.find(
        ([url, init]) => url === '/api/users/1/sessions' && init?.method === 'DELETE',
      ),
    ).toBeUndefined()

    // Second click: confirm → DELETE fires.
    await user.click(screen.getByRole('button', { name: /Yes, sign out everywhere else/i }))
    await waitFor(() => {
      const del = fetchMock.mock.calls.find(
        ([url, init]) => url === '/api/users/1/sessions' && init?.method === 'DELETE',
      )
      expect(del).toBeTruthy()
    })
  })

  it('hides the sign-out-elsewhere button when only the current session is left', async () => {
    ;(globalThis.fetch as Mock).mockImplementation((url: string) => {
      if (url === '/api/users/1/sessions') {
        return Promise.resolve(
          jsonResponse({
            status: 200,
            body: [buildSession({ id: 11, is_current: true, user_agent: 'Chrome/130' })],
          }),
        )
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    })

    renderWithQuery(<SettingsSessionsView user={buildUser()} />)
    await screen.findByText('Chrome/130')

    expect(screen.queryByRole('button', { name: /Sign out elsewhere/i })).not.toBeInTheDocument()
  })

  it('shows a translated error toast when the list fails to load', async () => {
    ;(globalThis.fetch as Mock).mockResolvedValue(
      jsonResponse({ status: 500, body: { detail: 'Internal' } }),
    )

    renderWithQuery(<SettingsSessionsView user={buildUser()} />)

    expect(await screen.findByText('Could not load sessions.')).toBeInTheDocument()
  })
})

describe('SettingsSessionsView loading', () => {
  it('shows skeleton rows while still announcing the loading state', () => {
    ;(globalThis.fetch as Mock).mockImplementation(() => new Promise(() => {}))
    renderWithQuery(<SettingsSessionsView user={buildUser()} />)
    expect(screen.getByText('Loading…')).toHaveClass('sr-only')
    expect(document.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
  })
})

describe('SettingsSessionsPage', () => {
  const Page = Route.options.component!

  it('lists the sessions of the signed-in user', async () => {
    ;(globalThis.fetch as Mock).mockImplementation((url: string) =>
      Promise.resolve(
        url === '/api/auth/me'
          ? jsonResponse({ status: 200, body: buildUser() })
          : url === '/api/users/1/sessions'
            ? jsonResponse({ status: 200, body: [buildSession({ user_agent: 'Chrome/130' })] })
            : jsonResponse({ status: 404 }),
      ),
    )

    renderWithQuery(<Page />)

    expect(await screen.findByText('Chrome/130')).toBeInTheDocument()
  })

  it('renders nothing while the signed-in user is unknown', async () => {
    ;(globalThis.fetch as Mock).mockResolvedValue(jsonResponse({ status: 401 }))

    const { container } = renderWithQuery(<Page />)

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})
