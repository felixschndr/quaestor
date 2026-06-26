import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from './api'
import type { TransactionRead } from './accountHistory'
import type { TransactionCategory } from './transaction'

export const CONTRACT_FREQUENCIES = [
  'WEEKLY',
  'BIWEEKLY',
  'MONTHLY',
  'QUARTERLY',
  'YEARLY',
] as const
export type ContractFrequency = (typeof CONTRACT_FREQUENCIES)[number]

export type ContractSource = 'DETECTED' | 'MANUAL'
export type ContractAssignment = 'AUTO' | 'MANUAL' | 'EXCLUDED'

export interface ContractRead {
  id: number
  account_id: number
  name: string
  category: TransactionCategory | null
  source: ContractSource
  median_amount: number | null
  amount_spread: number | null
  frequency: ContractFrequency | null
  interval_days: number | null
  expected_next_date: string | null
  member_count: number
}

export interface ContractMemberRead extends TransactionRead {
  contract_assignment: ContractAssignment | null
  is_outlier: boolean
}

export interface ContractDetailRead extends ContractRead {
  members: ContractMemberRead[]
}

export interface ContractCreatePayload {
  name: string
  account_id: number
  category?: TransactionCategory | null
}

export interface ContractUpdatePayload {
  name: string
  category?: TransactionCategory | null
}

export const contractQueryKeys = {
  list: ['contracts'] as const,
  detail: (contractId: number) => ['contracts', contractId] as const,
}

export function useContracts() {
  return useQuery({
    queryKey: contractQueryKeys.list,
    queryFn: () => api<ContractRead[]>('/contracts'),
  })
}

export function useContract(contractId: number) {
  return useQuery({
    queryKey: contractQueryKeys.detail(contractId),
    queryFn: () => api<ContractDetailRead>(`/contracts/${contractId}`),
  })
}

export function useCreateContract() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: ContractCreatePayload) =>
      api<ContractDetailRead>('/contracts', { method: 'POST', body: payload }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contractQueryKeys.list })
    },
  })
}

export function useUpdateContract(contractId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: ContractUpdatePayload) =>
      api<ContractDetailRead>(`/contracts/${contractId}`, { method: 'PATCH', body: payload }),
    onSuccess: (updated) => {
      queryClient.setQueryData(contractQueryKeys.detail(contractId), updated)
      // Patch the list cache in place rather than refetching it — a rename only
      // touches name/category, so there's no need for an extra GET.
      queryClient.setQueryData<ContractRead[]>(contractQueryKeys.list, (old) =>
        old
          ? old.map((contract) =>
              contract.id === updated.id
                ? { ...contract, name: updated.name, category: updated.category }
                : contract,
            )
          : old,
      )
    },
  })
}

export function useDeleteContract() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (contractId: number) => api<void>(`/contracts/${contractId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contractQueryKeys.list })
      queryClient.invalidateQueries({ queryKey: ['account'] })
    },
  })
}

export function useAssignTransaction(contractId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (transactionId: number) =>
      api<ContractDetailRead>(`/contracts/${contractId}/transactions`, {
        method: 'POST',
        body: { transaction_id: transactionId },
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(contractQueryKeys.detail(contractId), updated)
      queryClient.invalidateQueries({ queryKey: contractQueryKeys.list })
      queryClient.invalidateQueries({ queryKey: ['account'] })
    },
  })
}

export function useRemoveTransaction(contractId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (transactionId: number) =>
      api<ContractDetailRead>(`/contracts/${contractId}/transactions/${transactionId}`, {
        method: 'DELETE',
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(contractQueryKeys.detail(contractId), updated)
      queryClient.invalidateQueries({ queryKey: contractQueryKeys.list })
      queryClient.invalidateQueries({ queryKey: ['account'] })
    },
  })
}
