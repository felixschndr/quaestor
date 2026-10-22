import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

import i18n from 'i18next'

import '@/i18n'

vi.mock('@tanstack/react-router', async () => (await import('./-routerMock')).routerMocks())

vi.mock('@/lib/clipboard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/clipboard')>()),
  copyText: vi.fn().mockResolvedValue(undefined),
}))

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

import { SettingsApiKeysView } from '@/pages/settings.user.api-keys'
import { Route } from '@/routes/settings.user.api-keys'
import type { ApiKeyRead } from '@/lib/apiKeys'
import { jsonResponse, renderWithQuery } from './-settingsUserTestHelpers'
import { DATETIME_CREATED_NEWER, DATETIME_RECENT } from '@/test/constants'

function buildKey(overrides: Partial<ApiKeyRead> = {}): ApiKeyRead {
  return {
    id: 1,
    name: 'My script',
    prefix: 'qk_abcdef',
    created_at: DATETIME_RECENT,
    last_used_at: null,
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

function serveFailingWrites(keys: ApiKeyRead[]) {
  ;(globalThis.fetch as Mock).mockImplementation((url: string, init?: { method?: string }) =>
    Promise.resolve(
      url === '/api/api_keys' && (init?.method ?? 'GET') === 'GET'
        ? jsonResponse({ status: 200, body: keys })
        : jsonResponse({ status: 500, body: { detail: 'boom' } }),
    ),
  )
}

function postRequests() {
  return (globalThis.fetch as Mock).mock.calls.filter(
    ([url, init]) => url === '/api/api_keys' && init?.method === 'POST',
  )
}

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
                created_at: DATETIME_CREATED_NEWER,
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
              created_at: DATETIME_CREATED_NEWER,
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

    await user.click(screen.getByRole('button', { name: 'Copy' }))
    await expect(navigator.clipboard.readText()).resolves.toBe('qk_secret-raw-token-value')
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()

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
    await user.click(screen.getByRole('button', { name: 'Really delete?' }))

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

  it('asks for a name before creating a key', async () => {
    const user = userEvent.setup()
    serveFailingWrites([])
    renderWithQuery(<SettingsApiKeysView />)
    await screen.findByText('No API keys yet.')

    await user.click(screen.getByRole('button', { name: 'Create API key' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Please enter a name')
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true')
    expect(postRequests()).toHaveLength(0)
  })

  it('keeps the entered name and reports the error when creating fails', async () => {
    const user = userEvent.setup()
    serveFailingWrites([])
    renderWithQuery(<SettingsApiKeysView />)
    await screen.findByText('No API keys yet.')

    await user.type(screen.getByLabelText('Name'), '  CI key  ')
    await user.click(screen.getByRole('button', { name: 'Create API key' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(GENERIC_ERROR))
    expect(JSON.parse(postRequests()[0][1].body)).toEqual({ name: 'CI key' })
    expect(screen.getByLabelText('Name')).toHaveValue('  CI key  ')
  })

  it('keeps the key listed and reports the error when deleting fails', async () => {
    const user = userEvent.setup()
    serveFailingWrites([buildKey({ id: 7, name: 'Sticky key' })])
    renderWithQuery(<SettingsApiKeysView />)
    await screen.findByText('Sticky key')

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Really delete?' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(GENERIC_ERROR))
    expect(toast.success).not.toHaveBeenCalled()
    expect(screen.getByText('Sticky key')).toBeInTheDocument()
  })
})

describe('/settings/user/api-keys route', () => {
  it('serves the API keys page', () => {
    expect(Route.options.component).toBe(SettingsApiKeysView)
  })
})
