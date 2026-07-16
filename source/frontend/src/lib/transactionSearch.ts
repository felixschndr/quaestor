import { useQuery } from '@tanstack/react-query'

import { api } from './api'
import type { TransactionRead } from './accountHistory'
import type { TransactionCategory, TransactionType } from './transaction'
import { appendParams } from '@/lib/searchParams'

export interface TransactionFilters {
  text?: string
  amount_from?: number
  amount_to?: number
  date_from?: string // ISO yyyy-mm-dd
  date_to?: string
  transaction_types?: TransactionType[]
  categories?: TransactionCategory[]
  linked?: 'linked' | 'unlinked'
}

/**
 * Drop empty strings + undefined; the backend treats "field missing" as "no
 * filter", so we deliberately don't send falsy garbage. Numeric zero stays
 * — `amount_from=0` means "everything with non-negative amount".
 */
export function buildFilterQueryString(accountIds: number[], filters: TransactionFilters): string {
  const params = new URLSearchParams()
  for (const accountId of accountIds) {
    params.append('account_ids', String(accountId))
  }
  appendParams(params, { ...filters })
  return params.toString()
}

export const transactionSearchQueryKeys = {
  search: (accountIds: number[], filters: TransactionFilters) =>
    ['transactions', 'search', [...accountIds].sort((a, b) => a - b), filters] as const,
}

export function useSearchTransactions(accountIds: number[], filters: TransactionFilters) {
  const queryString = buildFilterQueryString(accountIds, filters)
  return useQuery({
    queryKey: transactionSearchQueryKeys.search(accountIds, filters),
    queryFn: () => api<TransactionRead[]>(`/transactions/search?${queryString}`),
    // Don't fire when nothing is selected — the backend would 422 anyway.
    enabled: accountIds.length > 0,
    // Keep results stable while the user reads them; refetch only when the
    // filter dict changes (which produces a new query key).
    staleTime: 30_000,
  })
}
