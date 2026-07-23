import { useQuery, type QueryClient } from '@tanstack/react-query'
import { api } from './api'
import { setDisplayTimeZone } from './format'

export interface AppSettings {
  allow_new_user_registration: boolean
  default_language: string
  display_timezone: string
  sync_interval_hours: number
  allowed_attachment_extensions: string[]
  max_attachment_size_mb: number
}

export const settingsQueryKey = ['settings'] as const

function fetchSettings(): Promise<AppSettings> {
  return api<AppSettings>('/settings')
}

export async function ensureAppSettings(queryClient: QueryClient): Promise<void> {
  try {
    const settings = await queryClient.ensureQueryData({
      queryKey: settingsQueryKey,
      queryFn: fetchSettings,
      staleTime: Infinity,
    })
    setDisplayTimeZone(settings.display_timezone)
  } catch {
    // Keep the UTC default; the timestamps just won't be zone-shifted.
  }
}

export function useAppSettings() {
  return useQuery({
    queryKey: settingsQueryKey,
    queryFn: fetchSettings,
    staleTime: Infinity,
  })
}
