import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

import '@/i18n'
import { LoginForm, LoginPageContent, RegisterForm } from '@/routes/login'
import type { PasswordRequirements } from '@/lib/auth'

function renderWithQuery(ui: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
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

const PASSWORD_REQUIREMENTS: PasswordRequirements = {
  min_length: 15,
  rules: [
    { name: 'lower', regex: '[a-z]', description: 'a lowercase letter' },
    { name: 'upper', regex: '[A-Z]', description: 'an uppercase letter' },
    { name: 'digit', regex: '\\d', description: 'a digit' },
    { name: 'symbol', regex: '[^A-Za-z0-9]', description: 'a special character' },
  ],
}

beforeEach(() => {
  globalThis.fetch = vi.fn() as unknown as typeof fetch
  // Cookie carries CSRF token via api wrapper; not needed for these tests
  // since the api wrapper only reads it for mutations and our fetch mock doesn't care.
  document.cookie = ''
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('LoginForm', () => {
  it('submits credentials to /api/auth/login and invokes onSuccess', async () => {
    const user = userEvent.setup()
    ;(globalThis.fetch as Mock).mockResolvedValueOnce(
      jsonResponse({
        status: 200,
        body: { id: 1, user_name: 'alice', display_name: 'Alice', language: 'en', balance: 0 },
      }),
    )
    const onSuccess = vi.fn()

    renderWithQuery(<LoginForm onSuccess={onSuccess} />)
    await user.type(screen.getByLabelText('Username'), 'alice')
    await user.type(screen.getByLabelText('Password'), 'wonderland-1234!')
    await user.click(screen.getByRole('button', { name: 'Log in' }))

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    const [url, init] = (globalThis.fetch as Mock).mock.calls[0]
    expect(url).toBe('/api/auth/login')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({
      user_name: 'alice',
      password: 'wonderland-1234!',
      remember_me: false,
    })
  })

  it('shows inline error on password when backend returns 401', async () => {
    const user = userEvent.setup()
    ;(globalThis.fetch as Mock).mockResolvedValueOnce(
      jsonResponse({ status: 401, body: { detail: 'Invalid name or password' } }),
    )
    const onSuccess = vi.fn()

    renderWithQuery(<LoginForm onSuccess={onSuccess} />)
    await user.type(screen.getByLabelText('Username'), 'alice')
    await user.type(screen.getByLabelText('Password'), 'wrong-password!')
    await user.click(screen.getByRole('button', { name: 'Log in' }))

    expect(await screen.findByText('Invalid username or password')).toBeInTheDocument()
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('shows the translated required-field message instead of the raw zod default', async () => {
    const user = userEvent.setup()
    ;(globalThis.fetch as Mock).mockResolvedValueOnce(
      jsonResponse({ status: 401, body: { detail: 'Invalid name or password' } }),
    )

    renderWithQuery(<LoginForm onSuccess={vi.fn()} />)
    // Submit once to switch the form into reValidate-onChange mode.
    await user.type(screen.getByLabelText('Username'), 'alice')
    await user.type(screen.getByLabelText('Password'), 'whatever-password-1!')
    await user.click(screen.getByRole('button', { name: 'Log in' }))

    // Now clear the password — should show our i18n message, not zod's default.
    await user.clear(screen.getByLabelText('Password'))

    expect(await screen.findByText('This field is required')).toBeInTheDocument()
    expect(screen.queryByText(/Too small|expected string/i)).not.toBeInTheDocument()
  })

  it('shows top-level rate-limit banner on 429', async () => {
    const user = userEvent.setup()
    ;(globalThis.fetch as Mock).mockResolvedValueOnce(
      jsonResponse({ status: 429, body: { detail: 'Too many requests' } }),
    )

    renderWithQuery(<LoginForm onSuccess={vi.fn()} />)
    await user.type(screen.getByLabelText('Username'), 'alice')
    await user.type(screen.getByLabelText('Password'), 'whatever-password-1!')
    await user.click(screen.getByRole('button', { name: 'Log in' }))

    expect(
      await screen.findByText('Too many attempts. Please wait a moment and try again.'),
    ).toBeInTheDocument()
  })
})

describe('RegisterForm', () => {
  it('blocks submit when passwords do not match', async () => {
    const user = userEvent.setup()
    // Password-requirements query fires on mount; serve it.
    ;(globalThis.fetch as Mock).mockResolvedValueOnce(
      jsonResponse({ status: 200, body: PASSWORD_REQUIREMENTS }),
    )
    const onSuccess = vi.fn()

    renderWithQuery(<RegisterForm onSuccess={onSuccess} />)
    await user.type(screen.getByLabelText('Username'), 'alice')
    await user.type(screen.getByLabelText('Display name'), 'Alice')
    await user.type(screen.getByLabelText('Password'), 'Sup3rSecret!Pass')
    await user.type(screen.getByLabelText('Confirm password'), 'Sup3rSecret!Diff')
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument()
    expect(onSuccess).not.toHaveBeenCalled()
    // Only the GET for password requirements, no POST to /register.
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('shows inline error on username when backend returns 409', async () => {
    const user = userEvent.setup()
    ;(globalThis.fetch as Mock)
      .mockResolvedValueOnce(jsonResponse({ status: 200, body: PASSWORD_REQUIREMENTS }))
      .mockResolvedValueOnce(
        jsonResponse({ status: 409, body: { detail: "User name 'alice' is already taken" } }),
      )
    const onSuccess = vi.fn()

    renderWithQuery(<RegisterForm onSuccess={onSuccess} />)
    await user.type(screen.getByLabelText('Username'), 'alice')
    await user.type(screen.getByLabelText('Display name'), 'Alice')
    await user.type(screen.getByLabelText('Password'), 'Sup3rSecret!Pass')
    await user.type(screen.getByLabelText('Confirm password'), 'Sup3rSecret!Pass')
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByText('This username is already taken')).toBeInTheDocument()
    expect(onSuccess).not.toHaveBeenCalled()
    // No generic top-level banner duplication.
    expect(screen.queryByText('Something went wrong. Please try again.')).not.toBeInTheDocument()
  })

  it('submits a valid registration payload', async () => {
    const user = userEvent.setup()
    ;(globalThis.fetch as Mock)
      .mockResolvedValueOnce(jsonResponse({ status: 200, body: PASSWORD_REQUIREMENTS }))
      .mockResolvedValueOnce(
        jsonResponse({
          status: 201,
          body: { id: 1, user_name: 'alice', display_name: 'Alice', language: 'en', balance: 0 },
        }),
      )
    const onSuccess = vi.fn()

    renderWithQuery(<RegisterForm onSuccess={onSuccess} />)
    await user.type(screen.getByLabelText('Username'), 'alice')
    await user.type(screen.getByLabelText('Display name'), 'Alice')
    await user.type(screen.getByLabelText('Password'), 'Sup3rSecret!Pass')
    await user.type(screen.getByLabelText('Confirm password'), 'Sup3rSecret!Pass')
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    const registerCall = (globalThis.fetch as Mock).mock.calls.find(
      ([url]) => url === '/api/auth/register',
    )
    expect(registerCall).toBeTruthy()
    expect(JSON.parse(registerCall![1].body)).toEqual({
      user_name: 'alice',
      display_name: 'Alice',
      password: 'Sup3rSecret!Pass',
    })
  })
})

describe('LoginPageContent', () => {
  it('renders the disabled-registration message when registration is off', async () => {
    const user = userEvent.setup()
    ;(globalThis.fetch as Mock).mockImplementation((url: string) => {
      if (url === '/api/auth/registration_allowed') {
        return Promise.resolve(jsonResponse({ status: 200, body: { allowed: false } }))
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    })

    renderWithQuery(<LoginPageContent next={undefined} onSuccess={vi.fn()} />)
    await user.click(screen.getByRole('tab', { name: 'Register' }))

    expect(
      await screen.findByText('Registration is currently disabled by the administrator.'),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Display name')).not.toBeInTheDocument()
  })
})
