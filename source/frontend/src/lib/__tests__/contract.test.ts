import { describe, expect, it } from 'vitest'

import {
  contractAmountForPeriod,
  filterContracts,
  hasActiveContractFilters,
  monthsOverdue,
  overdueDuration,
  sumContractsForPeriod,
  type ContractRead,
} from '@/lib/contract'

function makeContract(overrides: Partial<ContractRead> = {}): ContractRead {
  return {
    id: 1,
    account_id: 10,
    name: 'Test',
    note: null,
    category: null,
    source: 'DETECTED',
    median_amount: -30,
    frequency: 'MONTHLY',
    expected_next_date: null,
    is_archived: false,
    is_overdue: false,
    amount_per_day: null,
    amount_per_frequency: null,
    ...overrides,
  }
}

const netflix = makeContract({
  id: 1,
  account_id: 10,
  category: 'SUBSCRIPTIONS',
  median_amount: -12.99,
  frequency: 'MONTHLY',
})
const salary = makeContract({
  id: 2,
  account_id: 20,
  category: 'SALARY',
  median_amount: 4200,
  frequency: 'MONTHLY',
})
const rent = makeContract({
  id: 3,
  account_id: 10,
  category: 'RENT',
  median_amount: -900,
  frequency: 'MONTHLY',
})
const insurance = makeContract({
  id: 4,
  account_id: 20,
  category: null,
  median_amount: -50,
  frequency: 'YEARLY',
})
const irregular = makeContract({
  id: 5,
  account_id: 10,
  category: null,
  median_amount: -25,
  frequency: null,
})
const all = [netflix, salary, rent, insurance, irregular]

const ids = (contracts: ContractRead[]) => contracts.map((contract) => contract.id)

describe('filterContracts', () => {
  it('returns everything when no facet is active', () => {
    expect(ids(filterContracts(all, {}))).toEqual([1, 2, 3, 4, 5])
  })

  it('filters by name, case-insensitively', () => {
    const named = [
      makeContract({ id: 7, name: 'Netflix' }),
      makeContract({ id: 8, name: 'Spotify' }),
    ]
    expect(ids(filterContracts(named, { text: ' netflix ' }))).toEqual([7])
  })

  it('filters by account', () => {
    expect(ids(filterContracts(all, { account_ids: [10] }))).toEqual([1, 3, 5])
  })

  it('treats a present-but-empty facet as "none selected" (matches nothing)', () => {
    expect(ids(filterContracts(all, { account_ids: [] }))).toEqual([])
  })

  it('treats an absent facet as inactive (matches everything)', () => {
    expect(ids(filterContracts(all, { account_ids: undefined }))).toEqual([1, 2, 3, 4, 5])
  })

  it('falls back to the default accounts when no explicit account filter is set', () => {
    expect(ids(filterContracts(all, { account_ids: undefined }, [10]))).toEqual([1, 3, 5])
  })

  it('an explicit account filter overrides the default fallback', () => {
    expect(ids(filterContracts(all, { account_ids: [20] }, [10]))).toEqual([2, 4])
  })

  it('filters by category and excludes contracts without one', () => {
    expect(ids(filterContracts(all, { categories: ['RENT', 'SALARY'] }))).toEqual([2, 3])
  })

  it('filters by frequency', () => {
    expect(ids(filterContracts(all, { frequencies: ['YEARLY'] }))).toEqual([4])
  })

  it("matches contracts without a turnus via the 'NONE' facet value", () => {
    expect(ids(filterContracts(all, { frequencies: ['NONE'] }))).toEqual([5])
    expect(ids(filterContracts(all, { frequencies: ['YEARLY', 'NONE'] }))).toEqual([4, 5])
  })

  it('filters by signed amount range', () => {
    // Expenses between -1000 and -40 -> rent (-900) and insurance (-50).
    expect(ids(filterContracts(all, { amount_from: -1000, amount_to: -40 }))).toEqual([3, 4])
  })

  it('excludes contracts without a median when an amount bound is set', () => {
    const noMedian = makeContract({ id: 7, median_amount: null })
    expect(ids(filterContracts([...all, noMedian], { amount_to: 10000 }))).toEqual([1, 2, 3, 4, 5])
  })

  it('combines facets with AND', () => {
    expect(ids(filterContracts(all, { account_ids: [10], categories: ['RENT'] }))).toEqual([3])
  })

  it('filters by the overdue facet', () => {
    const overdueRent = makeContract({ id: 6, is_overdue: true })
    const pool = [...all, overdueRent]
    expect(ids(filterContracts(pool, { overdue: ['OVERDUE'] }))).toEqual([6])
    expect(ids(filterContracts(pool, { overdue: ['CURRENT'] }))).toEqual([1, 2, 3, 4, 5])
    expect(ids(filterContracts(pool, { overdue: undefined }))).toEqual([1, 2, 3, 4, 5, 6])
    expect(ids(filterContracts(pool, {}))).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('hides archived contracts by default, showing them only via the status facet', () => {
    const archived = makeContract({ id: 6, is_archived: true })
    const pool = [...all, archived]
    expect(ids(filterContracts(pool, {}))).toEqual([1, 2, 3, 4, 5])
    expect(ids(filterContracts(pool, { status: ['ARCHIVED'] }))).toEqual([6])
    expect(ids(filterContracts(pool, { status: ['ACTIVE', 'ARCHIVED'] }))).toEqual([
      1, 2, 3, 4, 5, 6,
    ])
  })
})

describe('hasActiveContractFilters', () => {
  it('is false for an empty filter object', () => {
    expect(hasActiveContractFilters({})).toBe(false)
  })

  it('is true for a present-but-empty facet ("none selected")', () => {
    expect(hasActiveContractFilters({ account_ids: [] })).toBe(true)
  })

  it('is true when a facet has a value', () => {
    expect(hasActiveContractFilters({ frequencies: ['MONTHLY'] })).toBe(true)
  })

  it('is true when only an amount bound is set', () => {
    expect(hasActiveContractFilters({ amount_from: 0 })).toBe(true)
  })

  it('is true when the overdue or status facet is set', () => {
    expect(hasActiveContractFilters({ overdue: ['OVERDUE'] })).toBe(true)
    expect(hasActiveContractFilters({ status: ['ARCHIVED'] })).toBe(true)
    expect(hasActiveContractFilters({ overdue: undefined })).toBe(false)
  })
})

describe('monthsOverdue', () => {
  const now = new Date('2026-06-28T12:00:00')

  it('counts only whole calendar months', () => {
    expect(monthsOverdue('2026-02-24', now)).toBe(4)
  })

  it('does not count a partial final month', () => {
    expect(monthsOverdue('2026-04-30', now)).toBe(1)
  })

  it('is zero for a future or same-day date', () => {
    expect(monthsOverdue('2026-08-01', now)).toBe(0)
    expect(monthsOverdue('2026-06-28', now)).toBe(0)
  })
})

describe('overdueDuration', () => {
  const now = new Date('2026-06-28T12:00:00')

  it('reports days below two weeks (at least one)', () => {
    expect(overdueDuration('2026-06-22', now)).toEqual({ unit: 'days', count: 6 })
    expect(overdueDuration('2026-06-28', now)).toEqual({ unit: 'days', count: 1 })
  })

  it('reports whole weeks from two weeks up to two months', () => {
    expect(overdueDuration('2026-06-07', now)).toEqual({ unit: 'weeks', count: 3 })
  })

  it('reports whole months beyond two months', () => {
    expect(overdueDuration('2026-02-24', now)).toEqual({ unit: 'months', count: 4 })
  })
})

const projected = makeContract({
  amount_per_day: -1,
  amount_per_frequency: { WEEKLY: -7, BIWEEKLY: -14, MONTHLY: -30, QUARTERLY: -91, YEARLY: -365 },
})

describe('contractAmountForPeriod', () => {
  it('reads amount_per_day for the DAY period', () => {
    expect(contractAmountForPeriod(projected, 'DAY')).toBe(-1)
  })

  it('reads the projection for a frequency period', () => {
    expect(contractAmountForPeriod(projected, 'WEEKLY')).toBe(-7)
    expect(contractAmountForPeriod(projected, 'MONTHLY')).toBe(-30)
    expect(contractAmountForPeriod(projected, 'YEARLY')).toBe(-365)
  })

  it('returns null when the projection is missing', () => {
    const bare = makeContract({ amount_per_day: null, amount_per_frequency: null })
    expect(contractAmountForPeriod(bare, 'DAY')).toBeNull()
    expect(contractAmountForPeriod(bare, 'MONTHLY')).toBeNull()
  })
})

describe('sumContractsForPeriod', () => {
  it('sums the period amount across contracts, ignoring those without a value', () => {
    const a = makeContract({
      id: 1,
      amount_per_frequency: { WEEKLY: 0, BIWEEKLY: 0, MONTHLY: -30, QUARTERLY: 0, YEARLY: 0 },
    })
    const b = makeContract({
      id: 2,
      amount_per_frequency: { WEEKLY: 0, BIWEEKLY: 0, MONTHLY: -50, QUARTERLY: 0, YEARLY: 0 },
    })
    const missing = makeContract({ id: 3, amount_per_frequency: null })
    expect(sumContractsForPeriod([a, b, missing], 'MONTHLY')).toBe(-80)
  })

  it('is zero for an empty list', () => {
    expect(sumContractsForPeriod([], 'MONTHLY')).toBe(0)
  })
})
