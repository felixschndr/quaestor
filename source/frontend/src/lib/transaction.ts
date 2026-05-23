import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from './api'
import { accountQueryKeys, type TransactionRead } from './accountHistory'

/**
 * Mirrors `TransactionType` in source/backend/models/transaction_type.py.
 * UNKNOWN sits last so the search-form dropdown doesn't have it as the
 * accidental first pick.
 */
export const TRANSACTION_TYPES = [
  'INCOMING',
  'OUTGOING',
  'BUY',
  'SELL',
  'DEPOSIT',
  'REMOVAL',
  'DIVIDEND',
  'INTEREST',
  'INTEREST_CHARGE',
  'TAXES',
  'TAX_REFUND',
  'FEES',
  'FEES_REFUND',
  'SPINOFF',
  'SPLIT',
  'SWAP',
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'UNKNOWN',
] as const

export type TransactionType = (typeof TRANSACTION_TYPES)[number]

/**
 * Mirrors `TransactionCategory` in source/backend/models/transaction_category.py.
 * Order here is the order shown in the dropdown — by spec the list is the full
 * enum, with UNKNOWN last so it doesn't get accidentally chosen.
 */
export const TRANSACTION_CATEGORIES = [
  'SALARY',
  'ALLOWANCE',
  'PENSION',
  'REIMBURSEMENT',
  'INTEREST',
  'INVESTMENT',
  'SUBSCRIPTIONS',
  'RENT',
  'UTILITIES',
  'CAR',
  'FUEL',
  'FITNESS',
  'ONLINE_SHOPPING',
  'SUPERMARKET',
  'DRUGSTORE',
  'RESTAURANTS',
  'PERSONAL_CARE',
  'CLOTHING',
  'GIFTS',
  'ENTERTAINMENT',
  'FEES',
  'SAVINGS',
  'WITHDRAWAL',
  'TRANSFER',
  'UNKNOWN',
] as const

export type TransactionCategory = (typeof TRANSACTION_CATEGORIES)[number]

export const transactionQueryKeys = {
  detail: (accountId: number, transactionId: number) =>
    ['account', accountId, 'transaction', transactionId] as const,
}

export function useTransaction(accountId: number, transactionId: number) {
  return useQuery({
    queryKey: transactionQueryKeys.detail(accountId, transactionId),
    queryFn: () => api<TransactionRead>(`/account/${accountId}/transactions/${transactionId}`),
  })
}

export interface TransactionPatch {
  note?: string | null
  category?: TransactionCategory
}

export function useUpdateTransaction(accountId: number, transactionId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: TransactionPatch) =>
      api<TransactionRead>(`/account/${accountId}/transactions/${transactionId}`, {
        method: 'PATCH',
        body: payload,
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(transactionQueryKeys.detail(accountId, transactionId), updated)
      // The account-history pages embed the transaction (other_party, amount,
      // note, category). Invalidate so the next visit re-pulls the row with
      // the new value — cheap because react-query only refetches what's mounted.
      queryClient.invalidateQueries({ queryKey: accountQueryKeys.history(accountId) })
    },
  })
}
