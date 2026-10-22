import { describe, expect, it } from 'vitest'

import { OFFLINE_CACHE_MAX_AGE_MS } from '@/lib/offlineCache'
import { queryClient } from '@/lib/queryClient'

describe('queryClient', () => {
  it('keeps unused data as long as the offline cache and serves the cache first when offline', () => {
    expect(queryClient.getDefaultOptions().queries).toMatchObject({
      gcTime: OFFLINE_CACHE_MAX_AGE_MS,
      networkMode: 'offlineFirst',
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      retry: 1,
    })
  })

  it('never retries or holds back a mutation', () => {
    expect(queryClient.getDefaultOptions().mutations).toMatchObject({
      retry: 0,
      networkMode: 'always',
    })
  })
})
