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

import { CredentialDetailView } from '@/routes/settings.credentials.$credentialId'
import type { AccountRead, CredentialRead } from '@/lib/auth'

function buildAccount(overrides: Partial<AccountRead> = {}): AccountRead {
  return {
    id: 1,
    name: 'DE12 3456 7890 0001',
    display_name: null,
    balance: 1000,
    balance_factor: 100,
    ...overrides,
  }
}

function buildCredential(overrides: Partial<CredentialRead> = {}): CredentialRead {
  return {
    id: 42,
    bank: 'sparkasse',
    accounts: [],
    last_fetching_timestamp: null,
    requires_two_factor_authentication: false,
    ...overrides,
  }
}

interface MockResponse {
  status: number
  body?: unknown
}

function jsonResponse({ status, body }: MockResponse): Response {
  return new Response(body !== undefined ? JSON.stringify(body) : null, {
    status,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
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

describe('CredentialDetailView', () => {
  it('renders a not-found fallback when the credential is missing', () => {
    renderWithQuery(<CredentialDetailView credential={undefined} onDeleted={vi.fn()} />)
    expect(screen.getByText('Connection not found.')).toBeInTheDocument()
  })

  it('shows the bank header with logo, title and last-synced timestamp', () => {
    renderWithQuery(
      <CredentialDetailView
        credential={buildCredential({
          bank: 'ing',
          last_fetching_timestamp: '2026-05-20T10:00:00Z',
        })}
        onDeleted={vi.fn()}
      />,
    )
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('ING')
    // The logo has alt="" + aria-hidden so it isn't queryable by role; check the DOM directly.
    expect(document.querySelector('img[src="/static/banks/ing.png"]')).not.toBeNull()
    expect(screen.getByText(/Last synced:/)).toBeInTheDocument()
  })

  it('says "never synced" when last_fetching_timestamp is null', () => {
    renderWithQuery(<CredentialDetailView credential={buildCredential()} onDeleted={vi.fn()} />)
    expect(screen.getByText('Never synced')).toBeInTheDocument()
  })

  it('renders an empty-accounts hint when there are no accounts', () => {
    renderWithQuery(<CredentialDetailView credential={buildCredential()} onDeleted={vi.fn()} />)
    expect(
      screen.getByText('No accounts yet. They appear after the first successful sync.'),
    ).toBeInTheDocument()
  })

  it('renders one row per account with a balance_factor input pre-filled', () => {
    renderWithQuery(
      <CredentialDetailView
        credential={buildCredential({
          accounts: [
            buildAccount({ id: 1, name: 'Girokonto', balance_factor: 100 }),
            buildAccount({ id: 2, name: 'Sparbuch', balance_factor: 50 }),
          ],
        })}
        onDeleted={vi.fn()}
      />,
    )
    expect(screen.getByText('Girokonto')).toBeInTheDocument()
    expect(screen.getByText('Sparbuch')).toBeInTheDocument()
    const inputs = screen.getAllByLabelText('Balance factor') as HTMLInputElement[]
    expect(inputs.map((input) => input.value)).toEqual(['100', '50'])
  })

  it('keeps the save button disabled until the balance_factor value actually changes', async () => {
    const user = userEvent.setup()
    renderWithQuery(
      <CredentialDetailView
        credential={buildCredential({ accounts: [buildAccount({ id: 1, balance_factor: 100 })] })}
        onDeleted={vi.fn()}
      />,
    )

    const save = screen.getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()

    const input = screen.getByLabelText('Balance factor')
    await user.clear(input)
    await user.type(input, '60')
    expect(save).toBeEnabled()
  })

  it('PATCHes the account when the balance_factor save button is clicked', async () => {
    const user = userEvent.setup()
    const fetchMock = globalThis.fetch as Mock
    fetchMock.mockImplementation((url: string, init?: { method?: string; body?: string }) => {
      if (url === '/api/accounts/1' && init?.method === 'PATCH') {
        return Promise.resolve(
          jsonResponse({
            status: 200,
            body: {
              id: 1,
              name: 'Girokonto',
              display_name: null,
              balance: 1000,
              balance_factor: 60,
            },
          }),
        )
      }
      return Promise.reject(new Error(`unexpected fetch: ${url} ${init?.method}`))
    })

    renderWithQuery(
      <CredentialDetailView
        credential={buildCredential({
          accounts: [buildAccount({ id: 1, name: 'Girokonto', balance_factor: 100 })],
        })}
        onDeleted={vi.fn()}
      />,
    )

    const input = screen.getByLabelText('Balance factor')
    await user.clear(input)
    await user.type(input, '60')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, init]) => url === '/api/accounts/1' && init?.method === 'PATCH',
      )
      expect(call).toBeDefined()
      expect(JSON.parse(call![1].body)).toEqual({ balance_factor: 60 })
    })
  })

  it('flags values out of range as invalid and disables save', async () => {
    const user = userEvent.setup()
    renderWithQuery(
      <CredentialDetailView
        credential={buildCredential({ accounts: [buildAccount({ id: 1, balance_factor: 100 })] })}
        onDeleted={vi.fn()}
      />,
    )

    const input = screen.getByLabelText('Balance factor')
    await user.clear(input)
    await user.type(input, '150')

    expect(screen.getByRole('alert')).toHaveTextContent('The value must between 0 and 100.')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('requires an explicit confirm before calling DELETE', async () => {
    const user = userEvent.setup()
    const fetchMock = globalThis.fetch as Mock
    const onDeleted = vi.fn()
    fetchMock.mockImplementation((url: string, init?: { method?: string }) => {
      if (url === '/api/credentials/42' && init?.method === 'DELETE') {
        return Promise.resolve(jsonResponse({ status: 204 }))
      }
      return Promise.reject(new Error(`unexpected fetch: ${url} ${init?.method}`))
    })

    renderWithQuery(
      <CredentialDetailView credential={buildCredential({ id: 42 })} onDeleted={onDeleted} />,
    )

    await user.click(screen.getByRole('button', { name: 'Delete connection' }))
    // The first click flips to confirm mode; DELETE isn't sent yet.
    expect(fetchMock).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Yes, delete this connection' }))

    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/credentials/42',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('cancels the delete confirmation when the user clicks cancel', async () => {
    const user = userEvent.setup()
    const fetchMock = globalThis.fetch as Mock
    renderWithQuery(
      <CredentialDetailView credential={buildCredential({ id: 42 })} onDeleted={vi.fn()} />,
    )

    await user.click(screen.getByRole('button', { name: 'Delete connection' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByRole('button', { name: 'Delete connection' })).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
