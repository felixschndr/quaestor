import { render, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Mock } from 'vitest'
import type { PasswordRequirements, UserRead } from '@/lib/auth'

export const PASSWORD_REQUIREMENTS: PasswordRequirements = {
  min_length: 15,
  rules: [
    { name: 'lower', regex: '[a-z]', description: 'a lowercase letter' },
    { name: 'upper', regex: '[A-Z]', description: 'an uppercase letter' },
    { name: 'digit', regex: '\\d', description: 'a digit' },
    { name: 'symbol', regex: '[^A-Za-z0-9]', description: 'a special character' },
  ],
}

export function buildUser(overrides: Partial<UserRead> = {}): UserRead {
  return {
    id: 1,
    user_name: 'alice',
    display_name: 'Alice',
    language: 'en',
    currency: 'EUR',
    theme: 'SYSTEM',
    two_factor_enabled: false,
    show_upcoming_contracts: true,
    balance: 0,
    credentials: [],
    ...overrides,
  }
}

export function jsonResponse({ status, body }: { status: number; body?: unknown }): Response {
  return new Response(body !== undefined ? JSON.stringify(body) : null, {
    status,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
  })
}

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
}

function queryWrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

export function renderWithQuery(ui: ReactNode, client = createTestQueryClient()) {
  return render(ui, { wrapper: queryWrapper(client) })
}

export function renderHookWithClient<Result>(hook: () => Result, client = createTestQueryClient()) {
  return { client, ...renderHook(hook, { wrapper: queryWrapper(client) }) }
}

export type Served = Record<string, { status: number; body?: unknown } | (() => Response)>

export function serve(
  routes: Served,
  intercept?: (url: string, init?: RequestInit) => Promise<Response> | null,
): Mock {
  const fetchMock = globalThis.fetch as Mock
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    const intercepted = intercept?.(url, init)
    if (intercepted) return intercepted
    const key = `${init?.method ?? 'GET'} ${url}`
    const route = routes[key]
    if (!route) return Promise.reject(new Error(`unexpected fetch: ${key}`))
    return Promise.resolve(typeof route === 'function' ? route() : jsonResponse(route))
  })
  return fetchMock
}

export function requestsTo(method: string, url: string) {
  return (globalThis.fetch as Mock).mock.calls.filter(
    ([calledUrl, init]) => calledUrl === url && (init?.method ?? 'GET') === method,
  )
}

export function bodyOf(method: string, url: string): unknown {
  const [call] = requestsTo(method, url)
  return JSON.parse(call[1].body)
}
