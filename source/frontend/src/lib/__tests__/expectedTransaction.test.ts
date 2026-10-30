import { QueryClient } from '@tanstack/react-query'
import { act, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import {
  expectedQueryKeys,
  useDeleteExpectedTransaction,
  useExpectedTransactions,
  type ExpectedTransactionRead,
} from '@/lib/expectedTransaction'
import { AMOUNT_M, PARTY_SUPERMARKET } from '@/test/constants'
import { jsonResponse, renderHookWithClient } from '@/test/helpers'

const ACCOUNT_ID = 7

const expected: ExpectedTransactionRead = {
  id: 3,
  account_id: ACCOUNT_ID,
  amount: -AMOUNT_M,
  other_party: PARTY_SUPERMARKET,
  note: null,
  match_tolerance_percent: 0,
}

describe('useExpectedTransactions', () => {
  it("loads the account's expected transactions", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ status: 200, body: [expected] }))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHookWithClient(() => useExpectedTransactions(ACCOUNT_ID))

    await waitFor(() => expect(result.current.data).toEqual([expected]))
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/account/${ACCOUNT_ID}/expected-transactions`,
      expect.objectContaining({ method: 'GET' }),
    )
  })
})

describe('useDeleteExpectedTransaction', () => {
  it('deletes one expectation and refreshes the account list', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new QueryClient()
    client.setQueryData(expectedQueryKeys.list(ACCOUNT_ID), [expected])
    const { result } = renderHookWithClient(() => useDeleteExpectedTransaction(ACCOUNT_ID), client)

    await act(async () => {
      await result.current.mutateAsync(expected.id)
    })

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/account/${ACCOUNT_ID}/expected-transactions/${expected.id}`,
      expect.objectContaining({ method: 'DELETE' }),
    )
    expect(client.getQueryState(expectedQueryKeys.list(ACCOUNT_ID))?.isInvalidated).toBe(true)
  })
})
