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
  min_amount: number | null
  average_amount: number | null
  max_amount: number | null
  frequency: ContractFrequency | null
  interval_days: number | null
  expected_next_date: string | null
  member_count: number
  amount_per_day: number | null
  amount_per_frequency: Record<ContractFrequency, number> | null
}

export interface ContractMemberRead extends TransactionRead {
  contract_assignment: ContractAssignment | null
  is_outlier: boolean
}

export interface ContractDetailRead extends ContractRead {
  members: ContractMemberRead[]
}

export interface ContractFilters {
  account_ids?: number[]
  amount_from?: number
  amount_to?: number
  categories?: TransactionCategory[]
  frequencies?: ContractFrequency[]
}

export function filterContracts(
  contracts: ContractRead[],
  filters: ContractFilters,
): ContractRead[] {
  const { account_ids, amount_from, amount_to, categories, frequencies } = filters
  // A facet is inactive only when its key is absent. A present-but-empty array
  // means "none selected" and matches nothing (the "Keine" button).
  return contracts.filter((contract) => {
    if (account_ids && !account_ids.includes(contract.account_id)) return false
    if (categories && !(contract.category && categories.includes(contract.category))) return false
    if (frequencies && !(contract.frequency && frequencies.includes(contract.frequency)))
      return false
    if (amount_from !== undefined && (contract.median_amount ?? -Infinity) < amount_from)
      return false
    if (amount_to !== undefined && (contract.median_amount ?? Infinity) > amount_to) return false
    return true
  })
}

export function hasActiveContractFilters(filters: ContractFilters): boolean {
  return Boolean(
    filters.account_ids !== undefined ||
    filters.categories !== undefined ||
    filters.frequencies !== undefined ||
    filters.amount_from !== undefined ||
    filters.amount_to !== undefined,
  )
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
