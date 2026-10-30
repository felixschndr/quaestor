import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
import {
  bodyOf,
  jsonResponse,
  renderWithQuery,
  requestsTo,
  serve,
  type Served,
} from '@/test/helpers'
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

const GENERIC_ERROR = 'Something went wrong. Please try again.'
const KEYS_URL = '/api/api_keys'
const FAILURE = { status: 500, body: { detail: 'boom' } }

function serveKeys(keys: ApiKeyRead[], extra: Served = {}) {
  serve({ [`GET ${KEYS_URL}`]: { status: 200, body: keys }, ...extra })
}

describe('SettingsApiKeysView', () => {
  it('renders one row per key with its name and never-used hint', async () => {
    serveKeys([
      buildKey({ id: 1, name: 'Older key', created_at: '2026-05-19T10:00:00Z' }),
      buildKey({
        id: 2,
        name: 'Newer key',
        created_at: DATETIME_CREATED_NEWER,
        last_used_at: '2026-05-26T09:00:00Z',
      }),
    ])

    renderWithQuery(<SettingsApiKeysView />)

    const items = await screen.findAllByRole('listitem')
    expect(items).toHaveLength(2)
    // Newest key is sorted first.
    expect(within(items[0]).getByText('Newer key')).toBeInTheDocument()
    expect(within(items[1]).getByText('Older key')).toBeInTheDocument()
    expect(within(items[1]).getByText('Never used')).toBeInTheDocument()
  })

  it('shows the empty state when there are no keys', async () => {
    serveKeys([])

    renderWithQuery(<SettingsApiKeysView />)

    expect(await screen.findByText('No API keys yet.')).toBeInTheDocument()
  })

  it('creates a key via POST and reveals the raw token exactly once', async () => {
    const user = userEvent.setup()
    let keys: ApiKeyRead[] = []
    serve({
      [`GET ${KEYS_URL}`]: () => jsonResponse({ status: 200, body: keys }),
      [`POST ${KEYS_URL}`]: () => {
        keys = [buildKey({ id: 5, name: 'CI key' })]
        return jsonResponse({
          status: 201,
          body: {
            id: 5,
            name: 'CI key',
            prefix: 'qk_secret',
            created_at: DATETIME_CREATED_NEWER,
            last_used_at: null,
            token: 'qk_secret-raw-token-value',
          },
        })
      },
    })

    renderWithQuery(<SettingsApiKeysView />)
    await screen.findByText('No API keys yet.')

    await user.type(screen.getByLabelText('Name'), 'CI key')
    await user.click(screen.getByRole('button', { name: 'Create API key' }))

    // The raw token is shown once after creation.
    expect(await screen.findByText('qk_secret-raw-token-value')).toBeInTheDocument()
    await waitFor(() => expect(requestsTo('POST', KEYS_URL)).toHaveLength(1))

    await user.click(screen.getByRole('button', { name: 'Copy' }))
    await expect(navigator.clipboard.readText()).resolves.toBe('qk_secret-raw-token-value')
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()

    // Dismissing the reveal returns to the create form; the token is gone for good.
    await user.click(screen.getByRole('button', { name: "I've saved my key" }))
    expect(screen.queryByText('qk_secret-raw-token-value')).not.toBeInTheDocument()
  })

  it('deletes a key via DELETE after a confirm step and refetches the list', async () => {
    const user = userEvent.setup()
    let keys = [buildKey({ id: 7, name: 'Doomed key' })]
    serve({
      [`GET ${KEYS_URL}`]: () => jsonResponse({ status: 200, body: keys }),
      [`DELETE ${KEYS_URL}/7`]: () => {
        keys = []
        return jsonResponse({ status: 204 })
      },
    })

    renderWithQuery(<SettingsApiKeysView />)
    await screen.findByText('Doomed key')

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Really delete?' }))

    await waitFor(() => expect(requestsTo('DELETE', `${KEYS_URL}/7`)).toHaveLength(1))
    await waitFor(() => {
      expect(screen.queryByText('Doomed key')).not.toBeInTheDocument()
    })
  })

  it('asks for a name before creating a key', async () => {
    const user = userEvent.setup()
    serveKeys([], { [`POST ${KEYS_URL}`]: FAILURE })
    renderWithQuery(<SettingsApiKeysView />)
    await screen.findByText('No API keys yet.')

    await user.click(screen.getByRole('button', { name: 'Create API key' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Please enter a name')
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true')
    expect(requestsTo('POST', KEYS_URL)).toHaveLength(0)
  })

  it('keeps the entered name and reports the error when creating fails', async () => {
    const user = userEvent.setup()
    serveKeys([], { [`POST ${KEYS_URL}`]: FAILURE })
    renderWithQuery(<SettingsApiKeysView />)
    await screen.findByText('No API keys yet.')

    await user.type(screen.getByLabelText('Name'), '  CI key  ')
    await user.click(screen.getByRole('button', { name: 'Create API key' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(GENERIC_ERROR))
    expect(bodyOf('POST', KEYS_URL)).toEqual({ name: 'CI key' })
    expect(screen.getByLabelText('Name')).toHaveValue('  CI key  ')
  })

  it('keeps the key listed and reports the error when deleting fails', async () => {
    const user = userEvent.setup()
    serveKeys([buildKey({ id: 7, name: 'Sticky key' })], { [`DELETE ${KEYS_URL}/7`]: FAILURE })
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
