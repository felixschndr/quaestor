import { useInfiniteQuery } from '@tanstack/react-query'

import { api } from './api'
import type { AccountRead, UserRead } from './auth'

export interface TransactionRead {
  id: number
  account_id: number
  amount: number
  purpose: string | null
  date: string // ISO yyyy-mm-dd
  other_party: string | null
  transaction_type: string | null
  category: string
  note: string | null
  // Backend always returns this; kept optional so existing test fixtures
  // (search/history tests) keep type-checking without changes.
  transfer_counterpart_id?: number | null
}

export interface TransactionDetailRead extends TransactionRead {
  transfer_counterpart: TransactionRead | null
}

export interface AccountHistoryPage {
  transactions: TransactionRead[]
  // Backend serializes the dict keys as ISO yyyy-mm-dd strings.
  balance_at_date: Record<string, number>
  page: number
  page_size: number
  total_days: number
}

export interface AccountWithBank {
  account: AccountRead
  bank: string
  credentialId: number
}

export const accountQueryKeys = {
  history: (accountId: number) => ['account', accountId, 'history'] as const,
}

export function findAccountInUser(
  user: UserRead | undefined,
  accountId: number,
): AccountWithBank | null {
  if (!user) return null
  for (const credential of user.credentials) {
    for (const account of credential.accounts) {
      if (account.id === accountId) {
        return { account, bank: credential.bank, credentialId: credential.id }
      }
    }
  }
  return null
}

interface AccountHistoryGroup {
  date: string // ISO yyyy-mm-dd
  endOfDayBalance: number | null
  transactions: TransactionRead[]
}

/**
 * Bucket the flat transaction list into one group per day (already sorted
 * most-recent-first by the backend). The end-of-day balance for each group is
 * looked up in `balance_at_date`; if the backend has no snapshot for a date
 * (rare but possible on the very first day of an account), the field stays
 * null and the UI omits the number.
 */
export function groupTransactionsByDate(pages: AccountHistoryPage[]): AccountHistoryGroup[] {
  const groups = new Map<string, AccountHistoryGroup>()
  const balanceByDate = new Map<string, number>()
  for (const page of pages) {
    for (const [date, balance] of Object.entries(page.balance_at_date)) {
      balanceByDate.set(date, balance)
    }
    for (const transaction of page.transactions) {
      let group = groups.get(transaction.date)
      if (!group) {
        group = {
          date: transaction.date,
          endOfDayBalance: balanceByDate.get(transaction.date) ?? null,
          transactions: [],
        }
        groups.set(transaction.date, group)
      }
      group.transactions.push(transaction)
    }
  }
  // The backend already returns transactions in date-desc order, but pages
  // arrive over time and a single group may straddle two fetched pages — sort
  // by date desc to keep the rendered order stable regardless of page arrival.
  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      endOfDayBalance: balanceByDate.get(group.date) ?? group.endOfDayBalance,
    }))
    .sort((a, b) => b.date.localeCompare(a.date))
}

const DEFAULT_PAGE_SIZE = 30

export function useAccountHistory(accountId: number) {
  return useInfiniteQuery({
    queryKey: accountQueryKeys.history(accountId),
    queryFn: ({ pageParam }) =>
      api<AccountHistoryPage>(
        `/account/${accountId}/history?page=${pageParam}&page_size=${DEFAULT_PAGE_SIZE}`,
      ),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      const totalPages = Math.max(1, Math.ceil(lastPage.total_days / lastPage.page_size))
      if (lastPage.page >= totalPages) return undefined
      return lastPage.page + 1
    },
  })
}
