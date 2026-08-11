import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from './api'
import {
  accountQueryKeys,
  type TransactionDetailRead,
  type TransactionRead,
} from './accountHistory'
import { authQueryKeys } from './auth'
import { transactionSearchQueryKeys } from './transactionSearch'

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

import { TRANSACTION_CATEGORIES, type TransactionCategory } from './transactionCategories.gen'
export { TRANSACTION_CATEGORIES, type TransactionCategory }

export const transactionQueryKeys = {
  all: ['transaction'] as const,
  detail: (accountId: number, transactionId: number) =>
    ['account', accountId, 'transaction', transactionId] as const,
  byId: (transactionId: number) => ['transaction', transactionId] as const,
}

export function useTransaction(
  accountId: number,
  transactionId: number,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: transactionQueryKeys.detail(accountId, transactionId),
    queryFn: () =>
      api<TransactionDetailRead>(`/account/${accountId}/transactions/${transactionId}`),
    enabled: options?.enabled ?? true,
  })
}

export function useTransactionById(transactionId: number) {
  return useQuery({
    queryKey: transactionQueryKeys.byId(transactionId),
    queryFn: () => api<TransactionDetailRead>(`/transactions/${transactionId}`),
  })
}

export interface TransactionPatch {
  note?: string | null
  category?: TransactionCategory
  // Manual-account-only fields
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
      queryClient.setQueryData(transactionQueryKeys.byId(transactionId), updated)
      queryClient.invalidateQueries({ queryKey: accountQueryKeys.history(accountId) })
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
      queryClient.invalidateQueries({ queryKey: accountQueryKeys.all })
      queryClient.invalidateQueries({ queryKey: transactionSearchQueryKeys.all })
      queryClient.invalidateQueries({ queryKey: transactionQueryKeys.all })
      queryClient.invalidateQueries({ queryKey: authQueryKeys.me })
    },
  })
}

export function useUnlinkTransfer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ accountId, transactionId }: { accountId: number; transactionId: number }) =>
      api<void>(`/account/${accountId}/transactions/${transactionId}/transfer-link`, {
        method: 'DELETE',
      }),
    onSuccess: (_data, { accountId, transactionId }) => {
      queryClient.invalidateQueries({
        queryKey: transactionQueryKeys.detail(accountId, transactionId),
      })
      queryClient.invalidateQueries({ queryKey: transactionQueryKeys.all })
      queryClient.invalidateQueries({ queryKey: accountQueryKeys.all })
      queryClient.invalidateQueries({ queryKey: authQueryKeys.me })
    },
  })
}
