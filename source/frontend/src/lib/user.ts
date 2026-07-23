import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from './api'
import { authQueryKeys, type Theme, type UserRead } from './auth'
import { sessionQueryKeys } from './sessions'

export interface UserUpdatePayload {
  user_name?: string
  display_name?: string
  language?: string
  currency?: string
  theme?: Theme
  current_password?: string
  new_password?: string
}

export const userQueryKeys = {
  languages: ['i18n', 'languages'] as const,
  currencies: ['i18n', 'currencies'] as const,
}

interface SupportedLanguages {
  languages: string[]
}

interface SupportedCurrencies {
  currencies: string[]
}

export function useSupportedLanguages() {
  return useQuery({
    queryKey: userQueryKeys.languages,
    queryFn: () => api<SupportedLanguages>('/i18n/languages'),
    staleTime: Infinity,
  })
}

export function useSupportedCurrencies() {
  return useQuery({
    queryKey: userQueryKeys.currencies,
    queryFn: () => api<SupportedCurrencies>('/i18n/currencies'),
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
      queryClient.invalidateQueries({ queryKey: sessionQueryKeys.list(userId) })
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
