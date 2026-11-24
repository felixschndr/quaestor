import { useMutation, useQueryClient } from '@tanstack/react-query'

import { api } from './api'
import { accountQueryKeys } from './accountHistory'
import { authQueryKeys } from './auth'
import { contractQueryKeys } from './contract'
import { transactionQueryKeys, type CategoryKey, type TransactionType } from './transaction'
import { transactionSearchQueryKeys } from './transactionSearch'

export interface TransactionBulkPatch {
  category?: CategoryKey | null
  note?: string | null
  transaction_type?: TransactionType
  contract_id?: number | null
}

export function useBulkUpdateTransactions() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      transactionIds,
      patch,
    }: {
      transactionIds: number[]
      patch: TransactionBulkPatch
    }) =>
      api<void>('/transactions/bulk', {
        method: 'PATCH',
        body: { transaction_ids: transactionIds, ...patch },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: transactionSearchQueryKeys.all })
      queryClient.invalidateQueries({ queryKey: transactionQueryKeys.all })
      queryClient.invalidateQueries({ queryKey: accountQueryKeys.all })
      queryClient.invalidateQueries({ queryKey: contractQueryKeys.list })
      queryClient.invalidateQueries({ queryKey: authQueryKeys.me })
    },
  })
}
