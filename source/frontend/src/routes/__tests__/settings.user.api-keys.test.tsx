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
}))

vi.mock('@/lib/clipboard', () => ({ copyText: vi.fn().mockResolvedValue(undefined) }))

import { SettingsApiKeysView } from '@/pages/settings.user.api-keys'
import type { ApiKeyRead } from '@/lib/apiKeys'

function buildKey(overrides: Partial<ApiKeyRead> = {}): ApiKeyRead {
  return {
    id: 1,
    name: 'My script',
    prefix: 'qk_abcdef',
    created_at: '2026-05-20T10:00:00Z',
    last_used_at: null,
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

describe('SettingsApiKeysView', () => {
  it('renders one row per key with its name and never-used hint', async () => {
    ;(globalThis.fetch as Mock).mockImplementation((url: string) => {
      if (url === '/api/api_keys') {
        return Promise.resolve(
          jsonResponse({
            status: 200,
            body: [
              buildKey({ id: 1, name: 'Older key', created_at: '2026-05-19T10:00:00Z' }),
              buildKey({
                id: 2,
                name: 'Newer key',
                created_at: '2026-05-21T10:00:00Z',
                last_used_at: '2026-05-26T09:00:00Z',
              }),
            ],
          }),
        )
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    })

    renderWithQuery(<SettingsApiKeysView />)

    const items = await screen.findAllByRole('listitem')
    expect(items).toHaveLength(2)
    // Newest key is sorted first.
    expect(within(items[0]).getByText('Newer key')).toBeInTheDocument()
    expect(within(items[1]).getByText('Older key')).toBeInTheDocument()
    expect(within(items[1]).getByText('Never used')).toBeInTheDocument()
  })

  it('shows the empty state when there are no keys', async () => {
    ;(globalThis.fetch as Mock).mockImplementation((url: string) => {
      if (url === '/api/api_keys') {
        return Promise.resolve(jsonResponse({ status: 200, body: [] }))
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    })

    renderWithQuery(<SettingsApiKeysView />)

    expect(await screen.findByText('No API keys yet.')).toBeInTheDocument()
  })

  it('creates a key via POST and reveals the raw token exactly once', async () => {
    const user = userEvent.setup()
    const fetchMock = globalThis.fetch as Mock
    let listCallNumber = 0
    fetchMock.mockImplementation((url: string, init?: { method?: string }) => {
      if (
        url === '/api/api_keys' &&
        (!init || init.method === undefined || init.method === 'GET')
      ) {
        listCallNumber += 1
        const keys = listCallNumber === 1 ? [] : [buildKey({ id: 5, name: 'CI key' })]
        return Promise.resolve(jsonResponse({ status: 200, body: keys }))
      }
      if (url === '/api/api_keys' && init?.method === 'POST') {
        return Promise.resolve(
          jsonResponse({
            status: 201,
            body: {
              id: 5,
              name: 'CI key',
              prefix: 'qk_secret',
              created_at: '2026-05-21T10:00:00Z',
              last_used_at: null,
              token: 'qk_secret-raw-token-value',
            },
          }),
        )
      }
      return Promise.reject(new Error(`unexpected fetch: ${url} ${init?.method}`))
    })

    renderWithQuery(<SettingsApiKeysView />)
    await screen.findByText('No API keys yet.')

    await user.type(screen.getByLabelText('Name'), 'CI key')
    await user.click(screen.getByRole('button', { name: 'Create API key' }))

    // The raw token is shown once after creation.
    expect(await screen.findByText('qk_secret-raw-token-value')).toBeInTheDocument()
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([url, payload]) => url === '/api/api_keys' && payload?.method === 'POST',
      )
      expect(post).toBeTruthy()
    })

    // Dismissing the reveal returns to the create form; the token is gone for good.
    await user.click(screen.getByRole('button', { name: "I've saved my key" }))
    expect(screen.queryByText('qk_secret-raw-token-value')).not.toBeInTheDocument()
  })

  it('deletes a key via DELETE after a confirm step and refetches the list', async () => {
    const user = userEvent.setup()
    const fetchMock = globalThis.fetch as Mock
    let listCallNumber = 0
    fetchMock.mockImplementation((url: string, init?: { method?: string }) => {
      if (
        url === '/api/api_keys' &&
        (!init || init.method === undefined || init.method === 'GET')
      ) {
        listCallNumber += 1
        const keys = listCallNumber === 1 ? [buildKey({ id: 7, name: 'Doomed key' })] : []
        return Promise.resolve(jsonResponse({ status: 200, body: keys }))
      }
      if (url === '/api/api_keys/7' && init?.method === 'DELETE') {
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      return Promise.reject(new Error(`unexpected fetch: ${url} ${init?.method}`))
    })

    renderWithQuery(<SettingsApiKeysView />)
    await screen.findByText('Doomed key')

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => {
      const del = fetchMock.mock.calls.find(
        ([url, payload]) => url === '/api/api_keys/7' && payload?.method === 'DELETE',
      )
      expect(del).toBeTruthy()
    })
    await waitFor(() => {
      expect(screen.queryByText('Doomed key')).not.toBeInTheDocument()
    })
  })
})
