import { toast } from 'sonner'
import { describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import { ApiError } from '@/lib/api'
import { OFFLINE_CACHE_MAX_AGE_MS } from '@/lib/offlineCache'
import { queryClient, RATE_LIMITED_TOAST_ID } from '@/lib/queryClient'

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

  it('toasts once per id when a query is rate limited, and stays quiet otherwise', async () => {
    const toastError = vi.spyOn(toast, 'error')
    const fail = (status: number) => () => Promise.reject(new ApiError(status, null, 'x'))

    await queryClient
      .query({ queryKey: ['rate-limited'], queryFn: fail(429), retry: false })
      .catch(() => {})
    await queryClient
      .query({ queryKey: ['server-error'], queryFn: fail(500), retry: false })
      .catch(() => {})

    expect(toastError).toHaveBeenCalledTimes(1)
    expect(toastError).toHaveBeenCalledWith(i18n.t('login.rateLimited'), {
      id: RATE_LIMITED_TOAST_ID,
    })
    toastError.mockRestore()
  })
})
