import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { accountGroupQueryKeys } from './accountGroups'
import { api } from './api'
import { authQueryKeys, type AccountRead, type CredentialRead, type SharePermission } from './auth'
import { statisticsQueryKeys } from './statistics'

export interface ShareableUser {
  id: number
  display_name: string
}

export interface AccountShareRecipient {
  id: number
  user_id: number
  display_name: string
  permission: SharePermission
  status: 'pending' | 'accepted'
}

export function shareUserLabel(user: { id: number; display_name: string }): string {
  return user.display_name.trim() || `#${user.id}`
}

export const accountShareQueryKeys = {
  users: ['account_shares', 'users'] as const,
  forAccount: (accountId: number) => ['account_shares', 'account', accountId] as const,
}

export function isSharedCredential(credential: CredentialRead): boolean {
  return Boolean(credential.shared_from)
}

export function useShareableUsers() {
  return useQuery({
    queryKey: accountShareQueryKeys.users,
    queryFn: () => api<ShareableUser[]>('/account_shares/users'),
  })
}

export function useAccountShares(accountId: number) {
  return useQuery({
    queryKey: accountShareQueryKeys.forAccount(accountId),
    queryFn: () => api<AccountShareRecipient[]>(`/account_shares/account/${accountId}`),
  })
}

function useShareMutation<TVariables>(
  accountId: number | null,
  request: (variables: TVariables) => Promise<unknown>,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: request,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: authQueryKeys.me })
      queryClient.invalidateQueries({ queryKey: statisticsQueryKeys.all })
      // Accepting or leaving a share adds/removes an account from the overview layout.
      queryClient.invalidateQueries({ queryKey: accountGroupQueryKeys.layout })
      if (accountId !== null) {
        queryClient.invalidateQueries({ queryKey: accountShareQueryKeys.forAccount(accountId) })
      }
    },
  })
}

export function useShareAccount(accountId: number) {
  return useShareMutation(accountId, (payload: { user_id: number; permission: SharePermission }) =>
    api(`/account_shares/account/${accountId}`, { method: 'POST', body: payload }),
  )
}

export function useUpdateSharePermission(accountId: number) {
  return useShareMutation(
    accountId,
    ({ shareId, permission }: { shareId: number; permission: SharePermission }) =>
      api(`/account_shares/${shareId}`, { method: 'PATCH', body: { permission } }),
  )
}

export function useRevokeShare(accountId: number) {
  return useShareMutation(accountId, (shareId: number) =>
    api<void>(`/account_shares/${shareId}`, { method: 'DELETE' }),
  )
}

export function useRespondToInvitation() {
  return useShareMutation(null, ({ shareId, accept }: { shareId: number; accept: boolean }) =>
    api<void>(`/account_shares/${shareId}/${accept ? 'accept' : 'decline'}`, { method: 'POST' }),
  )
}

export interface ShareSettingsPayload {
  display_name?: string | null
  balance_factor?: number
  is_hidden?: boolean
  include_by_default?: boolean
}

export function useUpdateShareSettings() {
  return useShareMutation(
    null,
    ({ accountId, ...body }: ShareSettingsPayload & { accountId: number }) =>
      api<AccountRead>(`/account_shares/account/${accountId}/mine`, { method: 'PATCH', body }),
  )
}

export function useLeaveShare() {
  return useShareMutation(null, (accountId: number) =>
    api<void>(`/account_shares/account/${accountId}/mine`, { method: 'DELETE' }),
  )
}
