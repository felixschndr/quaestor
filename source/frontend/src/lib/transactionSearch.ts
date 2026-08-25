import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { api } from './api'
import type { TransactionRead } from './accountHistory'
import type { TransactionCategory, TransactionType } from './transaction'
import { accountScopedParams } from '@/lib/searchParams'

export interface TransactionFilters {
  text?: string
  amount_from?: number
  amount_to?: number
  date_from?: string // ISO yyyy-mm-dd
  date_to?: string
  transaction_types?: TransactionType[]
  categories?: TransactionCategory[]
  linked?: 'linked' | 'unlinked' | 'none'
  has_attachment?: 'with' | 'without' | 'none'
}

export function buildFilterQueryString(accountIds: number[], filters: TransactionFilters): string {
  return accountScopedParams(accountIds, { ...filters }).toString()
}

export const transactionSearchQueryKeys = {
  all: ['transactions', 'search'] as const,
  search: (accountIds: number[], filters: TransactionFilters) =>
    ['transactions', 'search', [...accountIds].sort((a, b) => a - b), filters] as const,
}

export function useSearchTransactions(accountIds: number[], filters: TransactionFilters) {
  const queryString = buildFilterQueryString(accountIds, filters)
  return useQuery({
    queryKey: transactionSearchQueryKeys.search(accountIds, filters),
    queryFn: () => api<TransactionRead[]>(`/transactions/search?${queryString}`),
    enabled: accountIds.length > 0,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  })
}
