import { describe, expect, it } from 'vitest'

import {
  accountHistoryQuery,
  findAccountInUser,
  groupTransactionsByDate,
  type AccountHistoryPage,
  type TransactionRead,
} from '@/lib/accountHistory'
import type { UserRead } from '@/lib/auth'
import {
  ACCOUNT_NAME_BROKER,
  ACCOUNT_NAME_DAY,
  AMOUNT_L,
  AMOUNT_M,
  AMOUNT_S,
  AMOUNT_XL,
  DATETIME_UPDATED,
  DATE_MID_MONTH,
  DATE_TODAY,
  DATE_YESTERDAY,
  SHARE_OWNER_NAME,
} from '@/test/constants'
import { buildUser } from '@/test/helpers'
import { buildAccount, buildCredential } from '@/test/statsFixtures'

function makeUser(): UserRead {
  return buildUser({
    credentials: [
      buildCredential(
        [
          buildAccount({ id: 1, name: 'Giro', balance: AMOUNT_L }),
          buildAccount({ id: 2, name: ACCOUNT_NAME_DAY, balance: AMOUNT_XL }),
        ],
        { id: 100, last_successful_sync_timestamp: DATETIME_UPDATED },
      ),
      buildCredential([buildAccount({ id: 3, name: ACCOUNT_NAME_BROKER, balance: AMOUNT_M })], {
        id: 101,
        bank: 'trade_republic',
      }),
    ],
  })
}

describe('findAccountInUser', () => {
  it('returns null when the user is undefined', () => {
    expect(findAccountInUser(undefined, 1)).toBeNull()
  })

  it('returns null when no account matches', () => {
    expect(findAccountInUser(makeUser(), 999)).toBeNull()
  })

  it('finds an account and reports its bank', () => {
    const result = findAccountInUser(makeUser(), 2)
    expect(result?.account.name).toBe(ACCOUNT_NAME_DAY)
    expect(result?.bank).toBe('ing')
  })

  it("surfaces the owning credential's last sync timestamp", () => {
    expect(findAccountInUser(makeUser(), 2)?.lastFetchingTimestamp).toBe(DATETIME_UPDATED)
    expect(findAccountInUser(makeUser(), 3)?.lastFetchingTimestamp).toBeNull()
  })

  it('treats a share without an explicit permission as read-only', () => {
    const user = makeUser()
    user.credentials[1].shared_from = SHARE_OWNER_NAME
    expect(findAccountInUser(user, 3)?.sharePermission).toBe('read')
    expect(findAccountInUser(user, 1)?.sharePermission).toBeNull()
  })

  it('finds accounts that live under a different credential', () => {
    const result = findAccountInUser(makeUser(), 3)
    expect(result?.account.name).toBe(ACCOUNT_NAME_BROKER)
    expect(result?.bank).toBe('trade_republic')
  })
})

function makeTransaction(overrides: Partial<TransactionRead>): TransactionRead {
  return {
    id: 1,
    account_id: 1,
    amount: 0,
    purpose: null,
    date: DATE_TODAY,
    other_party: null,
    transaction_type: null,
    category: 'UNKNOWN',
    note: null,
    ...overrides,
  }
}

function makePage(overrides: Partial<AccountHistoryPage>): AccountHistoryPage {
  return {
    transactions: [],
    balance_at_date: {},
    page: 1,
    page_size: 30,
    total_days: 0,
    ...overrides,
  }
}

describe('groupTransactionsByDate', () => {
  it('groups transactions on the same day into one bucket', () => {
    const groups = groupTransactionsByDate([
      makePage({
        transactions: [
          makeTransaction({ id: 1, date: DATE_TODAY, amount: -AMOUNT_S }),
          makeTransaction({ id: 2, date: DATE_TODAY, amount: -AMOUNT_M }),
          makeTransaction({ id: 3, date: DATE_YESTERDAY, amount: AMOUNT_L }),
        ],
        balance_at_date: { [DATE_TODAY]: 980, [DATE_YESTERDAY]: 1000 },
      }),
    ])
    expect(groups.map((g) => g.date)).toEqual([DATE_TODAY, DATE_YESTERDAY])
    expect(groups[0].transactions.map((t) => t.id)).toEqual([1, 2])
    expect(groups[0].endOfDayBalance).toBe(980)
    expect(groups[1].endOfDayBalance).toBe(1000)
  })

  it('orders groups by date desc regardless of page arrival order', () => {
    // Simulate page 2 (older) arriving second after page 1 (newer).
    const groups = groupTransactionsByDate([
      makePage({
        transactions: [makeTransaction({ id: 1, date: DATE_TODAY })],
        balance_at_date: { [DATE_TODAY]: 100 },
      }),
      makePage({
        transactions: [makeTransaction({ id: 2, date: DATE_MID_MONTH })],
        balance_at_date: { [DATE_MID_MONTH]: 50 },
      }),
    ])
    expect(groups.map((g) => g.date)).toEqual([DATE_TODAY, DATE_MID_MONTH])
  })

  it('leaves endOfDayBalance null when the backend has no snapshot for that day', () => {
    const groups = groupTransactionsByDate([
      makePage({
        transactions: [makeTransaction({ id: 1, date: DATE_TODAY })],
        balance_at_date: {},
      }),
    ])
    expect(groups[0].endOfDayBalance).toBeNull()
  })

  it('adds pending transactions to the balance from their day on', () => {
    const groups = groupTransactionsByDate([
      makePage({
        transactions: [
          makeTransaction({ id: 1, date: DATE_TODAY, amount: -AMOUNT_S, pending: true }),
          makeTransaction({ id: 2, date: DATE_YESTERDAY, amount: -AMOUNT_M, pending: true }),
          makeTransaction({ id: 3, date: DATE_YESTERDAY, amount: AMOUNT_L }),
          makeTransaction({ id: 4, date: DATE_MID_MONTH, amount: AMOUNT_L }),
        ],
        balance_at_date: { [DATE_YESTERDAY]: 1000, [DATE_MID_MONTH]: 500 },
      }),
    ])
    expect(groups.map((g) => g.endOfDayBalance)).toEqual([
      1000 - AMOUNT_M - AMOUNT_S,
      1000 - AMOUNT_M,
      500,
    ])
  })

  it('returns an empty list when there are no pages', () => {
    expect(groupTransactionsByDate([])).toEqual([])
  })
})

describe('accountHistoryQuery', () => {
  const nextPage = (page: Partial<AccountHistoryPage>) =>
    accountHistoryQuery(1).getNextPageParam!(makePage(page), [], 1, [])

  it('asks for the next page while more days remain', () => {
    expect(nextPage({ page: 1, page_size: 30, total_days: 31 })).toBe(2)
  })

  it('stops after the last page', () => {
    expect(nextPage({ page: 2, page_size: 30, total_days: 31 })).toBeUndefined()
  })

  it('treats an account without history as a single page', () => {
    expect(nextPage({ page: 1, page_size: 30, total_days: 0 })).toBeUndefined()
  })
})
