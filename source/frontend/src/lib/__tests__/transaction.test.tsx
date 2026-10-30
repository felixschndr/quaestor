import { describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import { onlineManager, QueryClient } from '@tanstack/react-query'

import { accountQueryKeys, type TransactionRead } from '@/lib/accountHistory'
import {
  CATEGORIES_BY_GROUP,
  expandCategorySelection,
  isCategoryGroup,
  isCustomCategoryKey,
  useTransactionById,
} from '@/lib/transaction'
import { transactionSearchQueryKeys } from '@/lib/transactionSearch'
import { DATE_OLDER } from '@/test/constants'
import { renderHookWithClient } from '@/test/helpers'

function renderOffline(seed: (queryClient: QueryClient) => void, transactionId: number) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  seed(queryClient)
  onlineManager.setOnline(false)
  globalThis.fetch = vi
    .fn()
    .mockRejectedValue(new TypeError('Failed to fetch')) as unknown as typeof fetch
  return renderHookWithClient(() => useTransactionById(transactionId), queryClient)
}

describe('useTransactionById offline', () => {
  const seen: TransactionRead = {
    id: 7,
    account_id: 3,
    amount: -12.5,
    purpose: null,
    date: DATE_OLDER,
    other_party: 'Rewe',
    transaction_type: 'OUTGOING',
    category: 'SUPERMARKET',
    note: null,
  }

  it('shows a transaction from a loaded account history although its page was never opened', async () => {
    const { result } = renderOffline(
      (queryClient) =>
        queryClient.setQueryData(accountQueryKeys.history(3), {
          pages: [
            { transactions: [seen], balance_at_date: {}, page: 1, page_size: 10, total_days: 1 },
          ],
          pageParams: [1],
        }),
      7,
    )

    await waitFor(() => expect(result.current.data).toEqual({ ...seen, related_transactions: [] }))
  })

  it('shows a transaction found in a cached search result', async () => {
    const { result } = renderOffline(
      (queryClient) =>
        queryClient.setQueryData([...transactionSearchQueryKeys.all, [3], {}], [seen]),
      7,
    )

    await waitFor(() => expect(result.current.data).toEqual({ ...seen, related_transactions: [] }))
  })

  it('does not mistake something else with the same id for the transaction', async () => {
    const { result } = renderOffline((queryClient) => {
      queryClient.setQueryData(['contracts'], [{ id: 7, name: 'Netflix' }])
      queryClient.setQueryData(['statistics', 'broken'], { transactions: { id: 7 } })
    }, 7)

    await waitFor(() => expect(result.current.isError || result.current.isPaused).toBe(true))
    expect(result.current.data).toBeUndefined()
  })
})

describe('category keys', () => {
  it('tells custom category keys from built-in ones', () => {
    expect(isCustomCategoryKey('CUSTOM_3')).toBe(true)
    expect(isCustomCategoryKey('SUPERMARKET')).toBe(false)
  })

  it('tells category groups from categories', () => {
    expect(isCategoryGroup('INCOME')).toBe(true)
    expect(isCategoryGroup('SALARY')).toBe(false)
  })
})

describe('expandCategorySelection', () => {
  it('expands a group into its categories, including custom ones of that group', () => {
    expect(
      expandCategorySelection(
        ['INCOME'],
        [
          { key: 'CUSTOM_1', group: 'INCOME' },
          { key: 'CUSTOM_2', group: 'HOUSING' },
        ],
      ),
    ).toEqual([...CATEGORIES_BY_GROUP.INCOME, 'CUSTOM_1'])
  })

  it('keeps known and custom categories once each and drops unknown keys', () => {
    expect(
      expandCategorySelection(['SALARY', 'INCOME', 'CUSTOM_9', 'RETIRED_CATEGORY', 'SALARY']),
    ).toEqual([...CATEGORIES_BY_GROUP.INCOME, 'CUSTOM_9'])
  })
})
