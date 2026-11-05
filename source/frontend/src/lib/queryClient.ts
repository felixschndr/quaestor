import { QueryCache, QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import i18n from '@/i18n'

import { ApiError } from './api'
import { OFFLINE_CACHE_MAX_AGE_MS } from './offlineCache'

export const RATE_LIMITED_TOAST_ID = 'rate-limited'

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      if (error instanceof ApiError && error.status === 429) {
        toast.error(i18n.t('login.rateLimited'), { id: RATE_LIMITED_TOAST_ID })
      }
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: OFFLINE_CACHE_MAX_AGE_MS,
      refetchOnWindowFocus: true,
      retry: 1,
      networkMode: 'offlineFirst',
    },
    mutations: {
      retry: 0,
      networkMode: 'always',
    },
  },
})
