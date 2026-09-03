import { useInfiniteQuery } from '@tanstack/react-query'

import { api } from './api'
import type { AccountRead, SharePermission, UserRead } from './auth'

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
  pending?: boolean
  contract_id?: number | null
  refund_status?: RefundStatus | null
}

export type RefundStatus = 'refunded' | 'partially_refunded' | 'refund'

export interface TransactionDetailRead extends TransactionRead {
  flow_members: TransactionRead[]
}

export interface AccountHistoryPage {
  transactions: TransactionRead[]
  balance_at_date: Record<string, number>
  page: number
  page_size: number
  total_days: number
}

export interface FoundAccount {
  account: AccountRead
  bank: string
  bankName: string | null
  bankIcon: string | null
  credentialId: number
  lastFetchingTimestamp: string | null
  syncEnabled: boolean
  sharePermission: SharePermission | null
  requiresTwoFactor: boolean
}

export const accountQueryKeys = {
  all: ['account'] as const,
  history: (accountId: number) => ['account', accountId, 'history'] as const,
}

export function findAccountInUser(
  user: UserRead | undefined,
  accountId: number,
): FoundAccount | null {
  if (!user) return null
  for (const credential of user.credentials) {
    for (const account of credential.accounts) {
      if (account.id === accountId) {
        return {
          account,
          bank: credential.bank,
          bankName: credential.bank_name,
          bankIcon: credential.bank_icon,
          credentialId: credential.id,
          lastFetchingTimestamp: credential.last_fetching_timestamp,
          syncEnabled: credential.sync_enabled,
          sharePermission: credential.shared_from ? (credential.share_permission ?? 'read') : null,
          requiresTwoFactor: credential.requires_two_factor_authentication,
        }
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
  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      endOfDayBalance: balanceByDate.get(group.date) ?? group.endOfDayBalance,
    }))
    .sort((a, b) => b.date.localeCompare(a.date))
}

export function useAccountHistory(accountId: number) {
  return useInfiniteQuery({
    queryKey: accountQueryKeys.history(accountId),
    queryFn: ({ pageParam }) =>
      api<AccountHistoryPage>(`/account/${accountId}/history?page=${pageParam}`),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      const totalPages = Math.max(1, Math.ceil(lastPage.total_days / lastPage.page_size))
      if (lastPage.page >= totalPages) return undefined
      return lastPage.page + 1
    },
  })
}
