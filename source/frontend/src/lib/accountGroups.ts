import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from './api'
import { authQueryKeys } from './auth'

export interface AccountGroupAccountRef {
  id: number
}

export interface AccountGroupRead {
  id: number
  name: string
  accounts: AccountGroupAccountRef[]
}

export interface AccountGroupLayout {
  groups: AccountGroupRead[]
  ungrouped: AccountGroupAccountRef[]
}

export interface AccountGroupLayoutWriteGroup {
  /** Omit for new groups, supply for renames / reorders / moves. */
  id?: number
  name: string
  account_ids: number[]
}

export interface AccountGroupLayoutWrite {
  groups: AccountGroupLayoutWriteGroup[]
  ungrouped: number[]
}

export const accountGroupQueryKeys = {
  layout: ['account_groups', 'layout'] as const,
}

export function useAccountGroupLayout() {
  return useQuery({
    queryKey: accountGroupQueryKeys.layout,
    queryFn: () => api<AccountGroupLayout>('/account_groups/layout'),
  })
}

export function usePutAccountGroupLayout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: AccountGroupLayoutWrite) =>
      api<AccountGroupLayout>('/account_groups/layout', { method: 'PUT', body: payload }),
    onSuccess: (layout) => {
      queryClient.setQueryData(accountGroupQueryKeys.layout, layout)
      // Overview reads the layout via /auth/me indirectly (account list), so
      // any rename/reorder might affect what's rendered there too.
      queryClient.invalidateQueries({ queryKey: authQueryKeys.me })
    },
  })
}
