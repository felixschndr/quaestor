import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

import i18n from 'i18next'

import '@/i18n'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    ...rest
  }: { to: string; children: React.ReactNode } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
  createFileRoute: () => () => ({}),
  useRouter: () => ({ history: { push: vi.fn() } }),
}))

import { SettingsSessionsView } from '@/routes/settings.user.sessions'
import type { SessionRead } from '@/lib/sessions'
import type { UserRead } from '@/lib/auth'

function buildUser(overrides: Partial<UserRead> = {}): UserRead {
  return {
    id: 1,
    user_name: 'alice',
    display_name: 'Alice',
    language: 'en',
    balance: 0,
    credentials: [],
    ...overrides,
  }
}

function buildSession(overrides: Partial<SessionRead> = {}): SessionRead {
  return {
    id: 10,
    created_at: '2026-05-20T10:00:00Z',
    last_used_at: '2026-05-26T09:00:00Z',
    ip: '203.0.113.7',
    user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Safari/605.1.15',
    is_current: false,
    ...overrides,
  }
}

interface MockResponse {
  status: number
  body: unknown
}

function jsonResponse({ status, body }: MockResponse): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function renderWithQuery(ui: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

beforeEach(async () => {
  globalThis.fetch = vi.fn() as unknown as typeof fetch
  document.cookie = ''
  await i18n.changeLanguage('en')
})

afterEach(() => {
  vi.restoreAllMocks()
})

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

  it('signs out everywhere else via DELETE ?exclude_current=true after a confirm step', async () => {
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
      if (url === '/api/users/1/sessions?exclude_current=true' && init?.method === 'DELETE') {
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
        ([url, init]) => url.includes('exclude_current=true') && init?.method === 'DELETE',
      ),
    ).toBeUndefined()

    // Second click: confirm → DELETE fires.
    await user.click(screen.getByRole('button', { name: /Yes, sign out everywhere else/i }))
    await waitFor(() => {
      const del = fetchMock.mock.calls.find(
        ([url, init]) =>
          url === '/api/users/1/sessions?exclude_current=true' && init?.method === 'DELETE',
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
