import { describe, expect, it } from 'vitest'

import type { TransactionRead } from '@/lib/accountHistory'
import { CATEGORIES_BY_GROUP } from '@/lib/transaction'
import {
  SORT_COMPARATORS,
  TRANSACTION_SORT_KEYS,
  transactionSearchParamsSchema,
} from '@/lib/transactionSearchParams'
import { AMOUNT_L, AMOUNT_M, AMOUNT_S, DATE_OLDER, DATE_TODAY } from '@/test/constants'

function buildTransaction(id: number, date: string, amount: number): TransactionRead {
  return {
    id,
    account_id: 1,
    amount,
    purpose: null,
    date,
    other_party: null,
    transaction_type: null,
    category: 'UNKNOWN',
    note: null,
  }
}

describe('SORT_COMPARATORS', () => {
  const older = buildTransaction(1, DATE_OLDER, -AMOUNT_L)
  const newer = buildTransaction(2, DATE_TODAY, AMOUNT_M)
  const sameDaySibling = buildTransaction(3, DATE_TODAY, -AMOUNT_S)
  const sameAmountSibling = buildTransaction(4, DATE_OLDER, AMOUNT_M)

  const sortedIds = (key: (typeof TRANSACTION_SORT_KEYS)[number], items: TransactionRead[]) =>
    [...items].sort(SORT_COMPARATORS[key]).map((transaction) => transaction.id)

  it.each([
    ['date_desc', [3, 2, 4, 1]],
    ['date_asc', [1, 4, 2, 3]],
    ['amount_desc', [4, 2, 3, 1]],
    ['amount_asc', [1, 3, 2, 4]],
    ['amount_abs_desc', [1, 4, 2, 3]],
    ['amount_abs_asc', [3, 2, 4, 1]],
  ] as const)('orders by %s, breaking ties by id in the same direction', (key, expected) => {
    expect(sortedIds(key, [older, newer, sameDaySibling, sameAmountSibling])).toEqual(expected)
  })

  it('has a comparator for every sort key', () => {
    expect(Object.keys(SORT_COMPARATORS).sort()).toEqual([...TRANSACTION_SORT_KEYS].sort())
  })
})

describe('transactionSearchParamsSchema', () => {
  it('coerces numbers and wraps single values from the URL into lists', () => {
    expect(
      transactionSearchParamsSchema.parse({
        amount_from: String(-AMOUNT_L),
        amount_to: String(AMOUNT_M),
        account_ids: '7',
        transaction_types: 'OUTGOING',
        link_account_id: '42',
        link_transaction_id: '99',
      }),
    ).toEqual({
      amount_from: -AMOUNT_L,
      amount_to: AMOUNT_M,
      account_ids: [7],
      transaction_types: ['OUTGOING'],
      link_account_id: 42,
      link_transaction_id: 99,
    })
  })

  it('expands a category group and drops retired category keys', () => {
    const { categories } = transactionSearchParamsSchema.parse({
      categories: ['INCOME', 'SUPERMARKET', 'NO_LONGER_A_CATEGORY', 'CUSTOM_7'],
    })
    expect(categories).toEqual([...CATEGORIES_BY_GROUP.INCOME, 'SUPERMARKET', 'CUSTOM_7'])
  })

  it.each([
    ['sort', { sort: 'random' }],
    ['linked', { linked: 'sometimes' }],
    ['has_attachment', { has_attachment: 'maybe' }],
    ['transaction_types', { transaction_types: ['NOT_A_TYPE'] }],
  ])('rejects an unknown %s value', (_field, search) => {
    expect(transactionSearchParamsSchema.safeParse(search).success).toBe(false)
  })
})
