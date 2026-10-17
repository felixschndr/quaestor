import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { accountQueryKeys, type TransactionRead } from '@/lib/accountHistory'
import { useTransactionById } from '@/lib/transaction'
import { DATE_OLDER } from '@/test/constants'

function renderOffline(seed: (queryClient: QueryClient) => void, transactionId: number) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  seed(queryClient)
  onlineManager.setOnline(false)
  globalThis.fetch = vi
    .fn()
    .mockRejectedValue(new TypeError('Failed to fetch')) as unknown as typeof fetch
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return renderHook(() => useTransactionById(transactionId), { wrapper })
}

describe('useTransactionById offline', () => {
  it('shows a transaction from a loaded account history although its page was never opened', async () => {
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

  it('does not mistake something else with the same id for the transaction', async () => {
    const { result } = renderOffline(
      (queryClient) => queryClient.setQueryData(['contracts'], [{ id: 7, name: 'Netflix' }]),
      7,
    )

    await waitFor(() => expect(result.current.isError || result.current.isPaused).toBe(true))
    expect(result.current.data).toBeUndefined()
  })
})
