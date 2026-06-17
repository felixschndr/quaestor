import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from './api'
import {
  accountQueryKeys,
  type TransactionDetailRead,
  type TransactionRead,
} from './accountHistory'
import { authQueryKeys } from './auth'

/**
 * Mirrors `TransactionType` in source/backend/models/transaction_type.py.
 * ZERO (amount == 0 / Nullgeschäft) sits last so the search-form dropdown
 * doesn't have it as the accidental first pick.
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
  'ZERO',
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
  'SIDE_INCOME',
  'REIMBURSEMENT',
  'INTEREST',
  'INVESTMENT',
  'SUBSCRIPTIONS',
  'RENT',
  'UTILITIES',
  'TRAVEL',
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
  'DEPOSIT',
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
    queryFn: () =>
      api<TransactionDetailRead>(`/account/${accountId}/transactions/${transactionId}`),
  })
}

export interface TransactionPatch {
  note?: string | null
  category?: TransactionCategory
  // Manual-account-only fields. The backend rejects (403) if sent for synced
  // accounts.
  amount?: number
  date?: string // ISO yyyy-mm-dd
  purpose?: string | null
  other_party?: string | null
  transaction_type?: TransactionType | null
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
      // Editing the amount of a manual txn shifts account.balance on the
      // server (which lives in the `me` query); refresh so headlines update.
      queryClient.invalidateQueries({ queryKey: authQueryKeys.me })
    },
  })
}

export interface TransactionCreatePayload {
  amount: number
  date: string // ISO yyyy-mm-dd
  purpose?: string | null
  other_party?: string | null
  transaction_type?: TransactionType | null
  category?: TransactionCategory | null
  note?: string | null
}

export function useCreateTransaction(accountId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: TransactionCreatePayload) =>
      api<TransactionRead>(`/account/${accountId}/transactions`, {
        method: 'POST',
        body: payload,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: accountQueryKeys.history(accountId) })
      queryClient.invalidateQueries({ queryKey: authQueryKeys.me })
    },
  })
}

export function useDeleteTransaction(accountId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (transactionId: number) =>
      api<void>(`/account/${accountId}/transactions/${transactionId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: accountQueryKeys.history(accountId) })
      queryClient.invalidateQueries({ queryKey: authQueryKeys.me })
    },
  })
}

export function useUnlinkTransfer(accountId: number, transactionId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      api<void>(`/account/${accountId}/transactions/${transactionId}/transfer-link`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      // Reload the detail (counterpart disappears) and invalidate both affected
      // accounts' histories — the type changes on both legs. The counterpart's
      // account id isn't known here, so invalidate the whole 'account' prefix.
      queryClient.invalidateQueries({
        queryKey: transactionQueryKeys.detail(accountId, transactionId),
      })
      queryClient.invalidateQueries({ queryKey: ['account'] })
      queryClient.invalidateQueries({ queryKey: authQueryKeys.me })
    },
  })
}
