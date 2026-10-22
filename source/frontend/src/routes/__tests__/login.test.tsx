import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

import '@/i18n'

const loginRoute = vi.hoisted(() => ({ push: vi.fn() }))

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await import('./-routerMock')).routerMocks({
    useRouter: () => ({ history: { push: loginRoute.push } }),
  }),
}))

import { QueryClient } from '@tanstack/react-query'
import { LoginForm, LoginPageContent, RegisterForm } from '@/pages/login'
import type { PasswordRequirements } from '@/lib/auth'
import { Route } from '@/routes/login'
import { selectFromPopover } from '@/test/popover-select'
import { routeState } from './-routerMock'
import { buildUser, jsonResponse, renderWithQuery } from './-settingsUserTestHelpers'
import { TEST_TOTP_SECRET } from '@/test/constants'

const PASSWORD_REQUIREMENTS: PasswordRequirements = {
  min_length: 15,
  rules: [
    { name: 'lower', regex: '[a-z]', description: 'a lowercase letter' },
    { name: 'upper', regex: '[A-Z]', description: 'an uppercase letter' },
    { name: 'digit', regex: '\\d', description: 'a digit' },
    { name: 'symbol', regex: '[^A-Za-z0-9]', description: 'a special character' },
  ],
}

function appearanceRoute(url: string): ReturnType<typeof jsonResponse> | null {
  if (url === '/api/i18n/languages') {
    return jsonResponse({ status: 200, body: { languages: ['en', 'de'] } })
  }
  if (url === '/api/i18n/currencies') {
    return jsonResponse({ status: 200, body: { currencies: ['EUR', 'USD'] } })
  }
  return null
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
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument()
    expect(onSuccess).not.toHaveBeenCalled()
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('blocks Continue when the password does not meet the requirements', async () => {
    const user = userEvent.setup()
    ;(globalThis.fetch as Mock).mockResolvedValueOnce(
      jsonResponse({ status: 200, body: PASSWORD_REQUIREMENTS }),
    )
    const onSuccess = vi.fn()

    renderWithQuery(<RegisterForm onSuccess={onSuccess} />)
    await screen.findByText('Password must contain:')
    await user.type(screen.getByLabelText('Username'), 'alice')
    await user.type(screen.getByLabelText('Display name'), 'Alice')
    await user.type(screen.getByLabelText('Password'), 'weak')
    await user.type(screen.getByLabelText('Confirm password'), 'weak')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByText('Password does not meet all requirements')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create account' })).not.toBeInTheDocument()
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('shows inline error on username when backend returns 409', async () => {
    const user = userEvent.setup()
    ;(globalThis.fetch as Mock).mockImplementation((url: string) => {
      if (url === '/api/auth/password_requirements') {
        return Promise.resolve(jsonResponse({ status: 200, body: PASSWORD_REQUIREMENTS }))
      }
      const appearance = appearanceRoute(url)
      if (appearance) return Promise.resolve(appearance)
      if (url === '/api/auth/register') {
        return Promise.resolve(
          jsonResponse({ status: 409, body: { detail: "User name 'alice' is already taken" } }),
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
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(await screen.findByRole('button', { name: 'Create account' }))

    expect(await screen.findByText('This username is already taken')).toBeInTheDocument()
    expect(onSuccess).not.toHaveBeenCalled()
    expect(screen.queryByText('Something went wrong. Please try again.')).not.toBeInTheDocument()
  })

  it('submits a valid registration payload including language and currency', async () => {
    const user = userEvent.setup()
    ;(globalThis.fetch as Mock).mockImplementation((url: string) => {
      if (url === '/api/auth/password_requirements') {
        return Promise.resolve(jsonResponse({ status: 200, body: PASSWORD_REQUIREMENTS }))
      }
      const appearance = appearanceRoute(url)
      if (appearance) return Promise.resolve(appearance)
      if (url === '/api/auth/register') {
        return Promise.resolve(
          jsonResponse({
            status: 201,
            body: { id: 1, user_name: 'alice', display_name: 'Alice', language: 'en', balance: 0 },
          }),
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
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(await screen.findByRole('button', { name: 'Create account' }))

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
      language: 'en',
      currency: 'EUR',
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
      const appearance = appearanceRoute(url)
      if (appearance) return Promise.resolve(appearance)
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
              secret: TEST_TOTP_SECRET,
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
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(await screen.findByRole('button', { name: 'Create account' }))

    expect(await screen.findByText(TEST_TOTP_SECRET)).toBeInTheDocument()
    await user.type(screen.getByLabelText('Authentication code'), '123456')
    await user.click(screen.getByRole('button', { name: 'Verify and enable' }))

    expect(await screen.findByText('AAAAA-BBBBB-CCCCC')).toBeInTheDocument()
    expect(onSuccess).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: "I've saved my backup codes" }))
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
  })

  it('lets the user skip 2FA from the setup screen and continue to the app', async () => {
    const user = userEvent.setup()
    ;(globalThis.fetch as Mock).mockImplementation((url: string) => {
      if (url === '/api/auth/password_requirements') {
        return Promise.resolve(jsonResponse({ status: 200, body: PASSWORD_REQUIREMENTS }))
      }
      const appearance = appearanceRoute(url)
      if (appearance) return Promise.resolve(appearance)
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
              secret: TEST_TOTP_SECRET,
              otpauth_uri: 'otpauth://x',
              qr_code: 'data:image/svg+xml;base64,abc',
            },
          }),
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
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(await screen.findByRole('button', { name: 'Create account' }))

    await user.click(await screen.findByRole('button', { name: 'Continue without two-factor' }))
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(
      (globalThis.fetch as Mock).mock.calls.some(([url]) => url === '/api/users/1/2fa/enable'),
    ).toBe(false)
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

  it.each([
    [true, 'on'],
    [false, 'off'],
  ])('stores the offline choice (kept: %s) only once the login succeeded', async (keep, stored) => {
    const user = userEvent.setup()
    window.localStorage.removeItem('offlineCache')
    ;(globalThis.fetch as Mock).mockImplementation((url: string) =>
      url === '/api/auth/login'
        ? Promise.resolve(
            jsonResponse({
              status: 200,
              body: { id: 1, user_name: 'alice', display_name: 'Alice', language: 'en' },
            }),
          )
        : Promise.reject(new Error(`unexpected fetch: ${url}`)),
    )
    const onSuccess = vi.fn()

    renderWithQuery(<LoginPageContent next={undefined} onSuccess={onSuccess} />)
    const toggle = screen.getByRole('switch', { name: 'Keep data on this device' })
    expect(toggle).toBeChecked()
    if (!keep) await user.click(toggle)
    await user.type(screen.getByLabelText('Username'), 'alice')
    await user.type(screen.getByLabelText('Password'), 'wonderland-1234!')
    expect(window.localStorage.getItem('offlineCache')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Log in' }))

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(window.localStorage.getItem('offlineCache')).toBe(stored)
  })
})

function serve(table: Record<string, () => Response>) {
  ;(globalThis.fetch as Mock).mockImplementation((url: string) => {
    const response = table[url]?.() ?? appearanceRoute(url)
    return response
      ? Promise.resolve(response)
      : Promise.reject(new Error(`unexpected fetch: ${url}`))
  })
}

const challenge = () =>
  jsonResponse({ status: 200, body: { two_factor_required: true, challenge_token: 'tok' } })

async function logIn(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Username'), 'alice')
  await user.type(screen.getByLabelText('Password'), 'wonderland-1234!')
  await user.click(screen.getByRole('button', { name: 'Log in' }))
}

async function fillAccountStep(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Username'), 'alice')
  await user.type(screen.getByLabelText('Display name'), 'Alice')
  await user.type(screen.getByLabelText('Password'), 'Sup3rSecret!Pass')
  await user.type(screen.getByLabelText('Confirm password'), 'Sup3rSecret!Pass')
  await user.click(screen.getByRole('button', { name: 'Continue' }))
}

describe('LoginForm errors', () => {
  it("shows the server's reason when the account is locked", async () => {
    const user = userEvent.setup()
    serve({
      '/api/auth/login': () => jsonResponse({ status: 403, body: { detail: 'Account disabled' } }),
    })

    renderWithQuery(<LoginForm onSuccess={vi.fn()} />)
    await logIn(user)

    expect(await screen.findByRole('alert')).toHaveTextContent('Account disabled')
  })

  it.each([
    ['an unexpected status', { status: 500, body: { detail: 'Internal' } }],
    ['a 403 without a reason', { status: 403, body: { detail: ['locked'] } }],
  ])('falls back to a generic message for %s', async (_, response) => {
    const user = userEvent.setup()
    serve({ '/api/auth/login': () => jsonResponse(response) })

    renderWithQuery(<LoginForm onSuccess={vi.fn()} />)
    await logIn(user)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong. Please try again.',
    )
  })

  it('leaves an unreachable server to the offline banner', async () => {
    const user = userEvent.setup()
    ;(globalThis.fetch as Mock).mockRejectedValue(new TypeError('Failed to fetch'))
    const onSuccess = vi.fn()

    renderWithQuery(<LoginForm onSuccess={onSuccess} />)
    await logIn(user)

    await waitFor(() => expect(screen.getByRole('button', { name: 'Log in' })).toBeEnabled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(onSuccess).not.toHaveBeenCalled()
  })
})

describe('two-factor login step', () => {
  it('remembers the device when asked to, through the code step', async () => {
    const user = userEvent.setup()
    serve({
      '/api/auth/login': challenge,
      '/api/auth/2fa': () => jsonResponse({ status: 200, body: buildUser() }),
    })
    const onSuccess = vi.fn()

    renderWithQuery(<LoginForm onSuccess={onSuccess} />)
    await user.click(screen.getByRole('checkbox', { name: 'Remember me' }))
    await logIn(user)
    await user.type(await screen.findByLabelText('Authentication code'), '123456')

    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce())
    const [login, verify] = (globalThis.fetch as Mock).mock.calls.map(([, init]) =>
      JSON.parse(init.body),
    )
    expect(login.remember_me).toBe(true)
    expect(verify.remember_me).toBe(true)
  })

  it.each([
    [429, 'Too many attempts. Please wait a moment and try again.'],
    [500, 'Something went wrong. Please try again.'],
  ])('explains a %s when verifying the code', async (status, message) => {
    const user = userEvent.setup()
    serve({
      '/api/auth/login': challenge,
      '/api/auth/2fa': () => jsonResponse({ status, body: { detail: 'nope' } }),
    })

    renderWithQuery(<LoginForm onSuccess={vi.fn()} />)
    await logIn(user)
    await user.type(await screen.findByLabelText('Authentication code'), '123456')

    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.getByLabelText('Authentication code')).toHaveAttribute('aria-invalid', 'true')
  })

  it('hides the mode tabs during the code step and brings the login form back on cancel', async () => {
    const user = userEvent.setup()
    serve({ '/api/auth/login': challenge, '/api/settings': () => jsonResponse({ status: 404 }) })

    renderWithQuery(<LoginPageContent next={undefined} onSuccess={vi.fn()} />)
    await logIn(user)
    await screen.findByLabelText('Authentication code')
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: 'Keep data on this device' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByLabelText('Username')).toBeInTheDocument()
    expect(screen.getByRole('tablist')).toBeInTheDocument()
  })
})

describe('RegisterForm details', () => {
  const requirements = () => jsonResponse({ status: 200, body: PASSWORD_REQUIREMENTS })

  it('asks for every account field before continuing', async () => {
    const user = userEvent.setup()
    serve({ '/api/auth/password_requirements': requirements })

    renderWithQuery(<RegisterForm onSuccess={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findAllByText('This field is required')).toHaveLength(4)
    expect(screen.queryByText('Password does not meet all requirements')).toBeNull()
  })

  it('registers with the picked language, currency and theme, keeping the account step on the way back', async () => {
    const user = userEvent.setup()
    serve({
      '/api/auth/password_requirements': requirements,
      '/api/auth/register': () => jsonResponse({ status: 201, body: buildUser() }),
    })
    const onSuccess = vi.fn()

    renderWithQuery(<RegisterForm onSuccess={onSuccess} />)
    await fillAccountStep(user)
    await screen.findByRole('heading', { name: 'Appearance' })
    await waitFor(() => expect(screen.getByLabelText('Language')).toBeEnabled())
    await selectFromPopover(user, 'Language', 'German')
    await waitFor(() => expect(screen.getByLabelText('Currency')).toBeEnabled())
    await selectFromPopover(user, 'Currency', 'US Dollar ($)')
    await selectFromPopover(user, 'Appearance', 'Dark')
    expect(document.documentElement).toHaveClass('dark')

    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByLabelText('Username')).toHaveValue('alice')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(await screen.findByRole('button', { name: 'Create account' }))

    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce())
    const [, init] = (globalThis.fetch as Mock).mock.calls.find(
      ([url]) => url === '/api/auth/register',
    )!
    expect(JSON.parse(init.body)).toMatchObject({ language: 'de', currency: 'USD', theme: 'DARK' })
  })

  it('puts field errors from the server back on the account step', async () => {
    const user = userEvent.setup()
    serve({
      '/api/auth/password_requirements': requirements,
      '/api/auth/register': () =>
        jsonResponse({
          status: 422,
          body: {
            detail: [
              { loc: ['body', 'display_name'], msg: 'Display name is reserved' },
              { loc: ['body', 0], msg: 'Ignored: no field' },
              'Ignored: not an object',
            ],
          },
        }),
    })

    renderWithQuery(<RegisterForm onSuccess={vi.fn()} />)
    await fillAccountStep(user)
    await user.click(await screen.findByRole('button', { name: 'Create account' }))

    expect(await screen.findByText('Display name is reserved')).toBeInTheDocument()
    expect(screen.getByLabelText('Display name')).toHaveValue('Alice')
    expect(screen.queryByText(/Ignored/)).not.toBeInTheDocument()
    expect(screen.queryByText('Something went wrong. Please try again.')).toBeNull()
  })

  it("shows the server's password complaint on the password field", async () => {
    const user = userEvent.setup()
    serve({
      '/api/auth/password_requirements': requirements,
      '/api/auth/register': () =>
        jsonResponse({ status: 422, body: { detail: 'Password appears in a data breach' } }),
    })

    renderWithQuery(<RegisterForm onSuccess={vi.fn()} />)
    await fillAccountStep(user)
    await user.click(await screen.findByRole('button', { name: 'Create account' }))

    expect(await screen.findByText('Password appears in a data breach')).toBeInTheDocument()
  })

  it('keeps the rate-limit banner on both steps', async () => {
    const user = userEvent.setup()
    serve({
      '/api/auth/password_requirements': requirements,
      '/api/auth/register': () => jsonResponse({ status: 429, body: { detail: 'slow down' } }),
    })

    renderWithQuery(<RegisterForm onSuccess={vi.fn()} />)
    await fillAccountStep(user)
    await user.click(await screen.findByRole('button', { name: 'Create account' }))

    const rateLimited = 'Too many attempts. Please wait a moment and try again.'
    expect(await screen.findByRole('alert')).toHaveTextContent(rateLimited)
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByRole('button', { name: 'Create account' })
    expect(screen.getByRole('alert')).toHaveTextContent(rateLimited)
  })
})

describe('LoginPageContent tabs', () => {
  it('switches between logging in and registering', async () => {
    const user = userEvent.setup()
    serve({
      '/api/settings': () =>
        jsonResponse({ status: 200, body: { allow_new_user_registration: true } }),
      '/api/auth/password_requirements': () =>
        jsonResponse({ status: 200, body: PASSWORD_REQUIREMENTS }),
    })

    renderWithQuery(<LoginPageContent next={undefined} onSuccess={vi.fn()} />)
    await user.click(screen.getByRole('tab', { name: 'Register' }))
    expect(screen.getByRole('tab', { name: 'Register' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('Display name')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Log in' }))

    expect(screen.queryByLabelText('Display name')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Log in' })).toBeInTheDocument()
  })
})

describe('login route', () => {
  type LoginRouteOptions = {
    beforeLoad: (args: {
      context: { queryClient: QueryClient }
      search: { next?: string }
    }) => Promise<void>
    validateSearch: (search: object) => { next?: string }
  }
  const options = Route.options as unknown as LoginRouteOptions
  const LoginPage = Route.options.component!

  const beforeLoad = (next?: string) =>
    options.beforeLoad({
      context: { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
      search: { next },
    })

  beforeEach(() => {
    routeState.search = {}
    loginRoute.push.mockClear()
  })

  it('keeps the page to return to from the URL', () => {
    expect(options.validateSearch({ next: '/stats' })).toEqual({ next: '/stats' })
    expect(options.validateSearch({})).toEqual({})
  })

  it('sends someone already signed in straight on to where they wanted to go', async () => {
    serve({ '/api/auth/me': () => jsonResponse({ status: 200, body: buildUser() }) })

    await expect(beforeLoad('/stats')).rejects.toMatchObject({ options: { to: '/stats' } })
  })

  it('shows the login form to a visitor without a session', async () => {
    serve({ '/api/auth/me': () => jsonResponse({ status: 401, body: { detail: 'no session' } }) })

    await expect(beforeLoad('/stats')).resolves.toBeUndefined()
  })

  it.each([
    ['/account/42', '/account/42'],
    ['//evil.example', '/'],
  ])('continues to %s after logging in (→ %s)', async (next, target) => {
    const user = userEvent.setup()
    routeState.search = { next }
    serve({
      '/api/settings': () => jsonResponse({ status: 404 }),
      '/api/auth/login': () => jsonResponse({ status: 200, body: buildUser() }),
    })

    renderWithQuery(<LoginPage />)
    await logIn(user)

    await waitFor(() => expect(loginRoute.push).toHaveBeenCalledExactlyOnceWith(target))
  })
})
