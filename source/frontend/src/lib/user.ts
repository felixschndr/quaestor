import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from './api'
import { authQueryKeys, type UserRead } from './auth'

export interface UserUpdatePayload {
  display_name?: string
  language?: string
  current_password?: string
  new_password?: string
}

export const userQueryKeys = {
  languages: ['i18n', 'languages'] as const,
}

interface SupportedLanguages {
  languages: string[]
}

export function useSupportedLanguages() {
  return useQuery({
    queryKey: userQueryKeys.languages,
    queryFn: () => api<SupportedLanguages>('/i18n/languages'),
    staleTime: Infinity,
  })
}

/**
 * PATCH /api/users/{id}. On success the /auth/me cache is refreshed so the
 * UI sees the new display_name / language without a round-trip.
 */
export function useUpdateUser(userId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: UserUpdatePayload) =>
      api<UserRead>(`/users/${userId}`, { method: 'PATCH', body: payload }),
    onSuccess: (user) => {
      queryClient.setQueryData(authQueryKeys.me, user)
    },
  })
}

/** DELETE /api/users/{id}. Clears the me cache so the root guard redirects to /login. */
export function useDeleteUser(userId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api<void>(`/users/${userId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.setQueryData(authQueryKeys.me, null)
      queryClient.removeQueries({ queryKey: authQueryKeys.me })
    },
  })
}

/** POST /api/auth/logout. Drops the me cache so the next render redirects to /login. */
export function useLogout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api<void>('/auth/logout', { method: 'POST' }),
    onSuccess: () => {
      queryClient.setQueryData(authQueryKeys.me, null)
      queryClient.removeQueries({ queryKey: authQueryKeys.me })
    },
  })
}
