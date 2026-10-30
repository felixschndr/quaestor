import { QueryClient } from '@tanstack/react-query'
import { act, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { transactionQueryKeys } from '@/lib/transaction'
import {
  contractAmountForPeriod,
  contractQueryKeys,
  useContracts,
  useSetTransactionContract,
  filterContracts,
  hasActiveContractFilters,
  monthsOverdue,
  overdueDuration,
  sumContractsForPeriod,
  type ContractFilters,
  type ContractRead,
} from '@/lib/contract'
import { jsonResponse, renderHookWithClient } from '@/test/helpers'
import { buildContract } from '@/test/statsFixtures'

const netflix = buildContract({
  id: 1,
  account_id: 10,
  category: 'STREAMING',
  median_amount: -12.99,
  frequency: 'MONTHLY',
})
const salary = buildContract({
  id: 2,
  account_id: 20,
  category: 'SALARY',
  median_amount: 4200,
  frequency: 'MONTHLY',
})
const rent = buildContract({
  id: 3,
  account_id: 10,
  category: 'RENT',
  median_amount: -900,
  frequency: 'MONTHLY',
})
const insurance = buildContract({
  id: 4,
  account_id: 20,
  category: null,
  median_amount: -50,
  frequency: 'YEARLY',
})
const irregular = buildContract({
  id: 5,
  account_id: 10,
  category: null,
  median_amount: -25,
  frequency: null,
})
const all = [netflix, salary, rent, insurance, irregular]

const ids = (contracts: ContractRead[]) => contracts.map((contract) => contract.id)

describe('filterContracts', () => {
  const noMedian = buildContract({ id: 7, median_amount: null })

  it.each<[string, ContractFilters, number[], number[]?]>([
    ['returns everything when no facet is active', {}, [1, 2, 3, 4, 5]],
    ['filters by account', { account_ids: [10] }, [1, 3, 5]],
    [
      'treats a present-but-empty facet as "none selected" (matches nothing)',
      { account_ids: [] },
      [],
    ],
    [
      'treats an absent facet as inactive (matches everything)',
      { account_ids: undefined },
      [1, 2, 3, 4, 5],
    ],
    [
      'falls back to the default accounts when no explicit account filter is set',
      { account_ids: undefined },
      [1, 3, 5],
      [10],
    ],
    [
      'an explicit account filter overrides the default fallback',
      { account_ids: [20] },
      [2, 4],
      [10],
    ],
    [
      'filters by category and excludes contracts without one',
      { categories: ['RENT', 'SALARY'] },
      [2, 3],
    ],
    ['filters by frequency', { frequencies: ['YEARLY'] }, [4]],
    [
      "matches contracts without a turnus via the 'NONE' facet value",
      { frequencies: ['NONE'] },
      [5],
    ],
    [
      "combines the 'NONE' facet value with real turnuses",
      { frequencies: ['YEARLY', 'NONE'] },
      [4, 5],
    ],
    // Expenses between -1000 and -40 -> rent (-900) and insurance (-50).
    ['filters by signed amount range', { amount_from: -1000, amount_to: -40 }, [3, 4]],
    ['combines facets with AND', { account_ids: [10], categories: ['RENT'] }, [3]],
  ])('%s', (_, filters, expected, defaults) => {
    expect(ids(filterContracts(all, filters, defaults))).toEqual(expected)
  })

  it('filters by name, case-insensitively', () => {
    const named = [
      buildContract({ id: 7, name: 'Netflix' }),
      buildContract({ id: 8, name: 'Spotify' }),
    ]
    expect(ids(filterContracts(named, { text: ' netflix ' }))).toEqual([7])
  })

  it.each<[string, ContractFilters, number[]]>([
    [
      'drops contracts below the lower bound, including those without a median',
      { amount_from: -60 },
      [1, 2, 4, 5],
    ],
    [
      'excludes contracts without a median when an amount bound is set',
      { amount_to: 10000 },
      [1, 2, 3, 4, 5],
    ],
  ])('%s', (_, filters, expected) => {
    expect(ids(filterContracts([...all, noMedian], filters))).toEqual(expected)
  })

  it('filters by the overdue facet', () => {
    const overdueRent = buildContract({ id: 6, is_overdue: true })
    const pool = [...all, overdueRent]
    expect(ids(filterContracts(pool, { overdue: ['OVERDUE'] }))).toEqual([6])
    expect(ids(filterContracts(pool, { overdue: ['CURRENT'] }))).toEqual([1, 2, 3, 4, 5])
    expect(ids(filterContracts(pool, { overdue: undefined }))).toEqual([1, 2, 3, 4, 5, 6])
    expect(ids(filterContracts(pool, {}))).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('hides archived contracts by default, showing them only via the status facet', () => {
    const archived = buildContract({ id: 6, is_archived: true })
    const pool = [...all, archived]
    expect(ids(filterContracts(pool, {}))).toEqual([1, 2, 3, 4, 5])
    expect(ids(filterContracts(pool, { status: ['ARCHIVED'] }))).toEqual([6])
    expect(ids(filterContracts(pool, { status: ['ACTIVE', 'ARCHIVED'] }))).toEqual([
      1, 2, 3, 4, 5, 6,
    ])
  })
})

describe('hasActiveContractFilters', () => {
  it.each<[string, ContractFilters, boolean]>([
    ['is false for an empty filter object', {}, false],
    ['is true for a present-but-empty facet ("none selected")', { account_ids: [] }, true],
    ['is true when a facet has a value', { frequencies: ['MONTHLY'] }, true],
    ['is true when only an amount bound is set', { amount_from: 0 }, true],
    ['is true when the overdue facet is set', { overdue: ['OVERDUE'] }, true],
    ['is true when the status facet is set', { status: ['ARCHIVED'] }, true],
    ['is false when the overdue facet is explicitly undefined', { overdue: undefined }, false],
  ])('%s', (_, filters, expected) => {
    expect(hasActiveContractFilters(filters)).toBe(expected)
  })
})

describe('monthsOverdue', () => {
  const now = new Date('2026-06-28T12:00:00')

  it.each([
    ['counts only whole calendar months', '2026-02-24', 4],
    ['does not count a partial final month', '2026-04-30', 1],
    ['is zero for a future date', '2026-08-01', 0],
    ['is zero for a same-day date', '2026-06-28', 0],
    ['is zero for an unparseable date', 'not-a-date', 0],
  ])('%s', (_, date, expected) => {
    expect(monthsOverdue(date, now)).toBe(expected)
  })
})

describe('overdueDuration', () => {
  const now = new Date('2026-06-28T12:00:00')

  it.each([
    ['reports days below two weeks', '2026-06-22', { unit: 'days', count: 6 }],
    ['reports at least one day', '2026-06-28', { unit: 'days', count: 1 }],
    [
      'reports whole weeks from two weeks up to two months',
      '2026-06-07',
      { unit: 'weeks', count: 3 },
    ],
    ['reports whole months beyond two months', '2026-02-24', { unit: 'months', count: 4 }],
  ])('%s', (_, date, expected) => {
    expect(overdueDuration(date, now)).toEqual(expected)
  })
})

const projected = buildContract({
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
    const bare = buildContract({ amount_per_day: null, amount_per_frequency: null })
    expect(contractAmountForPeriod(bare, 'DAY')).toBeNull()
    expect(contractAmountForPeriod(bare, 'MONTHLY')).toBeNull()
  })
})

describe('sumContractsForPeriod', () => {
  it('sums the period amount across contracts, ignoring those without a value', () => {
    const a = buildContract({
      id: 1,
      amount_per_frequency: { WEEKLY: 0, BIWEEKLY: 0, MONTHLY: -30, QUARTERLY: 0, YEARLY: 0 },
    })
    const b = buildContract({
      id: 2,
      amount_per_frequency: { WEEKLY: 0, BIWEEKLY: 0, MONTHLY: -50, QUARTERLY: 0, YEARLY: 0 },
    })
    const missing = buildContract({ id: 3, amount_per_frequency: null })
    expect(sumContractsForPeriod([a, b, missing], 'MONTHLY')).toBe(-80)
  })

  it('is zero for an empty list', () => {
    expect(sumContractsForPeriod([], 'MONTHLY')).toBe(0)
  })
})

describe('useContracts', () => {
  it('loads only active contracts unless archived ones are requested', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ status: 200, body: [netflix] }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const client = new QueryClient()

    const active = renderHookWithClient(() => useContracts(), client)
    const withArchived = renderHookWithClient(() => useContracts(true), client)

    await waitFor(() => expect(active.result.current.data).toEqual([netflix]))
    await waitFor(() => expect(withArchived.result.current.data).toEqual([netflix]))
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/contracts',
      '/api/contracts?include_archived=true',
    ])
  })
})

describe('useSetTransactionContract', () => {
  it('assigns an unassigned transaction via POST and refreshes the target contract', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new QueryClient()
    client.setQueryData(contractQueryKeys.detail(3), { id: 3 })
    const { result } = renderHookWithClient(() => useSetTransactionContract(), client)

    await act(async () => {
      await result.current.mutateAsync({ transactionId: 5, fromContractId: null, toContractId: 3 })
    })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/contracts/3/transactions')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ transaction_id: 5 })
    expect(client.getQueryState(contractQueryKeys.detail(3))?.isInvalidated).toBe(true)
  })

  it('refetches the transaction detail so removing a contract shows up there', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })))
    const client = new QueryClient()
    client.setQueryData(transactionQueryKeys.byId(5), { id: 5, contract_id: 3 })
    const { result } = renderHookWithClient(() => useSetTransactionContract(), client)

    await act(async () => {
      await result.current.mutateAsync({ transactionId: 5, fromContractId: 3, toContractId: null })
    })

    expect(client.getQueryState(transactionQueryKeys.byId(5))?.isInvalidated).toBe(true)
  })
})
