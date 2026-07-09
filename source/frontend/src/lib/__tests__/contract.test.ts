import { describe, expect, it } from 'vitest'

import {
  contractAmountForPeriod,
  filterContracts,
  hasActiveContractFilters,
  monthsOverdue,
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
    amount_spread: 0,
    min_amount: null,
    average_amount: null,
    max_amount: null,
    frequency: 'MONTHLY',
    interval_days: 30,
    expected_next_date: null,
    is_overdue: false,
    member_count: 3,
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

  it('filters by account', () => {
    expect(ids(filterContracts(all, { account_ids: [10] }))).toEqual([1, 3, 5])
  })

  it('treats a present-but-empty facet as "none selected" (matches nothing)', () => {
    expect(ids(filterContracts(all, { account_ids: [] }))).toEqual([])
  })

  it('treats an absent facet as inactive (matches everything)', () => {
    expect(ids(filterContracts(all, { account_ids: undefined }))).toEqual([1, 2, 3, 4, 5])
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

  it('filters to overdue contracts only when the overdue facet is on', () => {
    const overdueRent = makeContract({ id: 6, is_overdue: true })
    const pool = [...all, overdueRent]
    expect(ids(filterContracts(pool, { overdue: true }))).toEqual([6])
    // An absent/false overdue facet leaves everything untouched.
    expect(ids(filterContracts(pool, { overdue: false }))).toEqual([1, 2, 3, 4, 5, 6])
    expect(ids(filterContracts(pool, {}))).toEqual([1, 2, 3, 4, 5, 6])
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

  it('is true when the overdue facet is on, false when off', () => {
    expect(hasActiveContractFilters({ overdue: true })).toBe(true)
    expect(hasActiveContractFilters({ overdue: false })).toBe(false)
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
