import { queryOptions, useQuery } from '@tanstack/react-query'

import { api } from './api'
import { authQueryKeys } from './auth'
import { useInvalidatingMutation } from './mutation'

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

export const sessionsQuery = (userId: number) =>
  queryOptions({
    queryKey: sessionQueryKeys.list(userId),
    queryFn: () => api<SessionRead[]>(`/users/${userId}/sessions`),
  })

export function useSessions(userId: number) {
  return useQuery(sessionsQuery(userId))
}

export function useRevokeSession(userId: number) {
  return useInvalidatingMutation({
    mutationFn: (sessionId: number) =>
      api<void>(`/users/${userId}/sessions/${sessionId}`, { method: 'DELETE' }),
    invalidate: [sessionQueryKeys.list(userId)],
  })
}

export function useRevokeAllOtherSessions(userId: number) {
  return useInvalidatingMutation({
    mutationFn: () => api<void>(`/users/${userId}/sessions`, { method: 'DELETE' }),
    invalidate: [sessionQueryKeys.list(userId), authQueryKeys.me],
  })
}
