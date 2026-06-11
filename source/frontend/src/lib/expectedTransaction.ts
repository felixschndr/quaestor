import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from './api'

export const MATCH_TOLERANCES = [0, 5, 10, 15, 20] as const

export type MatchTolerance = (typeof MATCH_TOLERANCES)[number]

export const DEFAULT_MATCH_TOLERANCE: MatchTolerance = 10

export interface ExpectedTransactionRead {
  id: number
  account_id: number
  amount: number
  other_party: string | null
  note: string | null
  match_tolerance_percent: number | null
}

export interface ExpectedTransactionCreatePayload {
  amount: number
  other_party?: string | null
  note?: string | null
  match_tolerance_percent: number
}

export const expectedQueryKeys = {
  list: (accountId: number) => ['account', accountId, 'expected'] as const,
}

export function useExpectedTransactions(accountId: number) {
  return useQuery({
    queryKey: expectedQueryKeys.list(accountId),
    queryFn: () => api<ExpectedTransactionRead[]>(`/account/${accountId}/expected-transactions`),
  })
}

export function useCreateExpectedTransaction(accountId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: ExpectedTransactionCreatePayload) =>
      api<ExpectedTransactionRead>(`/account/${accountId}/expected-transactions`, {
        method: 'POST',
        body: payload,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: expectedQueryKeys.list(accountId) })
    },
  })
}

export function useUpdateExpectedTransaction(accountId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      expectedTransactionId,
      payload,
    }: {
      expectedTransactionId: number
      payload: ExpectedTransactionCreatePayload
    }) =>
      api<ExpectedTransactionRead>(
        `/account/${accountId}/expected-transactions/${expectedTransactionId}`,
        {
          method: 'PATCH',
          body: payload,
        },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: expectedQueryKeys.list(accountId) })
    },
  })
}

export function useDeleteExpectedTransaction(accountId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (expectedTransactionId: number) =>
      api<void>(`/account/${accountId}/expected-transactions/${expectedTransactionId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: expectedQueryKeys.list(accountId) })
    },
  })
}
