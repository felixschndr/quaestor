import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from './api'
import { authQueryKeys } from './auth'

export interface SessionRead {
  id: number
  created_at: string
  last_used_at: string
  ip: string | null
  user_agent: string | null
  is_current: boolean
}

export const sessionQueryKeys = {
  list: (userId: number) => ['users', userId, 'sessions'] as const,
}

export function useSessions(userId: number) {
  return useQuery({
    queryKey: sessionQueryKeys.list(userId),
    queryFn: () => api<SessionRead[]>(`/users/${userId}/sessions`),
  })
}

export function useRevokeSession(userId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (sessionId: number) =>
      api<void>(`/users/${userId}/sessions/${sessionId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sessionQueryKeys.list(userId) })
    },
  })
}

/**
 * "Sign out everywhere else". The backend deliberately rejects calls without
 * `exclude_current=true`, so we always pass it. The current session is the
 * only one left after this call.
 */
export function useRevokeAllOtherSessions(userId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      api<void>(`/users/${userId}/sessions?exclude_current=true`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sessionQueryKeys.list(userId) })
      // The current session's last_used_at can change too — keep me in sync.
      queryClient.invalidateQueries({ queryKey: authQueryKeys.me })
    },
  })
}
