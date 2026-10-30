import { QueryClient } from '@tanstack/react-query'
import { act, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { accountQueryKeys } from '@/lib/accountHistory'
import { authQueryKeys } from '@/lib/auth'
import {
  recurringQueryKeys,
  useCreateRecurringTransaction,
  useDeleteRecurringTransaction,
  useRecurringTransactions,
  useUpdateRecurringTransaction,
  type RecurringTransactionRead,
  type RecurringTransactionUpdatePayload,
} from '@/lib/recurringTransaction'
import { AMOUNT_M, DATE_NEXT_RUN } from '@/test/constants'
import { jsonResponse, renderHookWithClient } from '@/test/helpers'

const ACCOUNT_ID = 7

const rule: RecurringTransactionRead = {
  id: 3,
  account_id: ACCOUNT_ID,
  amount: -AMOUNT_M,
  purpose: null,
  other_party: null,
  transaction_type: null,
  category: null,
  note: null,
  frequency: 'MONTHLY',
  day_of_month: 15,
  day_of_week: null,
  next_run_date: DATE_NEXT_RUN,
}

const payload: RecurringTransactionUpdatePayload = {
  amount: -AMOUNT_M,
  frequency: 'MONTHLY',
  day_of_month: 15,
}

function stubFetch(body: unknown = rule) {
  const fetchMock = vi.fn(async () => jsonResponse({ status: 200, body }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function clientWith(...keys: (readonly unknown[])[]) {
  const client = new QueryClient()
  for (const key of keys) client.setQueryData(key, {})
  return client
}

const invalidated = (client: QueryClient, key: readonly unknown[]) =>
  client.getQueryState(key)?.isInvalidated

describe('useRecurringTransactions', () => {
  it("loads the account's recurring rules", async () => {
    const fetchMock = stubFetch([rule])

    const { result } = renderHookWithClient(() => useRecurringTransactions(ACCOUNT_ID))

    await waitFor(() => expect(result.current.data).toEqual([rule]))
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/account/${ACCOUNT_ID}/recurring-transactions`,
      expect.objectContaining({ method: 'GET' }),
    )
  })
})

describe('recurring transaction mutations', () => {
  it('creating a rule also refreshes the history and balance, since it may book today', async () => {
    const fetchMock = stubFetch()
    const client = clientWith(
      recurringQueryKeys.list(ACCOUNT_ID),
      accountQueryKeys.history(ACCOUNT_ID),
      authQueryKeys.me,
    )
    const { result } = renderHookWithClient(() => useCreateRecurringTransaction(ACCOUNT_ID), client)

    await act(async () => {
      await result.current.mutateAsync({ ...payload, book_immediately: true })
    })

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/account/${ACCOUNT_ID}/recurring-transactions`,
      expect.objectContaining({ method: 'POST' }),
    )
    expect(invalidated(client, recurringQueryKeys.list(ACCOUNT_ID))).toBe(true)
    expect(invalidated(client, accountQueryKeys.history(ACCOUNT_ID))).toBe(true)
    expect(invalidated(client, authQueryKeys.me)).toBe(true)
  })

  it('updating a rule patches it and refreshes only the rule list', async () => {
    const fetchMock = stubFetch()
    const client = clientWith(recurringQueryKeys.list(ACCOUNT_ID), authQueryKeys.me)
    const { result } = renderHookWithClient(() => useUpdateRecurringTransaction(ACCOUNT_ID), client)

    await act(async () => {
      await result.current.mutateAsync({ recurringTransactionId: rule.id, payload })
    })

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/account/${ACCOUNT_ID}/recurring-transactions/${rule.id}`,
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify(payload) }),
    )
    expect(invalidated(client, recurringQueryKeys.list(ACCOUNT_ID))).toBe(true)
    expect(invalidated(client, authQueryKeys.me)).toBe(false)
  })

  it('deleting a rule removes it and refreshes the rule list', async () => {
    const fetchMock = stubFetch(null)
    const client = clientWith(recurringQueryKeys.list(ACCOUNT_ID))
    const { result } = renderHookWithClient(() => useDeleteRecurringTransaction(ACCOUNT_ID), client)

    await act(async () => {
      await result.current.mutateAsync(rule.id)
    })

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/account/${ACCOUNT_ID}/recurring-transactions/${rule.id}`,
      expect.objectContaining({ method: 'DELETE' }),
    )
    expect(invalidated(client, recurringQueryKeys.list(ACCOUNT_ID))).toBe(true)
  })
})
