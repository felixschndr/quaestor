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

// Imported (not just re-exported) so the type is in local scope for the payloads below.
import { TRANSACTION_CATEGORIES, type TransactionCategory } from './transactionCategories.gen'
export { TRANSACTION_CATEGORIES, type TransactionCategory }

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
      api<TransactionDetailRead>(`/account/${accountId}/transactions/${transactionId}`, {
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

export interface TransferLinkPayload {
  counterpartAccountId: number
  counterpartTransactionId: number
}

export function useLinkTransfer(accountId: number, transactionId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ counterpartAccountId, counterpartTransactionId }: TransferLinkPayload) =>
      api<TransactionDetailRead>(
        `/account/${accountId}/transactions/${transactionId}/transfer-link`,
        {
          method: 'PUT',
          body: {
            counterpart_account_id: counterpartAccountId,
            counterpart_transaction_id: counterpartTransactionId,
          },
        },
      ),
    onSuccess: () => {
      // Both legs change type + counterpart; their details and histories all
      // live under the 'account' prefix. Search results embed the linked
      // state too, so refresh those as well.
      queryClient.invalidateQueries({ queryKey: ['account'] })
      queryClient.invalidateQueries({ queryKey: ['transactions', 'search'] })
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
