import { describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'

import { authQueryKeys } from '@/lib/auth'
import { warmUp } from '@/lib/offlineWarmup'

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
