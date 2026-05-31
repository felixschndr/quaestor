import { useQuery } from '@tanstack/react-query'

import { api } from './api'

export interface VersionInfo {
  current: string
  latest: string | null
  update_available: boolean
  release_url: string | null
}

export const versionQueryKeys = {
  version: ['version'] as const,
}

/** GET /api/version. Cached for an hour to match the server-side cache. */
export function useServerVersion() {
  return useQuery({
    queryKey: versionQueryKeys.version,
    queryFn: () => api<VersionInfo>('/version'),
    staleTime: 60 * 60 * 1000,
  })
}
