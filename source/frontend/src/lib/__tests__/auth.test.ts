import { describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'

import { ApiError, NetworkError } from '@/lib/api'
import { ensureAuthenticated, redirectIfAuthenticated, safeNext } from '@/lib/auth'

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
  function buildQueryClient(): QueryClient {
    return new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    })
  }

  it('does nothing when pathname is /login', async () => {
    const queryClient = buildQueryClient()
    const fetchSpy = vi.spyOn(queryClient, 'ensureQueryData')

    await ensureAuthenticated({ queryClient, pathname: '/login', search: '' })

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('resolves silently when the auth.me query succeeds', async () => {
    const queryClient = buildQueryClient()
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 1,
          user_name: 'alice',
          display_name: 'Alice',
          language: 'en',
          balance: 0,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as unknown as typeof fetch

    await expect(
      ensureAuthenticated({ queryClient, pathname: '/', search: '' }),
    ).resolves.toBeUndefined()
  })

  it('throws a redirect with next=<path>?<search> on 401', async () => {
    const queryClient = buildQueryClient()
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: 'Not authenticated' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch

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
    const queryClient = buildQueryClient()
    const boom = new ApiError(500, { detail: 'Internal' }, 'GET /api/auth/me → 500')
    queryClient.ensureQueryData = vi.fn().mockRejectedValue(boom)

    await expect(ensureAuthenticated({ queryClient, pathname: '/', search: '' })).rejects.toBe(boom)
  })

  it('propagates a NetworkError when the backend is unreachable so the root error component can render an offline screen', async () => {
    const queryClient = buildQueryClient()
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new TypeError('Failed to fetch')) as unknown as typeof fetch

    await expect(
      ensureAuthenticated({ queryClient, pathname: '/account/3', search: '' }),
    ).rejects.toBeInstanceOf(NetworkError)
  })
})

describe('redirectIfAuthenticated', () => {
  function buildQueryClient(): QueryClient {
    return new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    })
  }

  it('stays on /login (resolves) when not authenticated (401)', async () => {
    const queryClient = buildQueryClient()
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: 'Not authenticated' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch

    await expect(redirectIfAuthenticated({ queryClient, next: undefined })).resolves.toBeUndefined()
  })

  it('stays on /login (resolves) when the backend is unreachable', async () => {
    const queryClient = buildQueryClient()
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new TypeError('Failed to fetch')) as unknown as typeof fetch

    await expect(redirectIfAuthenticated({ queryClient, next: undefined })).resolves.toBeUndefined()
  })

  it.each([
    [undefined, '/'],
    ['/account/42/transactions/7', '/account/42/transactions/7'],
    ['//evil.com', '/'],
  ])('redirects an authenticated user with next=%j to %j', async (next, expectedTo) => {
    const queryClient = buildQueryClient()
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 1,
          user_name: 'alice',
          display_name: 'Alice',
          language: 'en',
          balance: 0,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as unknown as typeof fetch

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
