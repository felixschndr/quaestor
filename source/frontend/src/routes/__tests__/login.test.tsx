import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
import { Route } from '@/routes/login'
import { selectFromPopover } from '@/test/popover-select'
import { routeState } from './-routerMock'
import {
  PASSWORD_REQUIREMENTS,
  bodyOf,
  buildUser,
  renderWithQuery,
  requestsTo,
  serve,
  type Served,
} from '@/test/helpers'
import { TEST_TOTP_SECRET } from '@/test/constants'

const REGISTER_ROUTES: Served = {
  'GET /api/auth/password_requirements': { status: 200, body: PASSWORD_REQUIREMENTS },
  'GET /api/i18n/languages': { status: 200, body: { languages: ['en', 'de'] } },
  'GET /api/i18n/currencies': { status: 200, body: { currencies: ['EUR', 'USD'] } },
}

const CHALLENGE = { status: 200, body: { two_factor_required: true, challenge_token: 'tok' } }

async function logIn(user: ReturnType<typeof userEvent.setup>, password = 'wonderland-1234!') {
  await user.type(screen.getByLabelText('Username'), 'alice')
  await user.type(screen.getByLabelText('Password'), password)
  await user.click(screen.getByRole('button', { name: 'Log in' }))
}

async function fillAccountStep(
  user: ReturnType<typeof userEvent.setup>,
  password = 'Sup3rSecret!Pass',
  confirmation = password,
) {
  await user.type(screen.getByLabelText('Username'), 'alice')
  await user.type(screen.getByLabelText('Display name'), 'Alice')
  await user.type(screen.getByLabelText('Password'), password)
  await user.type(screen.getByLabelText('Confirm password'), confirmation)
  await user.click(screen.getByRole('button', { name: 'Continue' }))
}

async function createAccount(user: ReturnType<typeof userEvent.setup>) {
  await fillAccountStep(user)
  await user.click(await screen.findByRole('button', { name: 'Create account' }))
}

beforeEach(() => {
  globalThis.fetch = vi.fn() as unknown as typeof fetch
  // Cookie carries CSRF token via api wrapper; not needed for these tests
  // since the api wrapper only reads it for mutations and our fetch mock doesn't care.
  document.cookie = ''
})

describe('LoginForm', () => {
  it('submits credentials to /api/auth/login and invokes onSuccess', async () => {
    const user = userEvent.setup()
    serve({ 'POST /api/auth/login': { status: 200, body: buildUser() } })
    const onSuccess = vi.fn()

    renderWithQuery(<LoginForm onSuccess={onSuccess} />)
    await logIn(user)

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    expect(bodyOf('POST', '/api/auth/login')).toEqual({
      user_name: 'alice',
      password: 'wonderland-1234!',
      remember_me: false,
    })
  })

  it('shows inline error on password when backend returns 401', async () => {
    const user = userEvent.setup()
    serve({
      'POST /api/auth/login': { status: 401, body: { detail: 'Invalid name or password' } },
    })
    const onSuccess = vi.fn()

    renderWithQuery(<LoginForm onSuccess={onSuccess} />)
    await logIn(user, 'wrong-password!')

    expect(await screen.findByText('Invalid username or password')).toBeInTheDocument()
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('shows the translated required-field message instead of the raw zod default', async () => {
    const user = userEvent.setup()
    serve({
      'POST /api/auth/login': { status: 401, body: { detail: 'Invalid name or password' } },
    })

    renderWithQuery(<LoginForm onSuccess={vi.fn()} />)
    // Submit once to switch the form into reValidate-onChange mode.
    await logIn(user)

    // Now clear the password — should show our i18n message, not zod's default.
    await user.clear(screen.getByLabelText('Password'))

    expect(await screen.findByText('This field is required')).toBeInTheDocument()
    expect(screen.queryByText(/Too small|expected string/i)).not.toBeInTheDocument()
  })

  it('shows top-level rate-limit banner on 429', async () => {
    const user = userEvent.setup()
    serve({ 'POST /api/auth/login': { status: 429, body: { detail: 'Too many requests' } } })

    renderWithQuery(<LoginForm onSuccess={vi.fn()} />)
    await logIn(user)

    expect(
      await screen.findByText('Too many attempts. Please wait a moment and try again.'),
    ).toBeInTheDocument()
  })
})

describe('RegisterForm', () => {
  it('blocks submit when passwords do not match', async () => {
    const user = userEvent.setup()
    serve(REGISTER_ROUTES)
    const onSuccess = vi.fn()

    renderWithQuery(<RegisterForm onSuccess={onSuccess} />)
    await fillAccountStep(user, 'Sup3rSecret!Pass', 'Sup3rSecret!Diff')

    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument()
    expect(onSuccess).not.toHaveBeenCalled()
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('blocks Continue when the password does not meet the requirements', async () => {
    const user = userEvent.setup()
    serve(REGISTER_ROUTES)
    const onSuccess = vi.fn()

    renderWithQuery(<RegisterForm onSuccess={onSuccess} />)
    await screen.findByText('Password must contain:')
    await fillAccountStep(user, 'weak')

    expect(await screen.findByText('Password does not meet all requirements')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create account' })).not.toBeInTheDocument()
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('shows inline error on username when backend returns 409', async () => {
    const user = userEvent.setup()
    serve({
      ...REGISTER_ROUTES,
      'POST /api/auth/register': {
        status: 409,
        body: { detail: "User name 'alice' is already taken" },
      },
    })
    const onSuccess = vi.fn()

    renderWithQuery(<RegisterForm onSuccess={onSuccess} />)
    await createAccount(user)

    expect(await screen.findByText('This username is already taken')).toBeInTheDocument()
    expect(onSuccess).not.toHaveBeenCalled()
    expect(screen.queryByText('Something went wrong. Please try again.')).not.toBeInTheDocument()
  })

  it('submits a valid registration payload including language and currency', async () => {
    const user = userEvent.setup()
    serve({ ...REGISTER_ROUTES, 'POST /api/auth/register': { status: 201, body: buildUser() } })
    const onSuccess = vi.fn()

    renderWithQuery(<RegisterForm onSuccess={onSuccess} />)
    await createAccount(user)

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(bodyOf('POST', '/api/auth/register')).toEqual({
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
    serve({
      'POST /api/auth/login': CHALLENGE,
      'POST /api/auth/2fa': { status: 200, body: buildUser({ two_factor_enabled: true }) },
    })
    const onSuccess = vi.fn()

    renderWithQuery(<LoginForm onSuccess={onSuccess} />)
    await logIn(user)

    const codeInput = await screen.findByLabelText('Authentication code')
    expect(onSuccess).not.toHaveBeenCalled()
    await user.type(codeInput, '123456')

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(bodyOf('POST', '/api/auth/2fa')).toEqual({
      challenge_token: 'tok',
      code: '123456',
      remember_me: false,
    })
  })

  it('does not auto-submit a backup code', async () => {
    const user = userEvent.setup()
    serve({ 'POST /api/auth/login': CHALLENGE })

    renderWithQuery(<LoginForm onSuccess={vi.fn()} />)
    await logIn(user)
    await user.type(await screen.findByLabelText('Authentication code'), 'ab12-cd34')

    expect(requestsTo('POST', '/api/auth/2fa')).toHaveLength(0)
  })

  it('shows an inline error when the 2FA code is rejected', async () => {
    const user = userEvent.setup()
    serve({
      'POST /api/auth/login': CHALLENGE,
      'POST /api/auth/2fa': { status: 401, body: { detail: 'Invalid two-factor code' } },
    })

    renderWithQuery(<LoginForm onSuccess={vi.fn()} />)
    await logIn(user)
    await user.type(await screen.findByLabelText('Authentication code'), '000000')
    await user.click(screen.getByRole('button', { name: 'Verify' }))

    expect(
      await screen.findByText('That code is not correct. Please try again.'),
    ).toBeInTheDocument()
  })
})

describe('registration with two-factor', () => {
  const routes: Served = {
    ...REGISTER_ROUTES,
    'POST /api/auth/register': { status: 201, body: buildUser() },
    'POST /api/users/1/2fa/setup': {
      status: 200,
      body: {
        secret: TEST_TOTP_SECRET,
        otpauth_uri: 'otpauth://x',
        qr_code: 'data:image/svg+xml;base64,abc',
      },
    },
    'POST /api/users/1/2fa/enable': { status: 200, body: { backup_codes: ['AAAAA-BBBBB-CCCCC'] } },
  }

  async function createAccountWithTwoFactor(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('switch', { name: 'Enable two-factor authentication' }))
    await createAccount(user)
  }

  it('runs the setup flow and reveals backup codes when the switch is on', async () => {
    const user = userEvent.setup()
    serve(routes)
    const onSuccess = vi.fn()

    renderWithQuery(<RegisterForm onSuccess={onSuccess} />)
    await createAccountWithTwoFactor(user)

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
    serve(routes)
    const onSuccess = vi.fn()

    renderWithQuery(<RegisterForm onSuccess={onSuccess} />)
    await createAccountWithTwoFactor(user)

    await user.click(await screen.findByRole('button', { name: 'Continue without two-factor' }))
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(requestsTo('POST', '/api/users/1/2fa/enable')).toHaveLength(0)
  })
})

describe('LoginPageContent', () => {
  it('renders the disabled-registration message when registration is off', async () => {
    const user = userEvent.setup()
    serve({
      'GET /api/settings': {
        status: 200,
        body: {
          allow_new_user_registration: false,
          default_language: 'en',
          display_timezone: 'UTC',
        },
      },
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
    serve({ 'POST /api/auth/login': { status: 200, body: buildUser() } })
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

describe('LoginForm errors', () => {
  it("shows the server's reason when the account is locked", async () => {
    const user = userEvent.setup()
    serve({ 'POST /api/auth/login': { status: 403, body: { detail: 'Account disabled' } } })

    renderWithQuery(<LoginForm onSuccess={vi.fn()} />)
    await logIn(user)

    expect(await screen.findByRole('alert')).toHaveTextContent('Account disabled')
  })

  it.each([
    ['an unexpected status', { status: 500, body: { detail: 'Internal' } }],
    ['a 403 without a reason', { status: 403, body: { detail: ['locked'] } }],
  ])('falls back to a generic message for %s', async (_, response) => {
    const user = userEvent.setup()
    serve({ 'POST /api/auth/login': response })

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
      'POST /api/auth/login': CHALLENGE,
      'POST /api/auth/2fa': { status: 200, body: buildUser() },
    })
    const onSuccess = vi.fn()

    renderWithQuery(<LoginForm onSuccess={onSuccess} />)
    await user.click(screen.getByRole('checkbox', { name: 'Remember me' }))
    await logIn(user)
    await user.type(await screen.findByLabelText('Authentication code'), '123456')

    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce())
    expect(bodyOf('POST', '/api/auth/login')).toMatchObject({ remember_me: true })
    expect(bodyOf('POST', '/api/auth/2fa')).toMatchObject({ remember_me: true })
  })

  it.each([
    [429, 'Too many attempts. Please wait a moment and try again.'],
    [500, 'Something went wrong. Please try again.'],
  ])('explains a %s when verifying the code', async (status, message) => {
    const user = userEvent.setup()
    serve({
      'POST /api/auth/login': CHALLENGE,
      'POST /api/auth/2fa': { status, body: { detail: 'nope' } },
    })

    renderWithQuery(<LoginForm onSuccess={vi.fn()} />)
    await logIn(user)
    await user.type(await screen.findByLabelText('Authentication code'), '123456')

    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.getByLabelText('Authentication code')).toHaveAttribute('aria-invalid', 'true')
  })

  it('hides the mode tabs during the code step and brings the login form back on cancel', async () => {
    const user = userEvent.setup()
    serve({ 'POST /api/auth/login': CHALLENGE, 'GET /api/settings': { status: 404 } })

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
  it('asks for every account field before continuing', async () => {
    const user = userEvent.setup()
    serve(REGISTER_ROUTES)

    renderWithQuery(<RegisterForm onSuccess={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findAllByText('This field is required')).toHaveLength(4)
    expect(screen.queryByText('Password does not meet all requirements')).toBeNull()
  })

  it('registers with the picked language, currency and theme, keeping the account step on the way back', async () => {
    const user = userEvent.setup()
    serve({ ...REGISTER_ROUTES, 'POST /api/auth/register': { status: 201, body: buildUser() } })
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
    expect(bodyOf('POST', '/api/auth/register')).toMatchObject({
      language: 'de',
      currency: 'USD',
      theme: 'DARK',
    })
  })

  it('puts field errors from the server back on the account step', async () => {
    const user = userEvent.setup()
    serve({
      ...REGISTER_ROUTES,
      'POST /api/auth/register': {
        status: 422,
        body: {
          detail: [
            { loc: ['body', 'display_name'], msg: 'Display name is reserved' },
            { loc: ['body', 0], msg: 'Ignored: no field' },
            'Ignored: not an object',
          ],
        },
      },
    })

    renderWithQuery(<RegisterForm onSuccess={vi.fn()} />)
    await createAccount(user)

    expect(await screen.findByText('Display name is reserved')).toBeInTheDocument()
    expect(screen.getByLabelText('Display name')).toHaveValue('Alice')
    expect(screen.queryByText(/Ignored/)).not.toBeInTheDocument()
    expect(screen.queryByText('Something went wrong. Please try again.')).toBeNull()
  })

  it("shows the server's password complaint on the password field", async () => {
    const user = userEvent.setup()
    serve({
      ...REGISTER_ROUTES,
      'POST /api/auth/register': {
        status: 422,
        body: { detail: 'Password appears in a data breach' },
      },
    })

    renderWithQuery(<RegisterForm onSuccess={vi.fn()} />)
    await createAccount(user)

    expect(await screen.findByText('Password appears in a data breach')).toBeInTheDocument()
  })

  it('keeps the rate-limit banner on both steps', async () => {
    const user = userEvent.setup()
    serve({
      ...REGISTER_ROUTES,
      'POST /api/auth/register': { status: 429, body: { detail: 'slow down' } },
    })

    renderWithQuery(<RegisterForm onSuccess={vi.fn()} />)
    await createAccount(user)

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
      ...REGISTER_ROUTES,
      'GET /api/settings': { status: 200, body: { allow_new_user_registration: true } },
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
  })

  it('keeps the page to return to from the URL', () => {
    expect(options.validateSearch({ next: '/stats' })).toEqual({ next: '/stats' })
    expect(options.validateSearch({})).toEqual({})
  })

  it('sends someone already signed in straight on to where they wanted to go', async () => {
    serve({ 'GET /api/auth/me': { status: 200, body: buildUser() } })

    await expect(beforeLoad('/stats')).rejects.toMatchObject({ options: { to: '/stats' } })
  })

  it('shows the login form to a visitor without a session', async () => {
    serve({ 'GET /api/auth/me': { status: 401, body: { detail: 'no session' } } })

    await expect(beforeLoad('/stats')).resolves.toBeUndefined()
  })

  it.each([
    ['/account/42', '/account/42'],
    ['//evil.example', '/'],
  ])('continues to %s after logging in (→ %s)', async (next, target) => {
    const user = userEvent.setup()
    routeState.search = { next }
    serve({
      'GET /api/settings': { status: 404 },
      'POST /api/auth/login': { status: 200, body: buildUser() },
    })

    renderWithQuery(<LoginPage />)
    await logIn(user)

    await waitFor(() => expect(loginRoute.push).toHaveBeenCalledExactlyOnceWith(target))
  })
})
