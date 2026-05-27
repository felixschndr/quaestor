import { useMutation, useQueryClient } from '@tanstack/react-query'

import { api } from './api'
import { authQueryKeys, type AccountRead, type CredentialRead } from './auth'
import { formatIban } from './format'

export interface BankGroup {
  bank: string
  accounts: AccountRead[]
}

/**
 * Group accounts across all credentials by their bank, sorted alphabetically
 * by bank name; within each group, accounts are sorted alphabetically by name.
 *
 * A user can have multiple credentials for the same bank (e.g. two ING
 * logins), so accounts from different credentials are merged into one group.
 */
export function groupAccountsByBank(credentials: CredentialRead[]): BankGroup[] {
  const byBank = new Map<string, AccountRead[]>()
  for (const credential of credentials) {
    const list = byBank.get(credential.bank) ?? []
    for (const account of credential.accounts) list.push(account)
    byBank.set(credential.bank, list)
  }
  return Array.from(byBank.entries())
    .map(([bank, accounts]) => ({
      bank,
      accounts: [...accounts].sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.bank.localeCompare(b.bank))
}

export function bankIconUrl(bank: string): string {
  return `/static/banks/${bank}.png`
}

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: authQueryKeys.me })
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
