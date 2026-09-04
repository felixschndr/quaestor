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

export function useServerVersion() {
  return useQuery({
    queryKey: versionQueryKeys.version,
    queryFn: () => api<VersionInfo>('/version'),
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  })
}

const UPDATE_CHECK_MIN_GAP_MS = 60 * 60 * 1000
let lastUpdateCheck = 0

export async function checkForFrontendUpdate(): Promise<void> {
  if (!('serviceWorker' in navigator) || !navigator.onLine) return
  if (Date.now() - lastUpdateCheck < UPDATE_CHECK_MIN_GAP_MS) return
  const registration = await navigator.serviceWorker.getRegistration()
  if (!registration) return
  try {
    await registration.update()
    lastUpdateCheck = Date.now()
  } catch {
    // Backend restarting mid-deploy; retry on the next foreground instead of waiting an hour.
  }
}
