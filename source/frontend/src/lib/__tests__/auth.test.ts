import { describe, expect, it, vi } from 'vitest'
import { onlineManager, QueryClient } from '@tanstack/react-query'

import { ApiError, NetworkError } from '@/lib/api'
import { authQueryKeys, ensureAuthenticated, redirectIfAuthenticated, safeNext } from '@/lib/auth'
import { buildUser, createTestQueryClient, jsonResponse } from '@/test/helpers'

function respondWith(status: number, body: unknown) {
  globalThis.fetch = vi
    .fn()
    .mockResolvedValue(jsonResponse({ status, body })) as unknown as typeof fetch
}

function failFetch() {
  globalThis.fetch = vi
    .fn()
    .mockRejectedValue(new TypeError('Failed to fetch')) as unknown as typeof fetch
}

describe('safeNext', () => {
  it.each([
    [undefined, '/'],
    ['', '/'],
    ['//evil.com', '/'],
    ['//evil.com/path', '/'],
    ['http://evil.com', '/'],
    ['https://evil.com', '/'],
    ['relative', '/'],
    ['/', '/'],
    ['/transactions/1', '/transactions/1'],
    ['/account/42/transactions/7?from=overview', '/account/42/transactions/7?from=overview'],
  ])('safeNext(%j) → %j', (input, expected) => {
    expect(safeNext(input)).toBe(expected)
  })
})

describe('ensureAuthenticated', () => {
  it('does nothing when pathname is /login', async () => {
    const queryClient = createTestQueryClient()
    const fetchSpy = vi.spyOn(queryClient, 'query')

    await ensureAuthenticated({ queryClient, pathname: '/login', search: '' })

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('resolves silently when the auth.me query succeeds', async () => {
    const queryClient = createTestQueryClient()
    respondWith(200, buildUser())

    await expect(
      ensureAuthenticated({ queryClient, pathname: '/', search: '' }),
    ).resolves.toBeUndefined()
  })

  it('throws a redirect with next=<path>?<search> on 401', async () => {
    const queryClient = createTestQueryClient()
    respondWith(401, { detail: 'Not authenticated' })

    // TanStack Router's redirect() throws a value with `isRedirect: true`.
    // We just need to confirm the guard threw something carrying our `next`.
    let thrown: unknown
    try {
      await ensureAuthenticated({
        queryClient,
        pathname: '/account/42/transactions/7',
        search: '?from=overview',
      })
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeTruthy()
    const search = (thrown as { options?: { search?: { next?: string } } }).options?.search
    expect(search?.next).toBe('/account/42/transactions/7?from=overview')
  })

  it('re-throws non-401 ApiErrors as-is', async () => {
    const queryClient = createTestQueryClient()
    const boom = new ApiError(500, { detail: 'Internal' }, 'GET /api/auth/me → 500')
    queryClient.query = vi.fn().mockRejectedValue(boom)

    await expect(ensureAuthenticated({ queryClient, pathname: '/', search: '' })).rejects.toBe(boom)
  })

  it('propagates a NetworkError when the backend is unreachable so the root error component can render an offline screen', async () => {
    const queryClient = createTestQueryClient()
    failFetch()

    await expect(
      ensureAuthenticated({ queryClient, pathname: '/account/3', search: '' }),
    ).rejects.toBeInstanceOf(NetworkError)
  })
})

describe('ensureAuthenticated with a cached user', () => {
  const cachedUser = { id: 1, user_name: 'alice' }

  function buildQueryClientWithCachedUser(): QueryClient {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(authQueryKeys.me, cachedUser, { updatedAt: 0 })
    queryClient.setQueryData(['account', 3, 'history'], { transactions: [] })
    return queryClient
  }

  it('lets the user in with the cached user while the server is unreachable', async () => {
    const queryClient = buildQueryClientWithCachedUser()
    failFetch()

    await expect(
      ensureAuthenticated({ queryClient, pathname: '/account/3', search: '' }),
    ).resolves.toBeUndefined()
  })

  it('does not even ask the server while offline', async () => {
    const queryClient = buildQueryClientWithCachedUser()
    globalThis.fetch = vi.fn() as unknown as typeof fetch
    onlineManager.setOnline(false)

    await ensureAuthenticated({ queryClient, pathname: '/account/3', search: '' })

    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('drops all cached data when the session behind the cached user expired', async () => {
    const queryClient = buildQueryClientWithCachedUser()
    respondWith(401, { detail: 'Not authenticated' })

    await expect(
      ensureAuthenticated({ queryClient, pathname: '/account/3', search: '' }),
    ).rejects.toBeTruthy()

    expect(queryClient.getQueryCache().getAll()).toEqual([])
  })
})

describe('redirectIfAuthenticated', () => {
  it('stays on /login (resolves) when not authenticated (401)', async () => {
    const queryClient = createTestQueryClient()
    respondWith(401, { detail: 'Not authenticated' })

    await expect(redirectIfAuthenticated({ queryClient, next: undefined })).resolves.toBeUndefined()
  })

  it('stays on /login (resolves) when the backend is unreachable', async () => {
    const queryClient = createTestQueryClient()
    failFetch()

    await expect(redirectIfAuthenticated({ queryClient, next: undefined })).resolves.toBeUndefined()
  })

  it.each([
    [undefined, '/'],
    ['/account/42/transactions/7', '/account/42/transactions/7'],
    ['//evil.com', '/'],
  ])('redirects an authenticated user with next=%j to %j', async (next, expectedTo) => {
    const queryClient = createTestQueryClient()
    respondWith(200, buildUser())

    let thrown: unknown
    try {
      await redirectIfAuthenticated({ queryClient, next })
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeTruthy()
    expect((thrown as { options?: { to?: string } }).options?.to).toBe(expectedTo)
  })
})
