import type { ComponentType } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ErrorComponentProps } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import '@/i18n'

const root = vi.hoisted(() => ({
  pathname: '/',
  invalidate: vi.fn(),
}))

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const { NavLinkMock, routerMocks } = await import('./-routerMock')
  return {
    ...(await importOriginal<object>()),
    ...routerMocks({
      Link: NavLinkMock,
      Outlet: () => 'Page content',
      createRootRouteWithContext: () => (options: object) => ({ options }),
      useRouter: () => ({ invalidate: root.invalidate, history: { push: vi.fn() } }),
      useRouterState: ({
        select,
      }: {
        select: (s: { location: { pathname: string } }) => unknown
      }) => select({ location: { pathname: root.pathname } }),
    }),
  }
})
vi.mock('sonner', async () => {
  const { createElement } = await import('react')
  return {
    toast: Object.assign(vi.fn(), { error: vi.fn(), dismiss: vi.fn() }),
    Toaster: ({ theme }: { theme: string }) =>
      createElement('section', { 'aria-label': 'Notifications', 'data-theme': theme }),
  }
})
vi.mock('@/lib/push', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  autoSubscribe: vi.fn(),
}))
vi.mock('@/lib/notificationLog', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  consumeClickedNotification: vi.fn(),
}))
vi.mock('@/lib/offlineWarmup', () => ({ useOfflineWarmUp: vi.fn() }))

import { NetworkError } from '@/lib/api'
import type { UserRead } from '@/lib/auth'
import { formatMoney, setDisplayCurrency } from '@/lib/format'
import { consumeClickedNotification } from '@/lib/notificationLog'
import { useOfflineWarmUp } from '@/lib/offlineWarmup'
import { autoSubscribe } from '@/lib/push'
import { LoadingScreen, PageNotFoundScreen, RootErrorScreen, Route } from '@/routes/__root'
import { buildUser, jsonResponse, renderWithQuery } from './-settingsUserTestHelpers'

type RootOptions = {
  beforeLoad: (args: {
    context: { queryClient: QueryClient }
    location: { pathname: string; searchStr: string }
  }) => Promise<void>
  component: ComponentType
}
const options = (Route as unknown as { options: RootOptions }).options
const RootComponent = options.component

const SETTINGS = {
  allow_new_user_registration: true,
  default_language: 'en',
  default_currency: 'EUR',
  display_timezone: 'UTC',
}

function mockApi(me: { status: number; body?: unknown }) {
  globalThis.fetch = vi.fn((url: string) =>
    Promise.resolve(
      url === '/api/auth/me'
        ? jsonResponse(me)
        : url === '/api/settings'
          ? jsonResponse({ status: 200, body: SETTINGS })
          : jsonResponse({ status: 200, body: [] }),
    ),
  ) as unknown as typeof fetch
}

function signedIn(overrides: Partial<UserRead> = {}) {
  mockApi({ status: 200, body: buildUser(overrides) })
}

const signedOut = () => mockApi({ status: 401, body: { detail: 'Not authenticated' } })

beforeEach(() => {
  root.pathname = '/'
  window.localStorage.clear()
  document.documentElement.className = ''
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
})

afterEach(() => {
  setDisplayCurrency('EUR')
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('root beforeLoad', () => {
  const queryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })

  it('sends a visitor without a session to the login page, remembering where they were', async () => {
    signedOut()

    const thrown = await options
      .beforeLoad({
        context: { queryClient: queryClient() },
        location: { pathname: '/stats', searchStr: '?range=1y' },
      })
      .catch((err: unknown) => err)

    expect(thrown).toMatchObject({
      options: { to: '/login', search: { next: '/stats?range=1y' } },
    })
  })

  it("switches amounts to the user's currency once signed in", async () => {
    signedIn({ currency: 'USD' })

    await options.beforeLoad({
      context: { queryClient: queryClient() },
      location: { pathname: '/', searchStr: '' },
    })

    expect(formatMoney(1)).toBe('$1.00')
  })

  it('keeps the instance currency when the user has none', async () => {
    signedIn({ currency: '' })

    await options.beforeLoad({
      context: { queryClient: queryClient() },
      location: { pathname: '/', searchStr: '' },
    })

    expect(formatMoney(1)).toContain('€')
  })
})

describe('RootComponent', () => {
  it("renders the page with the tab bar in the user's theme", async () => {
    signedIn({ theme: 'DARK' })
    renderWithQuery(<RootComponent />)

    expect(screen.getByText('Page content')).toBeInTheDocument()
    expect(screen.getByRole('navigation')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Notifications' })).toHaveAttribute(
        'data-theme',
        'dark',
      ),
    )
    expect(document.documentElement).toHaveClass('dark')
  })

  it.each(['/login', '/banking/callback'])('leaves the tab bar out on %s', (pathname) => {
    root.pathname = pathname
    signedOut()
    renderWithQuery(<RootComponent />)

    expect(screen.getByText('Page content')).toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })

  it('uses the theme stored on this device until the user is known', () => {
    window.localStorage.setItem('theme', 'LIGHT')
    signedOut()
    renderWithQuery(<RootComponent />)

    expect(screen.getByRole('region', { name: 'Notifications' })).toHaveAttribute(
      'data-theme',
      'light',
    )
    expect(document.documentElement).toHaveClass('light')
  })

  it('subscribes to push, opens a clicked notification and warms the cache once signed in', async () => {
    signedIn({ id: 42, currency: 'USD' })
    renderWithQuery(<RootComponent />)

    expect(useOfflineWarmUp).toHaveBeenCalledWith(undefined)
    await waitFor(() => expect(autoSubscribe).toHaveBeenCalledOnce())
    expect(consumeClickedNotification).toHaveBeenCalledExactlyOnceWith(expect.any(QueryClient))
    expect(useOfflineWarmUp).toHaveBeenLastCalledWith(42)
    expect(formatMoney(1)).toBe('$1.00')
  })

  it('does none of that for a visitor without a session', async () => {
    signedOut()
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <RootComponent />
      </QueryClientProvider>,
    )

    await waitFor(() => expect(queryClient.getQueryState(['auth', 'me'])?.status).toBe('error'))
    expect(autoSubscribe).not.toHaveBeenCalled()
    expect(consumeClickedNotification).not.toHaveBeenCalled()
    expect(useOfflineWarmUp).not.toHaveBeenCalledWith(expect.any(Number))
  })
})

describe('LoadingScreen', () => {
  it('renders a status region labelled with the loading message', () => {
    render(<LoadingScreen />)
    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-label', 'Loading…')
    expect(status).toHaveAttribute('aria-live', 'polite')
  })

  it('renders the visually-hidden loading text so screen readers announce it', () => {
    render(<LoadingScreen />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })
})

describe('PageNotFoundScreen', () => {
  it('says so and leads back to the overview', () => {
    render(<PageNotFoundScreen />)

    expect(screen.getByRole('status')).toHaveTextContent('The page you seek, this is not.')
    expect(screen.getByRole('link', { name: 'Back to overview' })).toHaveAttribute('href', '/')
  })
})

describe('RootErrorScreen', () => {
  function renderError(error: Error) {
    const reset = vi.fn()
    render(<RootErrorScreen {...({ error, reset } as unknown as ErrorComponentProps)} />)
    return reset
  }

  it('explains that the server is unreachable on a network error', () => {
    renderError(new NetworkError(new TypeError('Failed to fetch')))

    expect(screen.getByRole('heading', { name: 'Server unreachable' })).toBeInTheDocument()
    expect(screen.getByText(/can't reach the server right now/)).toBeInTheDocument()
  })

  it('shows a generic message for anything else', () => {
    renderError(new Error('boom'))

    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument()
    expect(screen.getByText('An unexpected error occurred. Please try again.')).toBeInTheDocument()
  })

  it('resets the error and reloads the route data on retry', async () => {
    const reset = renderError(new Error('boom'))

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(reset).toHaveBeenCalledOnce()
    expect(root.invalidate).toHaveBeenCalledOnce()
  })
})
