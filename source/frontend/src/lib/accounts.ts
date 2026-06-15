import { useMutation, useQueryClient } from '@tanstack/react-query'

import { api } from './api'
import { accountQueryKeys } from './accountHistory'
import { authQueryKeys, type AccountRead } from './auth'
import { formatIban } from './format'

/**
 * Primary label for an account: the user-set personalised name when present,
 * otherwise the formatted IBAN. Whitespace-only display names count as unset.
 */
export function accountDisplayName(account: Pick<AccountRead, 'name' | 'display_name'>): string {
  const trimmed = account.display_name?.trim()
  return trimmed || formatIban(account.name)
}

/**
 * Secondary label to show below {@link accountDisplayName}: the formatted IBAN
 * when a personalised name is set, `null` otherwise (because the primary label
 * is already the IBAN, so a duplicate would be noise).
 */
export function accountSecondaryName(
  account: Pick<AccountRead, 'name' | 'display_name'>,
): string | null {
  return account.display_name?.trim() ? formatIban(account.name) : null
}

export function displayNameOrUserName(user: { display_name: string; user_name: string }): string {
  return user.display_name.trim() || user.user_name
}

export interface AccountUpdatePayload {
  balance_factor?: number
  display_name?: string | null
  is_hidden?: boolean
  balance?: number
}

export function useUpdateAccount() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ accountId, ...body }: AccountUpdatePayload & { accountId: number }) =>
      api<AccountRead>(`/account/${accountId}`, { method: 'PATCH', body }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: authQueryKeys.me })
      queryClient.invalidateQueries({ queryKey: accountQueryKeys.history(variables.accountId) })
      queryClient.invalidateQueries({ queryKey: ['statistics'] })
    },
  })
}

export interface ManualAccountCreatePayload {
  credential_id: number
  name: string
  display_name?: string | null
  balance?: number
  balance_factor?: number
}

export function useCreateManualAccount() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: ManualAccountCreatePayload) =>
      api<AccountRead>('/account', { method: 'POST', body: payload }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: authQueryKeys.me })
    },
  })
}

export function useDeleteAccount() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (accountId: number) => api<void>(`/account/${accountId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: authQueryKeys.me })
    },
  })
}
