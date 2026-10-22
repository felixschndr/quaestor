import { createElement } from 'react'
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { authQueryKeys } from '@/lib/auth'
import { useOfflineWarmUp, warmUp } from '@/lib/offlineWarmup'

describe('warmUp', () => {
  it('loads every account and every contract up front once the offline cache is on', async () => {
    window.localStorage.setItem('offlineCache', 'on')
    const queryClient = new QueryClient()
    queryClient.setQueryData(authQueryKeys.me, {
      id: 1,
      credentials: [{ accounts: [{ id: 3 }, { id: 4 }] }],
    })
    globalThis.fetch = vi.fn((url: string) =>
      Promise.resolve(
        new Response(JSON.stringify(url === '/api/contracts' ? [{ id: 9 }] : []), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    ) as unknown as typeof fetch

    await warmUp(queryClient)

    const urls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
      ([url]) => url,
    )
    expect(urls).toEqual(
      expect.arrayContaining([
        '/api/account/3/history?page=1',
        '/api/account/4/history?page=1',
        '/api/account/4/expected-transactions',
        '/api/account/4/recurring-transactions',
        '/api/contracts',
        '/api/contracts/9',
        '/api/categorization',
      ]),
    )
  })
})

describe('warm-up conditions', () => {
  const MIN_GAP_MS = 5 * 60 * 1000
  let now = Date.now() + 24 * 60 * 60 * 1000

  function signedInClient(): QueryClient {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(authQueryKeys.me, {
      id: 1,
      credentials: [{ accounts: [{ id: 3 }] }],
    })
    return queryClient
  }

  function mockApi(contracts: { status: number; body?: unknown } = { status: 200, body: [] }) {
    globalThis.fetch = vi.fn((url: string) =>
      Promise.resolve(
        url === '/api/contracts'
          ? new Response(JSON.stringify(contracts.body ?? null), {
              status: contracts.status,
              headers: { 'content-type': 'application/json' },
            })
          : new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }),
      ),
    ) as unknown as typeof fetch
  }

  const requested = () =>
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map(([url]) => url)

  beforeEach(() => {
    vi.useFakeTimers()
    now += 2 * MIN_GAP_MS
    vi.setSystemTime(now)
    window.localStorage.setItem('offlineCache', 'on')
    mockApi()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does nothing before the user is known', async () => {
    await warmUp(new QueryClient())
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('does nothing unless the offline cache is on', async () => {
    window.localStorage.setItem('offlineCache', 'off')
    await warmUp(signedInClient())
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('does nothing while offline', async () => {
    onlineManager.setOnline(false)
    await warmUp(signedInClient())
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('loads everything at most once every five minutes', async () => {
    const queryClient = signedInClient()
    await warmUp(queryClient)
    const firstRun = requested().length
    expect(firstRun).toBeGreaterThan(0)

    vi.setSystemTime(now + MIN_GAP_MS - 1)
    await warmUp(queryClient)
    expect(requested()).toHaveLength(firstRun)

    vi.setSystemTime(now + MIN_GAP_MS)
    await warmUp(queryClient)
    expect(requested().length).toBeGreaterThan(firstRun)
  })

  it('loads the rest when a request fails, and skips the contract details then', async () => {
    mockApi({ status: 500, body: { detail: 'boom' } })

    await warmUp(signedInClient())

    expect(requested()).toEqual(
      expect.arrayContaining([
        '/api/contracts',
        '/api/account/3/history?page=1',
        '/api/categorization',
      ]),
    )
    expect(requested().filter((url) => url.startsWith('/api/contracts/'))).toEqual([])
  })

  it('warms up three seconds after sign-in and again when the app comes back online', async () => {
    const queryClient = signedInClient()
    const { rerender } = renderHook(({ userId }) => useOfflineWarmUp(userId), {
      initialProps: { userId: undefined as number | undefined },
      wrapper: ({ children }) =>
        createElement(QueryClientProvider, { client: queryClient }, children),
    })
    await vi.advanceTimersByTimeAsync(3_000)
    expect(globalThis.fetch).not.toHaveBeenCalled()

    rerender({ userId: 1 })
    await vi.advanceTimersByTimeAsync(2_999)
    expect(globalThis.fetch).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await vi.waitFor(() => expect(requested()).toContain('/api/contracts'))
    const firstRun = requested().length

    vi.setSystemTime(Date.now() + MIN_GAP_MS)
    onlineManager.setOnline(false)
    onlineManager.setOnline(true)
    await vi.waitFor(() => expect(requested().length).toBeGreaterThan(firstRun))
  })

  it('does not warm up after the user left', async () => {
    const queryClient = signedInClient()
    const { unmount } = renderHook(() => useOfflineWarmUp(1), {
      wrapper: ({ children }) =>
        createElement(QueryClientProvider, { client: queryClient }, children),
    })

    unmount()
    await vi.advanceTimersByTimeAsync(3_000)
    onlineManager.setOnline(false)
    onlineManager.setOnline(true)

    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})
