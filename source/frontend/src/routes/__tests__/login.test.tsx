import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

import '@/i18n'
import { LoginForm, LoginPageContent, RegisterForm } from '@/pages/login'
import type { PasswordRequirements } from '@/lib/auth'
import { jsonResponse, renderWithQuery } from './-settingsUserTestHelpers'

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
      theme: 'SYSTEM',
    })
  })
})

describe('two-factor login', () => {
  it('shows the code step on two_factor_required, then completes via /api/auth/2fa', async () => {
    const user = userEvent.setup()
    ;(globalThis.fetch as Mock).mockImplementation((url: string) => {
      if (url === '/api/auth/login') {
        return Promise.resolve(
          jsonResponse({
            status: 200,
            body: { two_factor_required: true, challenge_token: 'tok-123' },
          }),
        )
      }
      if (url === '/api/auth/2fa') {
        return Promise.resolve(
          jsonResponse({
            status: 200,
            body: {
              id: 1,
              user_name: 'alice',
              display_name: 'Alice',
              language: 'en',
              two_factor_enabled: true,
              balance: 0,
            },
          }),
        )
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    })
    const onSuccess = vi.fn()

    renderWithQuery(<LoginForm onSuccess={onSuccess} />)
    await user.type(screen.getByLabelText('Username'), 'alice')
    await user.type(screen.getByLabelText('Password'), 'wonderland-1234!')
    await user.click(screen.getByRole('button', { name: 'Log in' }))

    const codeInput = await screen.findByLabelText('Authentication code')
    expect(onSuccess).not.toHaveBeenCalled()
    await user.type(codeInput, '123456')

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    const verifyCall = (globalThis.fetch as Mock).mock.calls.find(
      ([url]) => url === '/api/auth/2fa',
    )
    expect(JSON.parse(verifyCall![1].body)).toEqual({
      challenge_token: 'tok-123',
      code: '123456',
      remember_me: false,
    })
  })

  it('does not auto-submit a backup code', async () => {
    const user = userEvent.setup()
    ;(globalThis.fetch as Mock).mockImplementation((url: string) => {
      if (url === '/api/auth/login') {
        return Promise.resolve(
          jsonResponse({
            status: 200,
            body: { two_factor_required: true, challenge_token: 'tok' },
          }),
        )
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    })

    renderWithQuery(<LoginForm onSuccess={vi.fn()} />)
    await user.type(screen.getByLabelText('Username'), 'alice')
    await user.type(screen.getByLabelText('Password'), 'wonderland-1234!')
    await user.click(screen.getByRole('button', { name: 'Log in' }))
    await user.type(await screen.findByLabelText('Authentication code'), 'ab12-cd34')

    expect((globalThis.fetch as Mock).mock.calls.some(([url]) => url === '/api/auth/2fa')).toBe(
      false,
    )
  })

  it('shows an inline error when the 2FA code is rejected', async () => {
    const user = userEvent.setup()
    ;(globalThis.fetch as Mock).mockImplementation((url: string) => {
      if (url === '/api/auth/login') {
        return Promise.resolve(
          jsonResponse({
            status: 200,
            body: { two_factor_required: true, challenge_token: 'tok' },
          }),
        )
      }
      if (url === '/api/auth/2fa') {
        return Promise.resolve(
          jsonResponse({ status: 401, body: { detail: 'Invalid two-factor code' } }),
        )
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    })

    renderWithQuery(<LoginForm onSuccess={vi.fn()} />)
    await user.type(screen.getByLabelText('Username'), 'alice')
    await user.type(screen.getByLabelText('Password'), 'wonderland-1234!')
    await user.click(screen.getByRole('button', { name: 'Log in' }))
    await user.type(await screen.findByLabelText('Authentication code'), '000000')
    await user.click(screen.getByRole('button', { name: 'Verify' }))

    expect(
      await screen.findByText('That code is not correct. Please try again.'),
    ).toBeInTheDocument()
  })
})

describe('registration with two-factor', () => {
  it('runs the setup flow and reveals backup codes when the switch is on', async () => {
    const user = userEvent.setup()
    ;(globalThis.fetch as Mock).mockImplementation((url: string) => {
      if (url === '/api/auth/password_requirements') {
        return Promise.resolve(jsonResponse({ status: 200, body: PASSWORD_REQUIREMENTS }))
      }
      if (url === '/api/auth/register') {
        return Promise.resolve(
          jsonResponse({
            status: 201,
            body: {
              id: 1,
              user_name: 'alice',
              display_name: 'Alice',
              language: 'en',
              two_factor_enabled: false,
              balance: 0,
            },
          }),
        )
      }
      if (url === '/api/users/1/2fa/setup') {
        return Promise.resolve(
          jsonResponse({
            status: 200,
            body: {
              secret: 'JBSWY3DPEHPK3PXP',
              otpauth_uri: 'otpauth://x',
              qr_code: 'data:image/svg+xml;base64,abc',
            },
          }),
        )
      }
      if (url === '/api/users/1/2fa/enable') {
        return Promise.resolve(
          jsonResponse({ status: 200, body: { backup_codes: ['AAAAA-BBBBB-CCCCC'] } }),
        )
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    })
    const onSuccess = vi.fn()

    renderWithQuery(<RegisterForm onSuccess={onSuccess} />)
    await user.type(screen.getByLabelText('Username'), 'alice')
    await user.type(screen.getByLabelText('Display name'), 'Alice')
    await user.type(screen.getByLabelText('Password'), 'Sup3rSecret!Pass')
    await user.type(screen.getByLabelText('Confirm password'), 'Sup3rSecret!Pass')
    await user.click(screen.getByRole('switch', { name: 'Enable two-factor authentication' }))
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Authentication code'), '123456')
    await user.click(screen.getByRole('button', { name: 'Verify and enable' }))

    expect(await screen.findByText('AAAAA-BBBBB-CCCCC')).toBeInTheDocument()
    expect(onSuccess).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: "I've saved my backup codes" }))
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
  })
})

describe('LoginPageContent', () => {
  it('renders the disabled-registration message when registration is off', async () => {
    const user = userEvent.setup()
    ;(globalThis.fetch as Mock).mockImplementation((url: string) => {
      if (url === '/api/settings') {
        return Promise.resolve(
          jsonResponse({
            status: 200,
            body: {
              allow_new_user_registration: false,
              default_language: 'en',
              display_timezone: 'UTC',
            },
          }),
        )
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
