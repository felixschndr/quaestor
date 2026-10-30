import { waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import {
  aggregateTopN,
  averageMonthlyExpenses,
  baselineDateRange,
  baselineRangeDescriptor,
  buildStatsQueryString,
  DATE_RANGE_PRESETS,
  defaultStatsDateRange,
  DETAIL_RANGE_PRESETS,
  detailPresetRange,
  fillTransactionCountBuckets,
  matchingDetailPreset,
  matchingPreset,
  monthDateRange,
  presetDateRange,
  runwayMonths,
  runwayYearsMonths,
  showsStaleData,
  sliceColor,
  useCategoryTrendStats,
  useNetWorthRange,
  useNetWorthStats,
  type CategoryChartDatum,
  type MonthlyCashflow,
} from '@/lib/statistics'
import { DATE_RECENT, DATE_TODAY, DATE_YEAR_START, DATE_YESTERDAY, TODAY } from '@/test/constants'
import { jsonResponse, renderHookWithClient } from '@/test/helpers'
import { CATEGORIES_BY_GROUP, CATEGORY_GROUPS, TRANSACTION_CATEGORIES } from '@/lib/transaction'

describe('buildStatsQueryString', () => {
  it('emits one account_ids entry per id', () => {
    const params = new URLSearchParams(buildStatsQueryString([42, 99], {}))
    expect(params.getAll('account_ids')).toEqual(['42', '99'])
  })

  it('encodes filter fields and extras (direction)', () => {
    const params = new URLSearchParams(
      buildStatsQueryString(
        [42],
        { date_from: '2026-01-01', date_to: '2026-03-31' },
        { direction: 'INCOMING' },
      ),
    )
    expect(params.get('account_ids')).toBe('42')
    expect(params.get('date_from')).toBe('2026-01-01')
    expect(params.get('date_to')).toBe('2026-03-31')
    expect(params.get('direction')).toBe('INCOMING')
  })

  it('skips undefined / empty-string values but keeps 0', () => {
    const params = new URLSearchParams(
      buildStatsQueryString([42], { date_from: '' }, { direction: undefined, limit: 0 }),
    )
    expect(params.get('date_from')).toBeNull()
    expect(params.get('direction')).toBeNull()
    expect(params.get('limit')).toBe('0')
  })

  it('emits one categories entry per selected category', () => {
    const params = new URLSearchParams(buildStatsQueryString([42], {}, {}, ['FUEL', 'RENT']))
    expect(params.getAll('categories')).toEqual(['FUEL', 'RENT'])
  })

  it('emits no categories param when none are passed (= all)', () => {
    const params = new URLSearchParams(buildStatsQueryString([42], {}, {}, []))
    expect(params.getAll('categories')).toEqual([])
  })
})

describe('baselineDateRange', () => {
  it('covers the N equal-length windows ending the day before the selected range', () => {
    // A 7-day selected range (01–07), 3 windows back → 21 days ending 2025-12-31.
    expect(baselineDateRange('2026-01-01', '2026-01-07', 3)).toEqual({
      from: '2025-12-11',
      to: '2025-12-31',
    })
  })
})

describe('baselineRangeDescriptor', () => {
  it.each([
    [
      'reports whole months when the range is an exact month span',
      '2026-05-15',
      '2026-06-15',
      6,
      { unit: 'months', len: 1, periods: 6, totalDays: 0 },
    ],
    [
      'detects a month even when the start clamped to a month-end (2026-06-30 → 2026-07-31)',
      '2026-06-30',
      '2026-07-31',
      6,
      { unit: 'months', len: 1, periods: 6, totalDays: 0 },
    ],
    [
      'reports whole weeks for a 14-day range',
      '2026-01-01',
      '2026-01-15',
      3,
      { unit: 'weeks', len: 2, periods: 3, totalDays: 0 },
    ],
    [
      'falls back to days with a computed total when the span is neither',
      '2026-01-01',
      '2026-01-18',
      3,
      { unit: 'days', len: 17, periods: 3, totalDays: 51 },
    ],
  ])('%s', (_, from, to, periods, expected) => {
    expect(baselineRangeDescriptor(from, to, periods)).toEqual(expected)
  })
})

describe('defaultStatsDateRange', () => {
  it.each([
    ['spans the month up to the given day', new Date(2026, 5, 15), '2026-05-15', '2026-06-15'],
    ['handles year boundaries', new Date(2026, 0, 10), '2025-12-10', '2026-01-10'],
  ])('%s', (_, today, date_from, date_to) => {
    expect(defaultStatsDateRange(today)).toEqual({ date_from, date_to })
  })
})

describe('aggregateTopN', () => {
  const datum = (category: CategoryChartDatum['category'], value: number): CategoryChartDatum => ({
    category: category as CategoryChartDatum['category'],
    label: String(category),
    value,
  })

  it('returns the input unchanged when it already fits', () => {
    const data = [datum('SALARY', 10), datum('RENT', 5)]
    expect(aggregateTopN(data, 5, 'Other')).toEqual(data)
  })

  it('keeps the top n and collapses the rest into a single Other slice', () => {
    const data = [
      datum('RENT', 100),
      datum('FUEL', 50),
      datum('GIFTS', 30),
      datum('FEES', 20),
      datum('CLOTHING', 5),
    ]
    const result = aggregateTopN(data, 2, 'Other')
    expect(result).toEqual([
      datum('RENT', 100),
      datum('FUEL', 50),
      { category: 'OTHER', label: 'Other', value: 55 },
    ])
  })

  it('adds no Other slice when the cut-off tail sums to zero', () => {
    const data = [datum('FUEL', 5), datum('RENT', 3), datum('SALARY', 0)]
    expect(aggregateTopN(data, 2, 'Other')).toEqual([datum('FUEL', 5), datum('RENT', 3)])
  })

  it('sorts by value before slicing so the biggest survive', () => {
    const data = [datum('FUEL', 1), datum('RENT', 100), datum('GIFTS', 2)]
    const result = aggregateTopN(data, 1, 'Other')
    expect(result[0]).toEqual(datum('RENT', 100))
    expect(result[1]).toEqual({ category: 'OTHER', label: 'Other', value: 3 })
  })
})

describe('sliceColor', () => {
  it('keys the color on the group, not on its rank', () => {
    expect(sliceColor('FOOD_AND_DRINK')).not.toBe(sliceColor('HOUSING'))
  })

  it('uses a neutral gray for the OTHER bucket', () => {
    expect(sliceColor('OTHER')).toBe('var(--chart-other)')
  })

  it('gives every category a color', () => {
    for (const category of TRANSACTION_CATEGORIES) {
      expect(sliceColor(category)).toMatch(/^var\(--chart-/)
    }
  })

  it('gives every group a color and keeps the first twelve visually distinct', () => {
    for (const group of CATEGORY_GROUPS) {
      expect(sliceColor(group)).toMatch(/^var\(--chart-/)
    }
    const colors = CATEGORY_GROUPS.slice(0, 12).map((group) => sliceColor(group))
    expect(new Set(colors).size).toBe(colors.length)
  })

  it('colours a custom category after the fixed categories of its group', () => {
    const custom = [
      { key: 'CUSTOM_00000001', group: 'PETS' as const },
      { key: 'CUSTOM_00000002', group: 'PETS' as const },
    ]
    const colors = [...CATEGORIES_BY_GROUP.PETS, ...custom.map((category) => category.key)].map(
      (key) => sliceColor(key, custom),
    )
    expect(new Set(colors).size).toBe(colors.length)
    expect(sliceColor('CUSTOM_FFFFFFFF', custom)).toBe('var(--chart-other)')
  })

  it('keeps the categories of one group visually distinct', () => {
    for (const group of CATEGORY_GROUPS) {
      const colors = CATEGORIES_BY_GROUP[group].map((category) => sliceColor(category))
      expect(new Set(colors).size).toBe(colors.length)
    }
  })
})

describe('fillTransactionCountBuckets', () => {
  it('fills missing days with zero across the selected range', () => {
    const filled = fillTransactionCountBuckets(
      [{ bucket: '2026-06-02', count: 3, amount: 30 }],
      'day',
      '2026-06-01',
      '2026-06-03',
    )
    expect(filled).toEqual([
      { bucket: '2026-06-01', count: 0, amount: 0 },
      { bucket: '2026-06-02', count: 3, amount: 30 },
      { bucket: '2026-06-03', count: 0, amount: 0 },
    ])
  })

  it('keys weeks by their Monday, starting at the week containing the range start', () => {
    const filled = fillTransactionCountBuckets(
      [{ bucket: '2026-06-08', count: 2, amount: 20 }],
      'week',
      '2026-06-03',
      '2026-06-10',
    )
    expect(filled).toEqual([
      { bucket: '2026-06-01', count: 0, amount: 0 },
      { bucket: '2026-06-08', count: 2, amount: 20 },
    ])
  })

  it('fills months and falls back to the data extent without an explicit range', () => {
    const filled = fillTransactionCountBuckets(
      [
        { bucket: '2026-04', count: 1, amount: 10 },
        { bucket: '2026-06', count: 2, amount: 20 },
      ],
      'month',
    )
    expect(filled).toEqual([
      { bucket: '2026-04', count: 1, amount: 10 },
      { bucket: '2026-05', count: 0, amount: 0 },
      { bucket: '2026-06', count: 2, amount: 20 },
    ])
  })

  it('always returns all seven weekdays, Monday first', () => {
    const filled = fillTransactionCountBuckets(
      [
        { bucket: '0', count: 4, amount: 40 },
        { bucket: '3', count: 1, amount: 10 },
      ],
      'weekday',
    )
    expect(filled.map((entry) => entry.bucket)).toEqual(['1', '2', '3', '4', '5', '6', '0'])
    expect(filled[2]).toEqual({ bucket: '3', count: 1, amount: 10 })
    expect(filled[6]).toEqual({ bucket: '0', count: 4, amount: 40 })
  })

  it('returns empty for time groupings without data or range', () => {
    expect(fillTransactionCountBuckets([], 'day')).toEqual([])
  })

  it('returns empty for a range that ends before it starts', () => {
    expect(fillTransactionCountBuckets([], 'day', DATE_TODAY, DATE_YESTERDAY)).toEqual([])
  })
})

describe('averageMonthlyExpenses', () => {
  const month = (m: string, expenses: number): MonthlyCashflow => ({
    month: m,
    income: 0,
    expenses,
  })

  it.each([
    [
      'normalises the range total by its actual length in months',
      [month('2026-01', 1000), month('2026-02', 2000), month('2026-03', 3000)],
      '2026-01-01',
      '2026-03-31',
      2029.2,
    ],
    [
      'counts a month-straddling one-month range as one month, not two buckets',
      [month('2026-06', 3000), month('2026-07', 2000)],
      '2026-06-29',
      '2026-07-29',
      4909.3,
    ],
  ])('%s', (_, cashflow, from, to, expected) => {
    expect(averageMonthlyExpenses(cashflow, from, to)).toBeCloseTo(expected, 1)
  })

  it.each<[string, MonthlyCashflow[], number, string?, string?]>([
    [
      'falls back to bucket count without a range',
      [month('2026-01', 1000), month('2026-02', 3000)],
      2000,
    ],
    [
      'falls back to bucket count for a range that ends before it starts',
      [month('2026-01', 1000), month('2026-02', 3000)],
      2000,
      '2026-02-28',
      '2026-01-01',
    ],
    ['returns 0 for no months', [], 0],
  ])('%s', (_, cashflow, expected, from, to) => {
    expect(averageMonthlyExpenses(cashflow, from, to)).toBe(expected)
  })
})

describe('runwayMonths', () => {
  it.each([
    ['divides balance by average monthly expenses', 10000, 2000, 5],
    ['returns null when nothing is being spent (indefinite runway)', 10000, 0, null],
    ['clamps a negative (overdrawn) balance to 0', -500, 2000, 0],
  ])('%s', (_, balance, expenses, expected) => {
    expect(runwayMonths(balance, expenses)).toBe(expected)
  })
})

describe('runwayYearsMonths', () => {
  it.each([
    ['splits whole months into years and months', 18, 1, 6],
    ['rounds down to the nearest whole month before splitting', 12.6, 1, 1],
    ['rounds up to the nearest whole month before splitting', 23.6, 2, 0],
    ['is exact on whole-year boundaries', 24, 2, 0],
  ])('%s', (_, months, expectedYears, expectedMonths) => {
    expect(runwayYearsMonths(months)).toEqual({ years: expectedYears, months: expectedMonths })
  })
})

describe('date range presets', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('recognises every stats preset it produced for the same day', () => {
    for (const preset of DATE_RANGE_PRESETS) {
      expect(matchingPreset(presetDateRange(preset, TODAY), TODAY)).toBe(preset)
    }
  })

  it('ends a preset today and starts it the preset length earlier', () => {
    expect(presetDateRange('3m', TODAY)).toEqual({ date_from: '2026-02-22', date_to: DATE_TODAY })
  })

  it('matches no preset for an open, custom or past-ending range', () => {
    expect(matchingPreset({ date_from: DATE_YEAR_START }, TODAY)).toBeNull()
    expect(matchingPreset({ date_from: DATE_YEAR_START, date_to: DATE_TODAY }, TODAY)).toBeNull()
    expect(
      matchingPreset({ ...presetDateRange('1m', TODAY), date_to: DATE_YESTERDAY }, TODAY),
    ).toBeNull()
  })

  it('round-trips every detail preset against the real today by default', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(TODAY)

    for (const preset of DETAIL_RANGE_PRESETS) {
      const { start, end } = detailPresetRange(preset)
      expect(matchingDetailPreset(start, end)).toBe(preset)
    }
    expect(detailPresetRange('1d')).toEqual({ start: DATE_YESTERDAY, end: DATE_TODAY })
    expect(matchingDetailPreset(DATE_RECENT, DATE_YESTERDAY)).toBeNull()
  })
})

describe('monthDateRange', () => {
  it('spans the first to the last day of the month, leap days included', () => {
    expect(monthDateRange('2024-02')).toEqual({ from: '2024-02-01', to: '2024-02-29' })
  })
})

describe('showsStaleData', () => {
  it('is only stale while refetching behind placeholder data', () => {
    expect(showsStaleData({ isFetching: true, isPlaceholderData: true })).toBe(true)
    expect(showsStaleData({ isFetching: true, isPlaceholderData: false })).toBe(false)
    expect(showsStaleData({ isFetching: false, isPlaceholderData: true })).toBe(false)
  })
})

describe('statistics queries', () => {
  let fetchSpy: MockInstance<typeof fetch>

  beforeEach(() => {
    fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => jsonResponse({ status: 200, body: {} }))
  })

  async function requestedUrl(): Promise<URL> {
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    return new URL(String(fetchSpy.mock.calls[0][0]), 'http://localhost')
  }

  it('asks for the range breakdown of every selected account', async () => {
    renderHookWithClient(() => useNetWorthRange(DATE_RECENT, DATE_TODAY, [43, 42]))

    const url = await requestedUrl()
    expect(url.pathname).toBe('/api/statistics/net-worth/range')
    expect(url.searchParams.get('start')).toBe(DATE_RECENT)
    expect(url.searchParams.get('end')).toBe(DATE_TODAY)
    expect(url.searchParams.getAll('account_ids')).toEqual(['43', '42'])
  })

  it('does not ask for a range breakdown without accounts', () => {
    const { result } = renderHookWithClient(() => useNetWorthRange(DATE_RECENT, DATE_TODAY, []))

    expect(result.current.fetchStatus).toBe('idle')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('asks for the raw net worth when the balance factor must not be applied', async () => {
    renderHookWithClient(() => useNetWorthStats([42], {}, true, false))

    const url = await requestedUrl()
    expect(url.pathname).toBe('/api/statistics/net-worth')
    expect(url.searchParams.get('apply_factor')).toBe('false')
  })

  it('sends direction, baseline windows and the type filter for the category trend', async () => {
    renderHookWithClient(() =>
      useCategoryTrendStats([42], { date_from: DATE_RECENT }, 'INCOMING', ['SALARY'], 3, {
        transaction_types: ['FEES'],
      }),
    )

    const url = await requestedUrl()
    expect(url.pathname).toBe('/api/statistics/categories/trend')
    expect(url.searchParams.get('direction')).toBe('INCOMING')
    expect(url.searchParams.get('baseline_windows')).toBe('3')
    expect(url.searchParams.get('date_from')).toBe(DATE_RECENT)
    expect(url.searchParams.getAll('categories')).toEqual(['SALARY'])
    expect(url.searchParams.getAll('transaction_types')).toEqual(['FEES'])
  })
})
