import { useMutation, useQueryClient } from '@tanstack/react-query'

import { api } from './api'
import { accountQueryKeys } from './accountHistory'
import { authQueryKeys, type AccountRead, type CredentialRead } from './auth'
import { formatIban } from './format'
import { statisticsQueryKeys } from './statistics'

export function accountDisplayName(account: Pick<AccountRead, 'name' | 'display_name'>): string {
  const trimmed = account.display_name?.trim()
  return trimmed || formatIban(account.name)
}

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
  include_by_default?: boolean
  balance?: number
}

export function defaultAccountIds(credentials: CredentialRead[]): number[] {
  return credentials.flatMap((credential) =>
    credential.accounts
      .filter((account) => account.include_by_default)
      .map((account) => account.id),
  )
}

/** Order-insensitive equality of two account-id selections. Used to collapse a
 *  selection that equals the default view back to "no filter" (no URL param). */
export function sameAccountSelection(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id))
}

export function useUpdateAccount() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ accountId, ...body }: AccountUpdatePayload & { accountId: number }) =>
      api<AccountRead>(`/account/${accountId}`, { method: 'PATCH', body }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: authQueryKeys.me })
      queryClient.invalidateQueries({ queryKey: accountQueryKeys.history(variables.accountId) })
      queryClient.invalidateQueries({ queryKey: statisticsQueryKeys.all })
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

export function accountNamesById(credentials: CredentialRead[]): Map<number, string> {
  const map = new Map<number, string>()
  for (const credential of credentials) {
    for (const account of credential.accounts) map.set(account.id, accountDisplayName(account))
  }
  return map
}

export interface AccountBank {
  name: string | null
  icon: string | null
}

export function bankByAccountId(credentials: CredentialRead[]): Map<number, AccountBank> {
  const map = new Map<number, AccountBank>()
  for (const credential of credentials) {
    const bank = { name: credential.bank_name, icon: credential.bank_icon }
    for (const account of credential.accounts) map.set(account.id, bank)
  }
  return map
}
