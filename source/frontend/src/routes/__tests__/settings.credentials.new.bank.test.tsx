import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

import { NewCredentialFormView } from '@/pages/settings.credentials.new.$bank'
import type { SupportedBank, SyncJob } from '@/lib/credentials'
import { jsonResponse, renderWithQuery } from './-settingsUserTestHelpers'

const ING_BANK: SupportedBank = {
  provider: 'ing',
  key: 'ing',
  name: 'ING',
  bic: null,
  icon: '/static/banks/ing-diba.png',
  tested: true,
  required_fields: ['username', 'password'],
  blzs: ['50010517'],
}

const DFS_BANK: SupportedBank = {
  provider: 'dfs',
  key: 'dfs',
  name: 'Deutsche Finance Service',
  bic: null,
  icon: '/static/banks/dfs.png',
  tested: false,
  required_fields: ['username', 'password'],
  blzs: [],
}

const TR_BANK: SupportedBank = {
  provider: 'trade_republic',
  key: 'trade_republic',
  name: 'Trade Republic',
  bic: null,
  icon: '/static/banks/trade_republic.png',
  tested: true,
  required_fields: ['phone', 'pin'],
  blzs: [],
  field_rules: {
    phone: {
      strip_whitespace: true,
      rules: [
        {
          name: 'phone_country_code',
          regex: '^\\+',
          description: 'start with a country code (e.g. +49)',
        },
      ],
    },
    pin: {
      strip_whitespace: false,
      rules: [{ name: 'pin_four_digits', regex: '^\\d{4}$', description: 'be exactly 4 digits' }],
    },
  },
}

// A grouped FinTS bank with a single branch BLZ: only login + PIN, BLZ injected on submit.
const SPARKASSE_BANK: SupportedBank = {
  provider: 'fints',
  key: '66050101',
  name: 'Sparkasse Pforzheim Calw',
  bic: null,
  icon: '/static/banks/sparkasse.png',
  tested: true,
  required_fields: ['username', 'password'],
  blzs: ['66050101'],
}

// A grouped FinTS bank with several branch BLZs: the form asks for an IBAN to disambiguate.
const DEUTSCHE_BANK: SupportedBank = {
  provider: 'fints',
  key: '10070000',
  name: 'Deutsche Bank',
  bic: null,
  icon: null,
  tested: false,
  required_fields: ['username', 'password'],
  blzs: ['10070000', '12070000'],
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
      act(() => {
        this.readyState = 1
        this.onopen?.({})
      })
    })
  }

  send() {}

  close() {
    act(() => {
      this.readyState = 3
      this.onclose?.({})
    })
  }

  push(message: Partial<SyncJob> & Pick<SyncJob, 'job_id' | 'credential_id' | 'status'>) {
    // Mirror the backend payload: expires_at/error/error_code default to null unless set.
    const full: SyncJob = { expires_at: null, error: null, error_code: null, ...message }
    act(() => {
      this.onmessage?.({ data: JSON.stringify(full) })
    })
  }
}

async function nextWebSocket(predicate: (ws: MockWebSocket) => boolean): Promise<MockWebSocket> {
  return waitFor(() => {
    const ws = MockWebSocket.instances.find(predicate)
    if (!ws) throw new Error('WebSocket not opened yet')
    return ws
  })
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
        bankKey="ing"
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
        bankKey="dfs"
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
        bankKey="ing"
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
        bankKey="not-a-real-bank"
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

  it('asks for the country when an Enable Banking institution exists in several countries', () => {
    const ebBank: SupportedBank = {
      provider: 'enable_banking',
      key: 'eb-PayPal',
      name: 'PayPal',
      bic: null,
      icon: null,
      tested: true,
      required_fields: ['private_key'],
      blzs: [],
      countries: ['DE', 'FR'],
    }
    renderWithQuery(
      <NewCredentialFormView
        bankKey="eb-PayPal"
        bank={ebBank}
        isLoading={false}
        onCancel={vi.fn()}
        onConnected={vi.fn()}
        onSyncFailed={vi.fn()}
      />,
    )
    expect(screen.getByLabelText('Country')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Connect and sync' })).toBeDisabled()
  })

  it('does not ask for the country when the institution exists in a single country', () => {
    const ebBank: SupportedBank = {
      provider: 'enable_banking',
      key: 'eb-Nordea',
      name: 'Nordea',
      bic: null,
      icon: null,
      tested: true,
      required_fields: ['private_key'],
      blzs: [],
      countries: ['FI'],
    }
    renderWithQuery(
      <NewCredentialFormView
        bankKey="eb-Nordea"
        bank={ebBank}
        isLoading={false}
        onCancel={vi.fn()}
        onConnected={vi.fn()}
        onSyncFailed={vi.fn()}
      />,
    )
    expect(screen.queryByLabelText('Country')).not.toBeInTheDocument()
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
              sync_enabled: true,
            },
          }),
        )
      }
      if (url === '/api/credentials/42/sync' && init?.method === 'POST') {
        return Promise.resolve(
          jsonResponse({
            status: 202,
            body: {
              job_id: 'job-abc',
              credential_id: 42,
              status: 'running',
              expires_at: null,
              error: null,
            },
          }),
        )
      }
      return Promise.reject(new Error(`unexpected fetch: ${url} ${init?.method}`))
    })
    const onConnected = vi.fn()
    const onSyncFailed = vi.fn()

    renderWithQuery(
      <NewCredentialFormView
        bankKey="ing"
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
    ws.push({
      job_id: 'job-abc',
      credential_id: 42,
      status: 'completed',
      expires_at: null,
      error: null,
    })

    await waitFor(() => expect(onConnected).toHaveBeenCalledTimes(1))
    expect(onSyncFailed).not.toHaveBeenCalled()
  })

  it('deletes the credential when the user abandons the setup while the job is pending', async () => {
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
              sync_enabled: true,
            },
          }),
        )
      }
      if (url === '/api/credentials/42/sync' && init?.method === 'POST') {
        return Promise.resolve(
          jsonResponse({
            status: 202,
            body: {
              job_id: 'job-abc',
              credential_id: 42,
              status: 'running',
              expires_at: null,
              error: null,
            },
          }),
        )
      }
      if (url === '/api/credentials/42' && init?.method === 'DELETE') {
        return Promise.resolve(jsonResponse({ status: 204, body: null }))
      }
      return Promise.reject(new Error(`unexpected fetch: ${url} ${init?.method}`))
    })

    const { unmount } = renderWithQuery(
      <NewCredentialFormView
        bankKey="ing"
        bank={ING_BANK}
        isLoading={false}
        onCancel={vi.fn()}
        onConnected={vi.fn()}
        onSyncFailed={vi.fn()}
      />,
    )
    await user.type(screen.getByLabelText('Username'), 'alice')
    await user.type(screen.getByLabelText('Password'), 'hunter2')
    await user.click(screen.getByRole('button', { name: 'Connect and sync' }))

    const ws = await nextWebSocket((s) => s.url.includes('/credentials/42/sync/job-abc/ws'))
    ws.push({
      job_id: 'job-abc',
      credential_id: 42,
      status: 'awaiting_2fa',
      expires_at: null,
      error: null,
    })
    await screen.findByLabelText('Code')

    unmount()
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) => url === '/api/credentials/42' && init?.method === 'DELETE',
        ),
      ).toBe(true),
    )
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
              sync_enabled: true,
            },
          }),
        )
      }
      if (url === '/api/credentials/11/sync' && init?.method === 'POST') {
        return Promise.resolve(
          jsonResponse({
            status: 202,
            body: {
              job_id: 'job-x',
              credential_id: 11,
              status: 'running',
              expires_at: null,
              error: null,
            },
          }),
        )
      }
      return Promise.reject(new Error(`unexpected fetch: ${url} ${init?.method}`))
    })
    const onConnected = vi.fn()
    const onSyncFailed = vi.fn()

    renderWithQuery(
      <NewCredentialFormView
        bankKey="ing"
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
    ws.push({
      job_id: 'job-x',
      credential_id: 11,
      status: 'failed',
      expires_at: null,
      error: 'bank unreachable',
    })

    await waitFor(() => expect(onSyncFailed).toHaveBeenCalledTimes(1))
    expect(onConnected).not.toHaveBeenCalled()
    // A generic (non-credential) failure is transient — the credential is kept so the user can retry.
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) => url === '/api/credentials/11' && init?.method === 'DELETE',
      ),
    ).toBe(false)
  })

  it('shows a dedicated message when the WS reports failed with invalid_credentials', async () => {
    const user = userEvent.setup()
    const { toast } = await import('sonner')
    const toastError = vi.spyOn(toast, 'error').mockImplementation(() => 'toast-id' as never)
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
              sync_enabled: true,
            },
          }),
        )
      }
      if (url === '/api/credentials/11/sync' && init?.method === 'POST') {
        return Promise.resolve(
          jsonResponse({
            status: 202,
            body: {
              job_id: 'job-x',
              credential_id: 11,
              status: 'running',
              expires_at: null,
              error: null,
            },
          }),
        )
      }
      if (url === '/api/credentials/11' && init?.method === 'DELETE') {
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      return Promise.reject(new Error(`unexpected fetch: ${url} ${init?.method}`))
    })
    const onSyncFailed = vi.fn()

    renderWithQuery(
      <NewCredentialFormView
        bankKey="ing"
        bank={ING_BANK}
        isLoading={false}
        onCancel={vi.fn()}
        onConnected={vi.fn()}
        onSyncFailed={onSyncFailed}
      />,
    )
    await user.type(screen.getByLabelText('Username'), 'alice')
    await user.type(screen.getByLabelText('Password'), 'wrong-pin')
    await user.click(screen.getByRole('button', { name: 'Connect and sync' }))

    const ws = await nextWebSocket((s) => s.url.includes('/credentials/11/sync/job-x/ws'))
    ws.push({
      job_id: 'job-x',
      credential_id: 11,
      status: 'failed',
      error: 'The bank rejected the login',
      error_code: 'invalid_credentials',
    })

    // The just-created credential is useless with wrong creds → it must be deleted.
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) => url === '/api/credentials/11' && init?.method === 'DELETE',
        ),
      ).toBe(true),
    )
    expect(toastError).toHaveBeenCalledTimes(1)
    expect(toastError.mock.calls[0][0]).toMatch(/check your username and password/i)
    // We stay on the form so the user can fix the credentials — no navigation away.
    expect(onSyncFailed).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Connect and sync' })).toBeEnabled()
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
              sync_enabled: true,
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
        bankKey="ing"
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

  it('surfaces a dedicated toast and stays on the form when the backend returns 409', async () => {
    const { toast } = await import('sonner')
    const toastError = vi.spyOn(toast, 'error').mockImplementation(() => 'toast-id' as never)
    const user = userEvent.setup()
    const fetchMock = globalThis.fetch as Mock
    fetchMock.mockImplementation((url: string, init?: { method?: string }) => {
      if (url === '/api/credentials' && init?.method === 'POST') {
        return Promise.resolve(
          jsonResponse({
            status: 409,
            body: { detail: 'User 1 already has an ing credential with the same login data' },
          }),
        )
      }
      return Promise.reject(new Error(`unexpected fetch: ${url} ${init?.method}`))
    })
    const onConnected = vi.fn()
    const onSyncFailed = vi.fn()

    renderWithQuery(
      <NewCredentialFormView
        bankKey="ing"
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

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1))
    expect(toastError.mock.calls[0][0]).toMatch(/already exists/i)
    expect(onConnected).not.toHaveBeenCalled()
    expect(onSyncFailed).not.toHaveBeenCalled()
    // No sync was started — the form is the only POST we made.
    const postCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')
    expect(postCalls).toHaveLength(1)
  })

  it('blocks submission with an inline required-field error when a field is empty', async () => {
    const user = userEvent.setup()
    const fetchMock = globalThis.fetch as Mock
    fetchMock.mockResolvedValue(jsonResponse({ status: 500, body: {} }))
    const onConnected = vi.fn()

    renderWithQuery(
      <NewCredentialFormView
        bankKey="ing"
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

  it('blocks submission with a field error when the Trade Republic phone has no country code', async () => {
    const user = userEvent.setup()
    const fetchMock = globalThis.fetch as Mock
    renderWithQuery(
      <NewCredentialFormView
        bankKey="trade_republic"
        bank={TR_BANK}
        isLoading={false}
        onCancel={vi.fn()}
        onConnected={vi.fn()}
        onSyncFailed={vi.fn()}
      />,
    )
    await user.type(screen.getByLabelText('Phone number'), '491512345')
    await user.type(screen.getByLabelText('PIN'), '1234')
    await user.click(screen.getByRole('button', { name: 'Connect and sync' }))

    // The field-level error (distinct from the bank note that also mentions "country code").
    expect(await screen.findByText(/must start with a country code/i)).toBeInTheDocument()
    // Client-side validation (from the backend rules) blocks the request entirely.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('strips whitespace from the Trade Republic phone before submitting', async () => {
    const user = userEvent.setup()
    const fetchMock = globalThis.fetch as Mock
    let sentCredentials: Record<string, string> | undefined
    fetchMock.mockImplementation((url: string, init?: { method?: string; body?: string }) => {
      if (url === '/api/credentials' && init?.method === 'POST') {
        sentCredentials = (
          JSON.parse(init.body as string) as { credentials: Record<string, string> }
        ).credentials
        return Promise.resolve(
          jsonResponse({
            status: 201,
            body: {
              id: 7,
              bank: 'trade_republic',
              accounts: [],
              last_fetching_timestamp: null,
              requires_two_factor_authentication: false,
              sync_enabled: true,
            },
          }),
        )
      }
      if (url === '/api/credentials/7/sync' && init?.method === 'POST') {
        return Promise.resolve(
          jsonResponse({
            status: 202,
            body: {
              job_id: 'job-1',
              credential_id: 7,
              status: 'running',
              expires_at: null,
              error: null,
            },
          }),
        )
      }
      return Promise.reject(new Error(`unexpected fetch: ${url} ${init?.method}`))
    })

    renderWithQuery(
      <NewCredentialFormView
        bankKey="trade_republic"
        bank={TR_BANK}
        isLoading={false}
        onCancel={vi.fn()}
        onConnected={vi.fn()}
        onSyncFailed={vi.fn()}
      />,
    )
    await user.type(screen.getByLabelText('Phone number'), '+49 151 23')
    await user.type(screen.getByLabelText('PIN'), '1234')
    await user.click(screen.getByRole('button', { name: 'Connect and sync' }))

    await waitFor(() => expect(sentCredentials).toBeDefined())
    // The phone is de-spaced; the PIN (not a stripped field) is sent verbatim.
    expect(sentCredentials).toEqual({ phone: '+4915123', pin: '1234' })
  })

  it('renders the bank-specific note from i18n when one exists', () => {
    renderWithQuery(
      <NewCredentialFormView
        bankKey="dfs"
        bank={DFS_BANK}
        isLoading={false}
        onCancel={vi.fn()}
        onConnected={vi.fn()}
        onSyncFailed={vi.fn()}
      />,
    )
    expect(
      screen.getByText(/Retirement provisioning of the Deutsche Flugsicherung GmbH\./),
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
                sync_enabled: true,
              },
            }),
          )
        }
        if (url === `/api/credentials/${credentialId}/sync` && init?.method === 'POST') {
          return Promise.resolve(
            jsonResponse({
              status: 202,
              body: {
                job_id: jobId,
                credential_id: credentialId,
                status: 'running',
                expires_at: null,
                error: null,
              },
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
              body: {
                job_id: jobId,
                credential_id: credentialId,
                status: 'running',
                expires_at: null,
                error: null,
              },
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
          bankKey="trade_republic"
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
      ws.push({
        job_id: 'job-tr',
        credential_id: 7,
        status: 'running',
        expires_at: null,
        error: null,
      })
      expect(screen.queryByLabelText('Code')).not.toBeInTheDocument()

      ws.push({
        job_id: 'job-tr',
        credential_id: 7,
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
          bankKey="trade_republic"
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
        credential_id: 7,
        status: 'awaiting_2fa',
        expires_at: '2099-01-01T00:00:00Z',
        error: null,
      })

      const codeInput = await screen.findByLabelText('Code')
      await user.type(codeInput, '4242')
      await user.click(screen.getByRole('button', { name: 'Confirm' }))

      ws.push({
        job_id: 'job-tr',
        credential_id: 7,
        status: 'completed',
        expires_at: null,
        error: null,
      })

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
                sync_enabled: true,
              },
            }),
          )
        }
        if (url === '/api/credentials/7/sync' && init?.method === 'POST') {
          return Promise.resolve(
            jsonResponse({
              status: 202,
              body: {
                job_id: 'job-tr',
                credential_id: 7,
                status: 'running',
                expires_at: null,
                error: null,
              },
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
          bankKey="trade_republic"
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
        credential_id: 7,
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

  describe('Sparkasse decoupled approval flow', () => {
    function mockBackend(fetchMock: Mock, credentialId: number, jobId: string) {
      fetchMock.mockImplementation((url: string, init?: { method?: string }) => {
        if (url === '/api/credentials' && init?.method === 'POST') {
          return Promise.resolve(
            jsonResponse({
              status: 201,
              body: {
                id: credentialId,
                bank: 'sparkasse',
                accounts: [],
                last_fetching_timestamp: null,
                requires_two_factor_authentication: false,
                sync_enabled: true,
              },
            }),
          )
        }
        if (url === `/api/credentials/${credentialId}/sync` && init?.method === 'POST') {
          return Promise.resolve(
            jsonResponse({
              status: 202,
              body: {
                job_id: jobId,
                credential_id: credentialId,
                status: 'running',
                expires_at: null,
                error: null,
              },
            }),
          )
        }
        return Promise.reject(new Error(`unexpected fetch: ${url} ${init?.method}`))
      })
    }

    it('shows the approval message when the sync reports awaiting_decoupled_approval', async () => {
      const user = userEvent.setup()
      const fetchMock = globalThis.fetch as Mock
      mockBackend(fetchMock, 13, 'job-spk')

      renderWithQuery(
        <NewCredentialFormView
          bankKey="66050101"
          bank={SPARKASSE_BANK}
          isLoading={false}
          onCancel={vi.fn()}
          onConnected={vi.fn()}
          onSyncFailed={vi.fn()}
        />,
      )

      await user.type(screen.getByLabelText('Username'), 'felix')
      await user.type(screen.getByLabelText('Password'), 'secret-password')
      await user.click(screen.getByRole('button', { name: 'Connect and sync' }))

      const ws = await nextWebSocket((s) => s.url.includes('/credentials/13/sync/job-spk/ws'))
      ws.push({
        job_id: 'job-spk',
        credential_id: 13,
        status: 'awaiting_decoupled_approval',
        expires_at: null,
        error: null,
      })

      expect(await screen.findByText(/Please approve in your banking app/)).toBeInTheDocument()
      // The form is replaced by the waiting panel.
      expect(screen.queryByLabelText('Username')).not.toBeInTheDocument()
    })

    it('completes the sync after the approval transitions to running and then completed', async () => {
      const user = userEvent.setup()
      const fetchMock = globalThis.fetch as Mock
      mockBackend(fetchMock, 13, 'job-spk')
      const onConnected = vi.fn()
      const onSyncFailed = vi.fn()

      renderWithQuery(
        <NewCredentialFormView
          bankKey="66050101"
          bank={SPARKASSE_BANK}
          isLoading={false}
          onCancel={vi.fn()}
          onConnected={onConnected}
          onSyncFailed={onSyncFailed}
        />,
      )

      await user.type(screen.getByLabelText('Username'), 'felix')
      await user.type(screen.getByLabelText('Password'), 'secret-password')
      await user.click(screen.getByRole('button', { name: 'Connect and sync' }))

      const ws = await nextWebSocket((s) => s.url.includes('/credentials/13/sync/job-spk/ws'))
      ws.push({
        job_id: 'job-spk',
        credential_id: 13,
        status: 'awaiting_decoupled_approval',
        expires_at: null,
        error: null,
      })
      expect(await screen.findByText(/Please approve in your banking app/)).toBeInTheDocument()

      ws.push({
        job_id: 'job-spk',
        credential_id: 13,
        status: 'running',
        expires_at: null,
        error: null,
      })
      ws.push({
        job_id: 'job-spk',
        credential_id: 13,
        status: 'completed',
        expires_at: null,
        error: null,
      })

      await waitFor(() => expect(onConnected).toHaveBeenCalledTimes(1))
      expect(onSyncFailed).not.toHaveBeenCalled()
    })
  })

  describe('grouped FinTS banks', () => {
    function captureCreate(fetchMock: Mock, credentialId: number) {
      let sentBody: { bank: string; credentials: Record<string, string> } | undefined
      fetchMock.mockImplementation((url: string, init?: { method?: string; body?: string }) => {
        if (url === '/api/credentials' && init?.method === 'POST') {
          sentBody = JSON.parse(init.body as string)
          return Promise.resolve(
            jsonResponse({
              status: 201,
              body: {
                id: credentialId,
                bank: 'fints',
                accounts: [],
                last_fetching_timestamp: null,
                requires_two_factor_authentication: false,
                sync_enabled: true,
              },
            }),
          )
        }
        if (url === `/api/credentials/${credentialId}/sync` && init?.method === 'POST') {
          return Promise.resolve(
            jsonResponse({
              status: 202,
              body: {
                job_id: 'job-f',
                credential_id: credentialId,
                status: 'running',
                expires_at: null,
                error: null,
              },
            }),
          )
        }
        return Promise.reject(new Error(`unexpected fetch: ${url} ${init?.method}`))
      })
      return () => sentBody
    }

    it('submits a single-blz fints bank with the prefilled blz and no iban field', async () => {
      const user = userEvent.setup()
      const fetchMock = globalThis.fetch as Mock
      const sentBody = captureCreate(fetchMock, 21)

      renderWithQuery(
        <NewCredentialFormView
          bankKey="66050101"
          bank={SPARKASSE_BANK}
          isLoading={false}
          onCancel={vi.fn()}
          onConnected={vi.fn()}
          onSyncFailed={vi.fn()}
        />,
      )

      // A single-BLZ FinTS bank only asks for login + PIN; the BLZ is injected.
      expect(screen.queryByLabelText('IBAN')).not.toBeInTheDocument()
      await user.type(screen.getByLabelText('Username'), 'alice')
      await user.type(screen.getByLabelText('Password'), 'hunter2')
      await user.click(screen.getByRole('button', { name: 'Connect and sync' }))

      await waitFor(() => expect(sentBody()).toBeDefined())
      expect(sentBody()).toEqual({
        bank: 'fints',
        credentials: { username: 'alice', password: 'hunter2', blz: '66050101' },
      })
    })

    it('asks for an IBAN on a multi-blz bank and derives the matching blz', async () => {
      const user = userEvent.setup()
      const fetchMock = globalThis.fetch as Mock
      const sentBody = captureCreate(fetchMock, 22)

      renderWithQuery(
        <NewCredentialFormView
          bankKey="10070000"
          bank={DEUTSCHE_BANK}
          isLoading={false}
          onCancel={vi.fn()}
          onConnected={vi.fn()}
          onSyncFailed={vi.fn()}
        />,
      )

      await user.type(screen.getByLabelText('Username'), 'bob')
      await user.type(screen.getByLabelText('Password'), 'hunter2')
      // IBAN whose BLZ (chars 5-12) is 12070000 — a branch BLZ of this bank.
      await user.type(screen.getByLabelText('IBAN'), 'DE89120700000532013000')
      await user.click(screen.getByRole('button', { name: 'Connect and sync' }))

      await waitFor(() => expect(sentBody()).toBeDefined())
      expect(sentBody()).toEqual({
        bank: 'fints',
        credentials: { username: 'bob', password: 'hunter2', blz: '12070000' },
      })
      // The IBAN itself is never sent to the backend.
      expect(sentBody()!.credentials).not.toHaveProperty('iban')
    })

    it('rejects an IBAN whose blz does not belong to the bank and sends nothing', async () => {
      const user = userEvent.setup()
      const fetchMock = globalThis.fetch as Mock

      renderWithQuery(
        <NewCredentialFormView
          bankKey="10070000"
          bank={DEUTSCHE_BANK}
          isLoading={false}
          onCancel={vi.fn()}
          onConnected={vi.fn()}
          onSyncFailed={vi.fn()}
        />,
      )

      await user.type(screen.getByLabelText('Username'), 'bob')
      await user.type(screen.getByLabelText('Password'), 'hunter2')
      // BLZ 50010517 is not one of this bank's branch BLZs.
      await user.type(screen.getByLabelText('IBAN'), 'DE89500105170532013000')
      await user.click(screen.getByRole('button', { name: 'Connect and sync' }))

      expect(
        await screen.findByText(/This IBAN does not belong to the selected bank/i),
      ).toBeInTheDocument()
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })
})
