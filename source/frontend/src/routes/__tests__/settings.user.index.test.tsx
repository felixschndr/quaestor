import { render, screen, waitFor } from '@testing-library/react'
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

import { SettingsUserPageContent } from '@/routes/settings.user.index'
import type { PasswordRequirements, UserRead } from '@/lib/auth'

const PASSWORD_REQUIREMENTS: PasswordRequirements = {
  min_length: 15,
  rules: [
    { name: 'lower', regex: '[a-z]', description: 'a lowercase letter' },
    { name: 'upper', regex: '[A-Z]', description: 'an uppercase letter' },
    { name: 'digit', regex: '\\d', description: 'a digit' },
    { name: 'symbol', regex: '[^A-Za-z0-9]', description: 'a special character' },
  ],
}

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
  // Earlier tests in this file flip i18next's language; reset so labels are
  // always the English ones the assertions expect.
  await i18n.changeLanguage('en')
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('SettingsUserPageContent', () => {
  it('renders the section headings and prefills display name + language', async () => {
    ;(globalThis.fetch as Mock).mockImplementation((url: string) => {
      if (url === '/api/i18n/languages') {
        return Promise.resolve(jsonResponse({ status: 200, body: { languages: ['en', 'de'] } }))
      }
      if (url === '/api/auth/password_requirements') {
        return Promise.resolve(jsonResponse({ status: 200, body: PASSWORD_REQUIREMENTS }))
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    })

    renderWithQuery(<SettingsUserPageContent user={buildUser()} onAccountDeleted={vi.fn()} />)

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('User settings')
    // Display name input is prefilled.
    expect(screen.getByLabelText('Display name')).toHaveValue('Alice')
    // Language select prefills to "en" — wait for the languages query to resolve.
    const languageSelect = await screen.findByLabelText('Language')
    expect(languageSelect).toHaveValue('en')
    // English label rendered for "en" once the dictionary is loaded.
    await waitFor(() =>
      expect((languageSelect as HTMLSelectElement).options[0].textContent).toBe('English'),
    )
  })

  it('PATCHes the display name when the user saves', async () => {
    const user = userEvent.setup()
    const fetchMock = globalThis.fetch as Mock
    fetchMock
      // Initial language + password-requirement queries on mount.
      .mockImplementation((url: string) => {
        if (url === '/api/i18n/languages') {
          return Promise.resolve(jsonResponse({ status: 200, body: { languages: ['en'] } }))
        }
        if (url === '/api/auth/password_requirements') {
          return Promise.resolve(jsonResponse({ status: 200, body: PASSWORD_REQUIREMENTS }))
        }
        if (url === '/api/users/1') {
          return Promise.resolve(
            jsonResponse({ status: 200, body: buildUser({ display_name: 'Renamed' }) }),
          )
        }
        return Promise.reject(new Error(`unexpected fetch: ${url}`))
      })

    renderWithQuery(<SettingsUserPageContent user={buildUser()} onAccountDeleted={vi.fn()} />)

    const input = screen.getByLabelText('Display name')
    await user.clear(input)
    await user.type(input, 'Renamed')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([url, init]) => url === '/api/users/1' && init?.method === 'PATCH',
      )
      expect(patch).toBeTruthy()
      expect(JSON.parse(patch![1].body)).toEqual({ display_name: 'Renamed' })
    })
  })

  it('sorts the language dropdown alphabetically by localised label', async () => {
    ;(globalThis.fetch as Mock).mockImplementation((url: string) => {
      if (url === '/api/i18n/languages') {
        // Server returns "en" before "de" — the UI must reorder so the
        // labels read alphabetically ("Deutsch" / "English" or "German" /
        // "English" depending on locale).
        return Promise.resolve(jsonResponse({ status: 200, body: { languages: ['en', 'de'] } }))
      }
      if (url === '/api/auth/password_requirements') {
        return Promise.resolve(jsonResponse({ status: 200, body: PASSWORD_REQUIREMENTS }))
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    })

    renderWithQuery(<SettingsUserPageContent user={buildUser()} onAccountDeleted={vi.fn()} />)

    await screen.findByRole('option', { name: 'German' })
    const select = screen.getByLabelText('Language') as HTMLSelectElement
    const labels = Array.from(select.options).map((option) => option.textContent ?? '')
    expect(labels).toEqual(['English', 'German'])
    // Sanity check: the labels really are sorted.
    expect([...labels].sort((a, b) => a.localeCompare(b))).toEqual(labels)
  })

  it('PATCHes the language when the dropdown changes', async () => {
    const user = userEvent.setup()
    const fetchMock = globalThis.fetch as Mock
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/i18n/languages') {
        return Promise.resolve(jsonResponse({ status: 200, body: { languages: ['en', 'de'] } }))
      }
      if (url === '/api/auth/password_requirements') {
        return Promise.resolve(jsonResponse({ status: 200, body: PASSWORD_REQUIREMENTS }))
      }
      if (url === '/api/users/1') {
        return Promise.resolve(jsonResponse({ status: 200, body: buildUser({ language: 'de' }) }))
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    })

    renderWithQuery(<SettingsUserPageContent user={buildUser()} onAccountDeleted={vi.fn()} />)

    const select = screen.getByLabelText('Language')
    // Wait until the languages query resolves and the "de" option is rendered.
    await screen.findByRole('option', { name: 'German' })
    await user.selectOptions(select, 'de')

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([url, init]) => url === '/api/users/1' && init?.method === 'PATCH',
      )
      expect(patch).toBeTruthy()
      expect(JSON.parse(patch![1].body)).toEqual({ language: 'de' })
    })
  })

  it('marks the current password field on a 401 when changing password', async () => {
    const user = userEvent.setup()
    const fetchMock = globalThis.fetch as Mock
    fetchMock.mockImplementation((url: string, init?: { method?: string }) => {
      if (url === '/api/i18n/languages') {
        return Promise.resolve(jsonResponse({ status: 200, body: { languages: ['en'] } }))
      }
      if (url === '/api/auth/password_requirements') {
        return Promise.resolve(jsonResponse({ status: 200, body: PASSWORD_REQUIREMENTS }))
      }
      if (url === '/api/users/1' && init?.method === 'PATCH') {
        return Promise.resolve(
          jsonResponse({ status: 401, body: { detail: 'Current password is incorrect' } }),
        )
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    })

    renderWithQuery(<SettingsUserPageContent user={buildUser()} onAccountDeleted={vi.fn()} />)

    await user.type(screen.getByLabelText('Current password'), 'old-password-1!')
    await user.type(screen.getByLabelText('New password'), 'NewBrandPa55word!')
    await user.type(screen.getByLabelText('Confirm password'), 'NewBrandPa55word!')
    await user.click(screen.getByRole('button', { name: 'Change password' }))

    expect(await screen.findByText('Current password is incorrect')).toBeInTheDocument()
  })

  it('blocks the password change with a translated message when the new password is too weak', async () => {
    const user = userEvent.setup()
    const fetchMock = globalThis.fetch as Mock
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/i18n/languages') {
        return Promise.resolve(jsonResponse({ status: 200, body: { languages: ['en'] } }))
      }
      if (url === '/api/auth/password_requirements') {
        return Promise.resolve(jsonResponse({ status: 200, body: PASSWORD_REQUIREMENTS }))
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    })

    renderWithQuery(<SettingsUserPageContent user={buildUser()} onAccountDeleted={vi.fn()} />)
    // Wait until the requirements query has resolved so the validator can run.
    await screen.findByText('Password must contain:')

    await user.type(screen.getByLabelText('Current password'), 'whatever-current-1!')
    await user.type(screen.getByLabelText('New password'), 'tooshort')
    await user.type(screen.getByLabelText('Confirm password'), 'tooshort')
    await user.click(screen.getByRole('button', { name: 'Change password' }))

    expect(await screen.findByText('Password does not meet all requirements')).toBeInTheDocument()
    // No PATCH should have been attempted.
    expect(
      fetchMock.mock.calls.find(
        ([url, init]) => url === '/api/users/1' && init?.method === 'PATCH',
      ),
    ).toBeUndefined()
    // Definitely no leaked English Pydantic message either.
    expect(screen.queryByText(/String should have at least/)).not.toBeInTheDocument()
  })

  it('blocks the password change when the confirm field does not match', async () => {
    const user = userEvent.setup()
    ;(globalThis.fetch as Mock).mockImplementation((url: string) => {
      if (url === '/api/i18n/languages') {
        return Promise.resolve(jsonResponse({ status: 200, body: { languages: ['en'] } }))
      }
      if (url === '/api/auth/password_requirements') {
        return Promise.resolve(jsonResponse({ status: 200, body: PASSWORD_REQUIREMENTS }))
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    })

    renderWithQuery(<SettingsUserPageContent user={buildUser()} onAccountDeleted={vi.fn()} />)

    await user.type(screen.getByLabelText('Current password'), 'old-password-1!')
    await user.type(screen.getByLabelText('New password'), 'NewBrandPa55word!')
    await user.type(screen.getByLabelText('Confirm password'), 'DifferentPa55!word!')
    await user.click(screen.getByRole('button', { name: 'Change password' }))

    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument()
  })

  it('only deletes the account after a confirm step, then calls onAccountDeleted', async () => {
    const user = userEvent.setup()
    const fetchMock = globalThis.fetch as Mock
    fetchMock.mockImplementation((url: string, init?: { method?: string }) => {
      if (url === '/api/i18n/languages') {
        return Promise.resolve(jsonResponse({ status: 200, body: { languages: ['en'] } }))
      }
      if (url === '/api/auth/password_requirements') {
        return Promise.resolve(jsonResponse({ status: 200, body: PASSWORD_REQUIREMENTS }))
      }
      if (url === '/api/users/1' && init?.method === 'DELETE') {
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    })
    const onAccountDeleted = vi.fn()

    renderWithQuery(
      <SettingsUserPageContent user={buildUser()} onAccountDeleted={onAccountDeleted} />,
    )

    // First click: switch into confirm mode. No DELETE yet.
    await user.click(screen.getByRole('button', { name: 'Delete account' }))
    expect(
      fetchMock.mock.calls.find(
        ([url, init]) => url === '/api/users/1' && init?.method === 'DELETE',
      ),
    ).toBeUndefined()

    // Second click: confirm → DELETE fires and the callback runs.
    await user.click(screen.getByRole('button', { name: 'Yes, delete my account' }))
    await waitFor(() => expect(onAccountDeleted).toHaveBeenCalledTimes(1))
  })
})
