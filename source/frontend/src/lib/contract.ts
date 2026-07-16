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

export const CONTRACT_FREQUENCY_FILTERS = [...CONTRACT_FREQUENCIES, 'NONE'] as const
export type ContractFrequencyFilter = (typeof CONTRACT_FREQUENCY_FILTERS)[number]

export type ContractSource = 'DETECTED' | 'MANUAL'
export type ContractAssignment = 'AUTO' | 'MANUAL' | 'EXCLUDED'

export interface ContractRead {
  id: number
  account_id: number
  name: string
  note: string | null
  category: TransactionCategory | null
  source: ContractSource
  median_amount: number | null
  amount_spread: number | null
  frequency: ContractFrequency | null
  interval_days: number | null
  expected_next_date: string | null
  is_overdue: boolean
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
  frequencies?: ContractFrequencyFilter[]
  overdue?: boolean
}

export function filterContracts(
  contracts: ContractRead[],
  filters: ContractFilters,
): ContractRead[] {
  const { account_ids, amount_from, amount_to, categories, frequencies, overdue } = filters
  // A facet is inactive only when its key is absent. A present-but-empty array
  // means "none selected" and matches nothing (the "Keine" button).
  return contracts.filter((contract) => {
    if (account_ids && !account_ids.includes(contract.account_id)) return false
    if (categories && !(contract.category && categories.includes(contract.category))) return false
    if (frequencies && !frequencies.includes(contract.frequency ?? 'NONE')) return false
    if (amount_from !== undefined && (contract.median_amount ?? -Infinity) < amount_from)
      return false
    if (amount_to !== undefined && (contract.median_amount ?? Infinity) > amount_to) return false
    if (overdue && !contract.is_overdue) return false
    return true
  })
}

export type ContractCostPeriod = 'DAY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
export const CONTRACT_COST_PERIODS: ContractCostPeriod[] = ['DAY', 'WEEKLY', 'MONTHLY', 'YEARLY']

export function contractAmountForPeriod(
  contract: ContractRead,
  period: ContractCostPeriod,
): number | null {
  if (period === 'DAY') return contract.amount_per_day
  return contract.amount_per_frequency?.[period] ?? null
}

export function sumContractsForPeriod(
  contracts: ContractRead[],
  period: ContractCostPeriod,
): number {
  return contracts.reduce((sum, contract) => {
    const value = contractAmountForPeriod(contract, period)
    return value === null ? sum : sum + value
  }, 0)
}

export const OVERDUE_BANNER_MONTHS = 2

export function monthsOverdue(expectedNextDate: string, now: Date = new Date()): number {
  const due = new Date(`${expectedNextDate}T00:00:00`)
  if (Number.isNaN(due.getTime())) return 0
  let months = (now.getFullYear() - due.getFullYear()) * 12 + (now.getMonth() - due.getMonth())
  if (now.getDate() < due.getDate()) months -= 1
  return Math.max(0, months)
}

export function hasActiveContractFilters(filters: ContractFilters): boolean {
  return Boolean(
    filters.account_ids !== undefined ||
    filters.categories !== undefined ||
    filters.frequencies !== undefined ||
    filters.amount_from !== undefined ||
    filters.amount_to !== undefined ||
    filters.overdue,
  )
}

export interface ContractCreatePayload {
  name: string
  account_id: number
  category?: TransactionCategory | null
  frequency?: ContractFrequency | null
}

export interface ContractUpdatePayload {
  name: string
  category?: TransactionCategory | null
  note?: string | null
  frequency?: ContractFrequency | null
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
      queryClient.setQueryData<ContractRead[]>(contractQueryKeys.list, (old) =>
        old
          ? old.map((contract) =>
              contract.id === updated.id
                ? {
                    ...contract,
                    name: updated.name,
                    category: updated.category,
                    frequency: updated.frequency,
                    interval_days: updated.interval_days,
                    expected_next_date: updated.expected_next_date,
                    is_overdue: updated.is_overdue,
                    amount_per_day: updated.amount_per_day,
                    amount_per_frequency: updated.amount_per_frequency,
                  }
                : contract,
            )
          : old,
      )
      queryClient.invalidateQueries({ queryKey: ['account'] })
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

export interface SetTransactionContractArgs {
  transactionId: number
  fromContractId: number | null
  toContractId: number | null
}

export function useSetTransactionContract() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ transactionId, fromContractId, toContractId }: SetTransactionContractArgs) =>
      toContractId !== null
        ? api<ContractDetailRead>(`/contracts/${toContractId}/transactions`, {
            method: 'POST',
            body: { transaction_id: transactionId },
          })
        : api<ContractDetailRead>(`/contracts/${fromContractId}/transactions/${transactionId}`, {
            method: 'DELETE',
          }),
    onSuccess: (_updated, { fromContractId, toContractId }) => {
      queryClient.invalidateQueries({ queryKey: contractQueryKeys.list })
      queryClient.invalidateQueries({ queryKey: ['account'] })
      if (fromContractId !== null)
        queryClient.invalidateQueries({ queryKey: contractQueryKeys.detail(fromContractId) })
      if (toContractId !== null)
        queryClient.invalidateQueries({ queryKey: contractQueryKeys.detail(toContractId) })
    },
  })
}
