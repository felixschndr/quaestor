import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from './api'
import { accountQueryKeys } from './accountHistory'
import { authQueryKeys } from './auth'
import type { TransactionCategory, TransactionType } from './transaction'

/** Mirrors `RecurrenceFrequency` in source/backend/models/recurrence_frequency.py. */
export const RECURRENCE_FREQUENCIES = ['MONTHLY', 'WEEKLY'] as const

export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number]

export interface RecurringTransactionRead {
  id: number
  account_id: number
  amount: number
  purpose: string | null
  other_party: string | null
  transaction_type: TransactionType | null
  category: TransactionCategory | null
  note: string | null
  frequency: RecurrenceFrequency
  day_of_month: number | null
  day_of_week: number | null // 0 = Monday … 6 = Sunday
  next_run_date: string // ISO yyyy-mm-dd
}

export interface RecurringTransactionCreatePayload {
  amount: number
  purpose?: string | null
  other_party?: string | null
  transaction_type?: TransactionType | null
  category?: TransactionCategory | null
  note?: string | null
  frequency: RecurrenceFrequency
  day_of_month?: number | null
  day_of_week?: number | null
  book_immediately: boolean
}

// Same shape as the create payload, minus the one-off "book today" flag.
export type RecurringTransactionUpdatePayload = Omit<
  RecurringTransactionCreatePayload,
  'book_immediately'
>

export const recurringQueryKeys = {
  list: (accountId: number) => ['account', accountId, 'recurring'] as const,
}

export function useRecurringTransactions(accountId: number) {
  return useQuery({
    queryKey: recurringQueryKeys.list(accountId),
    queryFn: () => api<RecurringTransactionRead[]>(`/account/${accountId}/recurring-transactions`),
  })
}

export function useCreateRecurringTransaction(accountId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: RecurringTransactionCreatePayload) =>
      api<RecurringTransactionRead>(`/account/${accountId}/recurring-transactions`, {
        method: 'POST',
        body: payload,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: recurringQueryKeys.list(accountId) })
      // book_immediately appends a transaction and shifts the balance.
      queryClient.invalidateQueries({ queryKey: accountQueryKeys.history(accountId) })
      queryClient.invalidateQueries({ queryKey: authQueryKeys.me })
    },
  })
}

export function useUpdateRecurringTransaction(accountId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      recurringTransactionId,
      payload,
    }: {
      recurringTransactionId: number
      payload: RecurringTransactionUpdatePayload
    }) =>
      api<RecurringTransactionRead>(
        `/account/${accountId}/recurring-transactions/${recurringTransactionId}`,
        { method: 'PATCH', body: payload },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: recurringQueryKeys.list(accountId) })
    },
  })
}

export function useDeleteRecurringTransaction(accountId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (recurringTransactionId: number) =>
      api<void>(`/account/${accountId}/recurring-transactions/${recurringTransactionId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: recurringQueryKeys.list(accountId) })
    },
  })
}
