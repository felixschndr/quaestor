import { describe, expect, it } from 'vitest'

import {
  findAccountInUser,
  groupTransactionsByDate,
  type AccountHistoryPage,
  type TransactionRead,
} from '@/lib/accountHistory'
import type { UserRead } from '@/lib/auth'

function makeUser(): UserRead {
  return {
    id: 1,
    user_name: 'alice',
    display_name: 'Alice',
    language: 'en',
    theme: 'SYSTEM',
    two_factor_enabled: false,
    balance: 0,
    credentials: [
      {
        id: 100,
        bank: 'ing',
        bank_name: null,
        bank_icon: null,
        accounts: [
          {
            id: 1,
            name: 'Giro',
            display_name: null,
            balance: 500,
            balance_factor: 100,
            is_hidden: false,
          },
          {
            id: 2,
            name: 'Tagesgeld',
            display_name: null,
            balance: 1000,
            balance_factor: 100,
            is_hidden: false,
          },
        ],
        last_fetching_timestamp: '2026-06-15T08:30:00Z',
        requires_two_factor_authentication: false,
        sync_enabled: true,
      },
      {
        id: 101,
        bank: 'trade_republic',
        bank_name: null,
        bank_icon: null,
        accounts: [
          {
            id: 3,
            name: 'TR Cash',
            display_name: null,
            balance: 50,
            balance_factor: 100,
            is_hidden: false,
          },
        ],
        last_fetching_timestamp: null,
        requires_two_factor_authentication: false,
        sync_enabled: true,
      },
    ],
  }
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
    expect(result?.account.name).toBe('Tagesgeld')
    expect(result?.bank).toBe('ing')
  })

  it("surfaces the owning credential's last sync timestamp", () => {
    expect(findAccountInUser(makeUser(), 2)?.lastFetchingTimestamp).toBe('2026-06-15T08:30:00Z')
    expect(findAccountInUser(makeUser(), 3)?.lastFetchingTimestamp).toBeNull()
  })

  it('finds accounts that live under a different credential', () => {
    const result = findAccountInUser(makeUser(), 3)
    expect(result?.account.name).toBe('TR Cash')
    expect(result?.bank).toBe('trade_republic')
  })
})

function makeTransaction(overrides: Partial<TransactionRead>): TransactionRead {
  return {
    id: 1,
    account_id: 1,
    amount: 0,
    purpose: null,
    date: '2026-05-22',
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
          makeTransaction({ id: 1, date: '2026-05-22', amount: -10 }),
          makeTransaction({ id: 2, date: '2026-05-22', amount: -20 }),
          makeTransaction({ id: 3, date: '2026-05-21', amount: 100 }),
        ],
        balance_at_date: { '2026-05-22': 980, '2026-05-21': 1000 },
      }),
    ])
    expect(groups.map((g) => g.date)).toEqual(['2026-05-22', '2026-05-21'])
    expect(groups[0].transactions.map((t) => t.id)).toEqual([1, 2])
    expect(groups[0].endOfDayBalance).toBe(980)
    expect(groups[1].endOfDayBalance).toBe(1000)
  })

  it('orders groups by date desc regardless of page arrival order', () => {
    // Simulate page 2 (older) arriving second after page 1 (newer).
    const groups = groupTransactionsByDate([
      makePage({
        transactions: [makeTransaction({ id: 1, date: '2026-05-22' })],
        balance_at_date: { '2026-05-22': 100 },
      }),
      makePage({
        transactions: [makeTransaction({ id: 2, date: '2026-05-15' })],
        balance_at_date: { '2026-05-15': 50 },
      }),
    ])
    expect(groups.map((g) => g.date)).toEqual(['2026-05-22', '2026-05-15'])
  })

  it('leaves endOfDayBalance null when the backend has no snapshot for that day', () => {
    const groups = groupTransactionsByDate([
      makePage({
        transactions: [makeTransaction({ id: 1, date: '2026-05-22' })],
        balance_at_date: {},
      }),
    ])
    expect(groups[0].endOfDayBalance).toBeNull()
  })

  it('returns an empty list when there are no pages', () => {
    expect(groupTransactionsByDate([])).toEqual([])
  })
})
