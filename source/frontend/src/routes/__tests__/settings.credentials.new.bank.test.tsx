import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

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

import { NewCredentialFormView } from '@/routes/settings.credentials.new.$bank'
import type { SupportedBank } from '@/lib/credentials'

const ING_BANK: SupportedBank = {
  name: 'ing',
  required_fields: ['username', 'password'],
  icon: '/static/banks/ing.png',
  bank_identifier: '50010517',
}

const DFS_BANK: SupportedBank = {
  name: 'dfs',
  required_fields: ['username', 'password'],
  icon: '/static/banks/dfs.png',
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

beforeEach(() => {
  globalThis.fetch = vi.fn() as unknown as typeof fetch
  document.cookie = ''
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('NewCredentialFormView', () => {
  it('renders one input per required_field with the localised label', () => {
    renderWithQuery(
      <NewCredentialFormView
        bankName="ing"
        bank={ING_BANK}
        isLoading={false}
        onCancel={vi.fn()}
        onConnected={vi.fn()}
        onSyncFailed={vi.fn()}
      />,
    )

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Connect ING')
    expect(screen.getByLabelText('Username')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password')
    // ING has no "customer" requirement, so that field must not be rendered.
    expect(screen.queryByLabelText('Customer number')).not.toBeInTheDocument()
  })

  it('renders DFS with only username + password', () => {
    renderWithQuery(
      <NewCredentialFormView
        bankName="dfs"
        bank={DFS_BANK}
        isLoading={false}
        onCancel={vi.fn()}
        onConnected={vi.fn()}
        onSyncFailed={vi.fn()}
      />,
    )

    expect(screen.getByLabelText('Username')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password')
    expect(screen.queryByLabelText('Customer number')).not.toBeInTheDocument()
  })

  it('renders the loading state while the supported_banks query is in flight', () => {
    renderWithQuery(
      <NewCredentialFormView
        bankName="ing"
        bank={undefined}
        isLoading={true}
        onCancel={vi.fn()}
        onConnected={vi.fn()}
        onSyncFailed={vi.fn()}
      />,
    )
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('shows an unknown-bank fallback with a back button when the URL points to a non-existent bank', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    renderWithQuery(
      <NewCredentialFormView
        bankName="not-a-real-bank"
        bank={undefined}
        isLoading={false}
        onCancel={onCancel}
        onConnected={vi.fn()}
        onSyncFailed={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('submits the credentials, triggers a sync, and routes to / on success', async () => {
    const user = userEvent.setup()
    const fetchMock = globalThis.fetch as Mock
    fetchMock.mockImplementation((url: string, init?: { method?: string }) => {
      if (url === '/api/credentials' && init?.method === 'POST') {
        return Promise.resolve(
          jsonResponse({
            status: 201,
            body: {
              id: 42,
              bank: 'ing',
              accounts: [],
              last_fetching_timestamp: null,
              requires_two_factor_authentication: false,
            },
          }),
        )
      }
      if (url === '/api/credentials/42/sync' && init?.method === 'POST') {
        return Promise.resolve(
          jsonResponse({
            status: 200,
            body: { status: 'completed', challenge_token: null, expires_at: null },
          }),
        )
      }
      return Promise.reject(new Error(`unexpected fetch: ${url} ${init?.method}`))
    })
    const onConnected = vi.fn()
    const onSyncFailed = vi.fn()

    renderWithQuery(
      <NewCredentialFormView
        bankName="ing"
        bank={ING_BANK}
        isLoading={false}
        onCancel={vi.fn()}
        onConnected={onConnected}
        onSyncFailed={onSyncFailed}
      />,
    )
    await user.type(screen.getByLabelText('Username'), 'alice')
    await user.type(screen.getByLabelText('Password'), 'hunter2')
    await user.click(screen.getByRole('button', { name: 'Connect and sync' }))

    await waitFor(() => expect(onConnected).toHaveBeenCalledTimes(1))
    expect(onSyncFailed).not.toHaveBeenCalled()

    const postBody = JSON.parse(
      fetchMock.mock.calls.find(
        ([url, init]) => url === '/api/credentials' && init?.method === 'POST',
      )![1].body,
    )
    expect(postBody).toEqual({
      bank: 'ing',
      credentials: { username: 'alice', password: 'hunter2' },
    })
  })

  it('keeps the credential and routes to onSyncFailed when the sync call errors', async () => {
    const user = userEvent.setup()
    const fetchMock = globalThis.fetch as Mock
    fetchMock.mockImplementation((url: string, init?: { method?: string }) => {
      if (url === '/api/credentials' && init?.method === 'POST') {
        return Promise.resolve(
          jsonResponse({
            status: 201,
            body: {
              id: 11,
              bank: 'ing',
              accounts: [],
              last_fetching_timestamp: null,
              requires_two_factor_authentication: false,
            },
          }),
        )
      }
      if (url === '/api/credentials/11/sync' && init?.method === 'POST') {
        return Promise.resolve(jsonResponse({ status: 500, body: { detail: 'Internal' } }))
      }
      return Promise.reject(new Error(`unexpected fetch: ${url} ${init?.method}`))
    })
    const onConnected = vi.fn()
    const onSyncFailed = vi.fn()

    renderWithQuery(
      <NewCredentialFormView
        bankName="ing"
        bank={ING_BANK}
        isLoading={false}
        onCancel={vi.fn()}
        onConnected={onConnected}
        onSyncFailed={onSyncFailed}
      />,
    )
    await user.type(screen.getByLabelText('Username'), 'alice')
    await user.type(screen.getByLabelText('Password'), 'hunter2')
    await user.click(screen.getByRole('button', { name: 'Connect and sync' }))

    await waitFor(() => expect(onSyncFailed).toHaveBeenCalledTimes(1))
    expect(onConnected).not.toHaveBeenCalled()
  })

  it('blocks submission with an inline required-field error when a field is empty', async () => {
    const user = userEvent.setup()
    const fetchMock = globalThis.fetch as Mock
    fetchMock.mockResolvedValue(jsonResponse({ status: 500, body: {} }))
    const onConnected = vi.fn()

    renderWithQuery(
      <NewCredentialFormView
        bankName="ing"
        bank={ING_BANK}
        isLoading={false}
        onCancel={vi.fn()}
        onConnected={onConnected}
        onSyncFailed={vi.fn()}
      />,
    )
    // Only fill the username; the password stays empty.
    await user.type(screen.getByLabelText('Username'), 'alice')
    await user.click(screen.getByRole('button', { name: 'Connect and sync' }))

    expect(await screen.findByText('This field is required')).toBeInTheDocument()
    expect(onConnected).not.toHaveBeenCalled()
    // No HTTP call was attempted because zod rejected the form first.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('renders the bank-specific note from i18n when one exists', () => {
    renderWithQuery(
      <NewCredentialFormView
        bankName="trade_republic"
        bank={{
          name: 'trade_republic',
          required_fields: ['phone', 'pin'],
          icon: '/static/banks/trade_republic.png',
        }}
        isLoading={false}
        onCancel={vi.fn()}
        onConnected={vi.fn()}
        onSyncFailed={vi.fn()}
      />,
    )
    expect(
      screen.getByText(/The phone number has to be in the format \+491234567890/),
    ).toBeInTheDocument()
  })

  describe('Trade Republic 2FA flow', () => {
    const TR_BANK: SupportedBank = {
      name: 'trade_republic',
      required_fields: ['phone', 'pin'],
      icon: '/static/banks/trade_republic.png',
    }

    function mockTwoFactorRequired(fetchMock: Mock, credentialId: number, token: string) {
      fetchMock.mockImplementation((url: string, init?: { method?: string; body?: string }) => {
        if (url === '/api/credentials' && init?.method === 'POST') {
          return Promise.resolve(
            jsonResponse({
              status: 201,
              body: {
                id: credentialId,
                bank: 'trade_republic',
                accounts: [],
                last_fetching_timestamp: null,
                requires_two_factor_authentication: false,
              },
            }),
          )
        }
        if (url === `/api/credentials/${credentialId}/sync` && init?.method === 'POST') {
          return Promise.resolve(
            jsonResponse({
              status: 202,
              body: {
                status: '2fa_required',
                challenge_token: token,
                expires_at: '2099-01-01T00:00:00Z',
              },
            }),
          )
        }
        if (url === `/api/credentials/${credentialId}/sync/2fa` && init?.method === 'POST') {
          const body = JSON.parse(init.body ?? '{}')
          if (body.code === 'right') {
            return Promise.resolve(
              jsonResponse({
                status: 200,
                body: { status: 'completed', challenge_token: null, expires_at: null },
              }),
            )
          }
          return Promise.resolve(jsonResponse({ status: 422, body: { detail: 'Invalid 2FA' } }))
        }
        return Promise.reject(new Error(`unexpected fetch: ${url} ${init?.method}`))
      })
    }

    it('hides the code field until the sync returns 2fa_required', async () => {
      const user = userEvent.setup()
      const fetchMock = globalThis.fetch as Mock
      mockTwoFactorRequired(fetchMock, 7, 'tok')

      renderWithQuery(
        <NewCredentialFormView
          bankName="trade_republic"
          bank={TR_BANK}
          isLoading={false}
          onCancel={vi.fn()}
          onConnected={vi.fn()}
          onSyncFailed={vi.fn()}
        />,
      )

      expect(screen.queryByLabelText('Code')).not.toBeInTheDocument()

      await user.type(screen.getByLabelText('Phone number'), '+491234567890')
      await user.type(screen.getByLabelText('PIN'), '1234')
      await user.click(screen.getByRole('button', { name: 'Connect and sync' }))

      expect(await screen.findByLabelText('Code')).toBeInTheDocument()
      expect(screen.queryByLabelText('Phone number')).not.toBeInTheDocument()
    })

    it('confirms the code and routes to onConnected on success', async () => {
      const user = userEvent.setup()
      const fetchMock = globalThis.fetch as Mock
      mockTwoFactorRequired(fetchMock, 7, 'tok')
      const onConnected = vi.fn()
      const onSyncFailed = vi.fn()

      renderWithQuery(
        <NewCredentialFormView
          bankName="trade_republic"
          bank={TR_BANK}
          isLoading={false}
          onCancel={vi.fn()}
          onConnected={onConnected}
          onSyncFailed={onSyncFailed}
        />,
      )

      await user.type(screen.getByLabelText('Phone number'), '+491234567890')
      await user.type(screen.getByLabelText('PIN'), '1234')
      await user.click(screen.getByRole('button', { name: 'Connect and sync' }))

      const codeInput = await screen.findByLabelText('Code')
      await user.type(codeInput, 'right')
      await user.click(screen.getByRole('button', { name: 'Confirm' }))

      await waitFor(() => expect(onConnected).toHaveBeenCalledTimes(1))
      expect(onSyncFailed).not.toHaveBeenCalled()

      const confirmCall = fetchMock.mock.calls.find(
        ([url, init]) => url === '/api/credentials/7/sync/2fa' && init?.method === 'POST',
      )!
      expect(JSON.parse(confirmCall[1].body)).toEqual({ challenge_token: 'tok', code: 'right' })
    })

    it('bounces back to onSyncFailed when the code is rejected', async () => {
      const user = userEvent.setup()
      const fetchMock = globalThis.fetch as Mock
      mockTwoFactorRequired(fetchMock, 7, 'tok')
      const onConnected = vi.fn()
      const onSyncFailed = vi.fn()

      renderWithQuery(
        <NewCredentialFormView
          bankName="trade_republic"
          bank={TR_BANK}
          isLoading={false}
          onCancel={vi.fn()}
          onConnected={onConnected}
          onSyncFailed={onSyncFailed}
        />,
      )

      await user.type(screen.getByLabelText('Phone number'), '+491234567890')
      await user.type(screen.getByLabelText('PIN'), '1234')
      await user.click(screen.getByRole('button', { name: 'Connect and sync' }))

      const codeInput = await screen.findByLabelText('Code')
      await user.type(codeInput, 'wrong')
      await user.click(screen.getByRole('button', { name: 'Confirm' }))

      await waitFor(() => expect(onSyncFailed).toHaveBeenCalledTimes(1))
      expect(onConnected).not.toHaveBeenCalled()
    })
  })
})
