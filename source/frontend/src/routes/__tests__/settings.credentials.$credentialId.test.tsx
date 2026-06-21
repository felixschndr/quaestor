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
    is_hidden: false,
    ...overrides,
  }
}

function buildCredential(overrides: Partial<CredentialRead> = {}): CredentialRead {
  return {
    id: 42,
    bank: 'fints',
    bank_name: null,
    bank_icon: null,
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

function mutatingFetchCalls(fetchMock: Mock) {
  return fetchMock.mock.calls.filter(([, init]) => init?.method && init.method !== 'GET')
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
          bank: 'trade_republic',
          bank_icon: '/static/banks/trade_republic.png',
          last_fetching_timestamp: '2026-05-20T10:00:00Z',
        })}
        onDeleted={vi.fn()}
      />,
    )
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Trade Republic')
    // The logo has alt="" + aria-hidden so it isn't queryable by role; check the DOM directly.
    expect(document.querySelector('img[src="/static/banks/trade_republic.png"]')).not.toBeNull()
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

  it('auto-saves the balance_factor after the user pauses typing', async () => {
    const user = userEvent.setup()
    const fetchMock = globalThis.fetch as Mock
    fetchMock.mockImplementation((url: string, init?: { method?: string; body?: string }) => {
      if (url === '/api/account/1' && init?.method === 'PATCH') {
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
    await user.type(input, '60.3')

    await waitFor(
      () => {
        const call = fetchMock.mock.calls.find(
          ([url, init]) => url === '/api/account/1' && init?.method === 'PATCH',
        )
        expect(call).toBeDefined()
        expect(JSON.parse(call![1].body)).toEqual({ balance_factor: 60.3 })
      },
      { timeout: 2000 },
    )
  })

  it('flags values out of range as invalid and does not auto-save them', async () => {
    const user = userEvent.setup()
    const fetchMock = globalThis.fetch as Mock
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
    // Give the debounce a chance to fire — invalid input must not produce a PATCH.
    await new Promise((resolve) => setTimeout(resolve, 800))
    expect(mutatingFetchCalls(fetchMock)).toHaveLength(0)
  })

  it('does not show a save button — the form auto-saves silently', () => {
    renderWithQuery(
      <CredentialDetailView
        credential={buildCredential({ accounts: [buildAccount({ id: 1 })] })}
        onDeleted={vi.fn()}
      />,
    )
    // The only buttons should be the danger-zone delete button.
    const buttons = screen.getAllByRole('button').map((b) => b.textContent)
    expect(buttons).not.toContain('Save')
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
    expect(mutatingFetchCalls(fetchMock)).toHaveLength(0)

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
    expect(mutatingFetchCalls(fetchMock)).toHaveLength(0)
  })

  it('pre-fills the personalised name input from the server value', () => {
    renderWithQuery(
      <CredentialDetailView
        credential={buildCredential({
          accounts: [buildAccount({ id: 1, display_name: 'Gehaltskonto' })],
        })}
        onDeleted={vi.fn()}
      />,
    )
    expect(screen.getByLabelText('Personalised name')).toHaveValue('Gehaltskonto')
  })

  it('shows the personalised name as the card title with the IBAN as subtitle', () => {
    renderWithQuery(
      <CredentialDetailView
        credential={buildCredential({
          accounts: [
            buildAccount({
              id: 1,
              name: 'DE12345678900001',
              display_name: 'Gehaltskonto',
            }),
          ],
        })}
        onDeleted={vi.fn()}
      />,
    )
    expect(screen.getByText('Gehaltskonto')).toBeInTheDocument()
    expect(screen.getByText('DE12 3456 7890 0001')).toBeInTheDocument()
  })

  it('auto-PATCHes display_name when only the personalised name changes', async () => {
    const user = userEvent.setup()
    const fetchMock = globalThis.fetch as Mock
    fetchMock.mockImplementation((url: string, init?: { method?: string }) => {
      if (url === '/api/account/1' && init?.method === 'PATCH') {
        return Promise.resolve(jsonResponse({ status: 200, body: { id: 1 } }))
      }
      return Promise.reject(new Error(`unexpected fetch: ${url} ${init?.method}`))
    })

    renderWithQuery(
      <CredentialDetailView
        credential={buildCredential({
          accounts: [buildAccount({ id: 1, display_name: null, balance_factor: 100 })],
        })}
        onDeleted={vi.fn()}
      />,
    )

    await user.type(screen.getByLabelText('Personalised name'), 'Sparkonto')

    await waitFor(
      () => {
        const call = fetchMock.mock.calls.find(
          ([url, init]) => url === '/api/account/1' && init?.method === 'PATCH',
        )
        expect(call).toBeDefined()
        // balance_factor not in the payload — sending it would touch a value the
        // user didn't intend to change.
        expect(JSON.parse(call![1].body)).toEqual({ display_name: 'Sparkonto' })
      },
      { timeout: 2000 },
    )
  })

  it('auto-clears the personalised name by sending null when the user empties the input', async () => {
    const user = userEvent.setup()
    const fetchMock = globalThis.fetch as Mock
    fetchMock.mockImplementation((url: string, init?: { method?: string }) => {
      if (url === '/api/account/1' && init?.method === 'PATCH') {
        return Promise.resolve(jsonResponse({ status: 200, body: { id: 1 } }))
      }
      return Promise.reject(new Error(`unexpected fetch: ${url} ${init?.method}`))
    })

    renderWithQuery(
      <CredentialDetailView
        credential={buildCredential({
          accounts: [buildAccount({ id: 1, display_name: 'Gehaltskonto' })],
        })}
        onDeleted={vi.fn()}
      />,
    )

    await user.clear(screen.getByLabelText('Personalised name'))

    await waitFor(
      () => {
        const call = fetchMock.mock.calls.find(
          ([url, init]) => url === '/api/account/1' && init?.method === 'PATCH',
        )
        expect(call).toBeDefined()
        expect(JSON.parse(call![1].body)).toEqual({ display_name: null })
      },
      { timeout: 2000 },
    )
  })

  it('debounces — a single PATCH covers a burst of edits to both fields', async () => {
    const user = userEvent.setup()
    const fetchMock = globalThis.fetch as Mock
    fetchMock.mockImplementation((url: string, init?: { method?: string }) => {
      if (url === '/api/account/1' && init?.method === 'PATCH') {
        return Promise.resolve(jsonResponse({ status: 200, body: { id: 1 } }))
      }
      return Promise.reject(new Error(`unexpected fetch: ${url} ${init?.method}`))
    })

    renderWithQuery(
      <CredentialDetailView
        credential={buildCredential({
          accounts: [buildAccount({ id: 1, display_name: null, balance_factor: 100 })],
        })}
        onDeleted={vi.fn()}
      />,
    )

    await user.type(screen.getByLabelText('Personalised name'), 'Sparkonto')
    const factorInput = screen.getByLabelText('Balance factor')
    await user.clear(factorInput)
    await user.type(factorInput, '50')

    await waitFor(
      () => {
        const patchCalls = fetchMock.mock.calls.filter(
          ([url, init]) => url === '/api/account/1' && init?.method === 'PATCH',
        )
        // Exactly one PATCH for the whole burst — debounce coalesces edits.
        expect(patchCalls).toHaveLength(1)
        expect(JSON.parse(patchCalls[0]![1].body)).toEqual({
          balance_factor: 50,
          display_name: 'Sparkonto',
        })
      },
      { timeout: 2000 },
    )
  })

  function mockSettings(syncIntervalHours: number) {
    ;(globalThis.fetch as Mock).mockImplementation((url: string) => {
      if (url === '/api/settings') {
        return Promise.resolve(
          jsonResponse({
            status: 200,
            body: {
              allow_new_user_registration: true,
              default_language: 'en',
              display_timezone: 'UTC',
              sync_interval_hours: syncIntervalHours,
            },
          }),
        )
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    })
  }

  it('shows the automatic-sync interval (plural) when 2FA is not required', async () => {
    mockSettings(12)
    renderWithQuery(
      <CredentialDetailView
        credential={buildCredential({
          requires_two_factor_authentication: false,
          accounts: [buildAccount({ id: 1 }), buildAccount({ id: 2 })],
        })}
        onDeleted={vi.fn()}
      />,
    )

    expect(
      await screen.findByText('These accounts are synced automatically on a 12-hour schedule.'),
    ).toBeInTheDocument()
  })

  it('uses the singular wording when the credential has a single account', async () => {
    mockSettings(8)
    renderWithQuery(
      <CredentialDetailView
        credential={buildCredential({
          requires_two_factor_authentication: false,
          accounts: [buildAccount({ id: 1 })],
        })}
        onDeleted={vi.fn()}
      />,
    )

    expect(
      await screen.findByText('This account is synced automatically on a 8-hour schedule.'),
    ).toBeInTheDocument()
  })

  it('states (plural) that a 2FA credential is not synced automatically and why', () => {
    renderWithQuery(
      <CredentialDetailView
        credential={buildCredential({
          requires_two_factor_authentication: true,
          accounts: [buildAccount({ id: 1 }), buildAccount({ id: 2 })],
        })}
        onDeleted={vi.fn()}
      />,
    )

    expect(
      screen.getByText(
        'These accounts are not synced automatically because a second factor is required.',
      ),
    ).toBeInTheDocument()
    // No interval lookup is needed for 2FA credentials.
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('uses the singular wording for a single-account 2FA credential', () => {
    renderWithQuery(
      <CredentialDetailView
        credential={buildCredential({
          requires_two_factor_authentication: true,
          accounts: [buildAccount({ id: 1 })],
        })}
        onDeleted={vi.fn()}
      />,
    )

    expect(
      screen.getByText(
        'This account is not synced automatically because a second factor is required.',
      ),
    ).toBeInTheDocument()
  })

  it('hides the automatic-sync status for manual credentials', () => {
    renderWithQuery(
      <CredentialDetailView credential={buildCredential({ bank: 'manual' })} onDeleted={vi.fn()} />,
    )

    expect(screen.queryByText(/not synced automatically/)).not.toBeInTheDocument()
    expect(screen.queryByText(/-hour schedule/)).not.toBeInTheDocument()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})
