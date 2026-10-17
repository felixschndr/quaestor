import { QueryClient } from '@tanstack/react-query'

import { OFFLINE_CACHE_MAX_AGE_MS } from './offlineCache'

export const queryClient = new QueryClient({
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
