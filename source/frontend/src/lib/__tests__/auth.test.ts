import { describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'

import { ApiError, NetworkError } from '@/lib/api'
import {
  AUTO_SYNC_MAX_AGE_MS,
  ensureAuthenticated,
  redirectIfAuthenticated,
  safeNext,
  staleSyncCredentialIds,
  type CredentialRead,
  type UserRead,
} from '@/lib/auth'

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

describe('staleSyncCredentialIds', () => {
  const NOW = Date.parse('2026-09-04T12:00:00Z')
  const JUST_SYNCED = new Date(NOW - AUTO_SYNC_MAX_AGE_MS / 2).toISOString()
  const LONG_AGO = new Date(NOW - 2 * AUTO_SYNC_MAX_AGE_MS).toISOString()

  function buildUser(credentials: Partial<CredentialRead>[]): UserRead {
    return {
      credentials: credentials.map((credential, index) => ({
        id: index + 1,
        bank: 'ing',
        bank_name: null,
        bank_icon: null,
        accounts: [],
        last_fetching_timestamp: LONG_AGO,
        requires_two_factor_authentication: false,
        sync_enabled: true,
        ...credential,
      })),
    } as UserRead
  }

  it.each([
    ['a credential synced long ago', {}, true],
    ['a credential that was never synced', { last_fetching_timestamp: null }, true],
    ['a credential synced just now', { last_fetching_timestamp: JUST_SYNCED }, false],
    ['a credential with sync disabled', { sync_enabled: false }, false],
    ['a manual credential', { bank: 'manual' }, false],
    ['a credential needing a second factor', { requires_two_factor_authentication: true }, false],
    [
      'a credential shared with write permission',
      { shared_from: 'Bob', share_permission: 'write' as const },
      true,
    ],
    [
      'a credential shared read-only',
      { shared_from: 'Bob', share_permission: 'read' as const },
      false,
    ],
  ])('%s is picked up: %j → %j', (_name, credential, expected) => {
    expect(staleSyncCredentialIds(buildUser([credential]), NOW)).toEqual(expected ? [1] : [])
  })

  it('returns nothing without a user', () => {
    expect(staleSyncCredentialIds(undefined, NOW)).toEqual([])
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
