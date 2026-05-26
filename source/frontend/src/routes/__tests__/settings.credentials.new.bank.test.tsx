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
import type { SupportedBank, SyncJob } from '@/lib/credentials'

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

const TR_BANK: SupportedBank = {
  name: 'trade_republic',
  required_fields: ['phone', 'pin'],
  icon: '/static/banks/trade_republic.png',
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

class MockWebSocket {
  static instances: MockWebSocket[] = []
  url: string
  readyState = 0
  onopen: ((event: unknown) => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: ((event: unknown) => void) | null = null
  onerror: ((event: unknown) => void) | null = null

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
    queueMicrotask(() => {
      this.readyState = 1
      this.onopen?.({})
    })
  }

  send() {}

  close() {
    this.readyState = 3
    this.onclose?.({})
  }

  push(message: SyncJob) {
    this.onmessage?.({ data: JSON.stringify(message) })
  }
}

async function nextWebSocket(predicate: (ws: MockWebSocket) => boolean): Promise<MockWebSocket> {
  return waitFor(() => {
    const ws = MockWebSocket.instances.find(predicate)
    if (!ws) throw new Error('WebSocket not opened yet')
    return ws
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
  MockWebSocket.instances = []
  ;(globalThis as unknown as { WebSocket: typeof MockWebSocket }).WebSocket = MockWebSocket
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

  it('creates the credential, starts the sync, and routes to onConnected when the WS reports completed', async () => {
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
            status: 202,
            body: { job_id: 'job-abc', status: 'running', expires_at: null, error: null },
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

    const ws = await nextWebSocket((s) => s.url.includes('/credentials/42/sync/job-abc/ws'))
    ws.push({ job_id: 'job-abc', status: 'completed', expires_at: null, error: null })

    await waitFor(() => expect(onConnected).toHaveBeenCalledTimes(1))
    expect(onSyncFailed).not.toHaveBeenCalled()
  })

  it('bounces back to onSyncFailed when the WS reports failed', async () => {
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
        return Promise.resolve(
          jsonResponse({
            status: 202,
            body: { job_id: 'job-x', status: 'running', expires_at: null, error: null },
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

    const ws = await nextWebSocket((s) => s.url.includes('/credentials/11/sync/job-x/ws'))
    ws.push({ job_id: 'job-x', status: 'failed', expires_at: null, error: 'bank unreachable' })

    await waitFor(() => expect(onSyncFailed).toHaveBeenCalledTimes(1))
    expect(onConnected).not.toHaveBeenCalled()
  })

  it('bounces back to onSyncFailed when starting the sync itself errors', async () => {
    const user = userEvent.setup()
    const fetchMock = globalThis.fetch as Mock
    fetchMock.mockImplementation((url: string, init?: { method?: string }) => {
      if (url === '/api/credentials' && init?.method === 'POST') {
        return Promise.resolve(
          jsonResponse({
            status: 201,
            body: {
              id: 99,
              bank: 'ing',
              accounts: [],
              last_fetching_timestamp: null,
              requires_two_factor_authentication: false,
            },
          }),
        )
      }
      if (url === '/api/credentials/99/sync' && init?.method === 'POST') {
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
    await user.type(screen.getByLabelText('Username'), 'alice')
    await user.click(screen.getByRole('button', { name: 'Connect and sync' }))

    expect(await screen.findByText('This field is required')).toBeInTheDocument()
    expect(onConnected).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('renders the bank-specific note from i18n when one exists', () => {
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
    expect(
      screen.getByText(/The phone number has to be in the format \+491234567890/),
    ).toBeInTheDocument()
  })

  describe('Trade Republic 2FA flow', () => {
    function mockBackend(fetchMock: Mock, credentialId: number, jobId: string) {
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
              body: { job_id: jobId, status: 'running', expires_at: null, error: null },
            }),
          )
        }
        if (
          url === `/api/credentials/${credentialId}/sync/${jobId}/2fa` &&
          init?.method === 'POST'
        ) {
          return Promise.resolve(
            jsonResponse({
              status: 202,
              body: { job_id: jobId, status: 'running', expires_at: null, error: null },
            }),
          )
        }
        return Promise.reject(new Error(`unexpected fetch: ${url} ${init?.method}`))
      })
    }

    it('hides the code field until the WS reports awaiting_2fa', async () => {
      const user = userEvent.setup()
      const fetchMock = globalThis.fetch as Mock
      mockBackend(fetchMock, 7, 'job-tr')

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

      const ws = await nextWebSocket((s) => s.url.includes('/credentials/7/sync/job-tr/ws'))

      // Still no code field — we only got "running".
      ws.push({ job_id: 'job-tr', status: 'running', expires_at: null, error: null })
      expect(screen.queryByLabelText('Code')).not.toBeInTheDocument()

      ws.push({
        job_id: 'job-tr',
        status: 'awaiting_2fa',
        expires_at: '2099-01-01T00:00:00Z',
        error: null,
      })

      expect(await screen.findByLabelText('Code')).toBeInTheDocument()
      expect(screen.queryByLabelText('Phone number')).not.toBeInTheDocument()
    })

    it('confirms the code and routes to onConnected after the WS pushes completed', async () => {
      const user = userEvent.setup()
      const fetchMock = globalThis.fetch as Mock
      mockBackend(fetchMock, 7, 'job-tr')
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

      const ws = await nextWebSocket((s) => s.url.includes('/credentials/7/sync/job-tr/ws'))
      ws.push({
        job_id: 'job-tr',
        status: 'awaiting_2fa',
        expires_at: '2099-01-01T00:00:00Z',
        error: null,
      })

      const codeInput = await screen.findByLabelText('Code')
      await user.type(codeInput, '4242')
      await user.click(screen.getByRole('button', { name: 'Confirm' }))

      ws.push({ job_id: 'job-tr', status: 'completed', expires_at: null, error: null })

      await waitFor(() => expect(onConnected).toHaveBeenCalledTimes(1))
      expect(onSyncFailed).not.toHaveBeenCalled()

      const confirmCall = fetchMock.mock.calls.find(
        ([url, init]) => url === '/api/credentials/7/sync/job-tr/2fa' && init?.method === 'POST',
      )!
      expect(JSON.parse(confirmCall[1].body)).toEqual({ code: '4242' })
    })

    it('bounces back to onSyncFailed when submitting the code errors', async () => {
      const user = userEvent.setup()
      const fetchMock = globalThis.fetch as Mock
      ;(fetchMock as Mock).mockImplementation((url: string, init?: { method?: string }) => {
        if (url === '/api/credentials' && init?.method === 'POST') {
          return Promise.resolve(
            jsonResponse({
              status: 201,
              body: {
                id: 7,
                bank: 'trade_republic',
                accounts: [],
                last_fetching_timestamp: null,
                requires_two_factor_authentication: false,
              },
            }),
          )
        }
        if (url === '/api/credentials/7/sync' && init?.method === 'POST') {
          return Promise.resolve(
            jsonResponse({
              status: 202,
              body: { job_id: 'job-tr', status: 'running', expires_at: null, error: null },
            }),
          )
        }
        if (url === '/api/credentials/7/sync/job-tr/2fa' && init?.method === 'POST') {
          return Promise.resolve(jsonResponse({ status: 422, body: { detail: 'expired' } }))
        }
        return Promise.reject(new Error(`unexpected fetch: ${url} ${init?.method}`))
      })
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

      const ws = await nextWebSocket((s) => s.url.includes('/credentials/7/sync/job-tr/ws'))
      ws.push({
        job_id: 'job-tr',
        status: 'awaiting_2fa',
        expires_at: '2099-01-01T00:00:00Z',
        error: null,
      })

      const codeInput = await screen.findByLabelText('Code')
      await user.type(codeInput, 'wrong')
      await user.click(screen.getByRole('button', { name: 'Confirm' }))

      await waitFor(() => expect(onSyncFailed).toHaveBeenCalledTimes(1))
      expect(onConnected).not.toHaveBeenCalled()
    })
  })
})
