import { describe, expect, it } from 'vitest'

import {
  aggregateTopN,
  averageMonthlyExpenses,
  averageMonthlyIncome,
  baselineDateRange,
  baselineRangeDescriptor,
  buildStatsQueryString,
  defaultStatsDateRange,
  fillTransactionCountBuckets,
  fixedCostRatio,
  runwayMonths,
  runwayYearsMonths,
  sliceColor,
  type CategoryChartDatum,
  type MonthlyCashflow,
} from '@/lib/statistics'
import { TRANSACTION_CATEGORIES } from '@/lib/transaction'

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
  it('reports whole months when the range is an exact month span', () => {
    expect(baselineRangeDescriptor('2026-05-15', '2026-06-15', 6)).toEqual({
      unit: 'months',
      len: 1,
      periods: 6,
      totalDays: 0,
    })
  })

  it('detects a month even when the start clamped to a month-end (2026-06-30 → 2026-07-31)', () => {
    expect(baselineRangeDescriptor('2026-06-30', '2026-07-31', 6)).toEqual({
      unit: 'months',
      len: 1,
      periods: 6,
      totalDays: 0,
    })
  })

  it('reports whole weeks for a 14-day range', () => {
    expect(baselineRangeDescriptor('2026-01-01', '2026-01-15', 3)).toEqual({
      unit: 'weeks',
      len: 2,
      periods: 3,
      totalDays: 0,
    })
  })

  it('falls back to days with a computed total when the span is neither', () => {
    expect(baselineRangeDescriptor('2026-01-01', '2026-01-18', 3)).toEqual({
      unit: 'days',
      len: 17,
      periods: 3,
      totalDays: 51,
    })
  })
})

describe('defaultStatsDateRange', () => {
  it('spans the month up to the given day', () => {
    expect(defaultStatsDateRange(new Date(2026, 5, 15))).toEqual({
      date_from: '2026-05-15',
      date_to: '2026-06-15',
    })
  })

  it('handles year boundaries', () => {
    expect(defaultStatsDateRange(new Date(2026, 0, 10))).toEqual({
      date_from: '2025-12-10',
      date_to: '2026-01-10',
    })
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

  it('sorts by value before slicing so the biggest survive', () => {
    const data = [datum('FUEL', 1), datum('RENT', 100), datum('GIFTS', 2)]
    const result = aggregateTopN(data, 1, 'Other')
    expect(result[0]).toEqual(datum('RENT', 100))
    expect(result[1]).toEqual({ category: 'OTHER', label: 'Other', value: 3 })
  })
})

describe('sliceColor', () => {
  it('keys the color on the category, not on its rank', () => {
    expect(sliceColor('SUPERMARKET')).not.toBe(sliceColor('RENT'))
  })

  it('uses a neutral gray for the OTHER bucket', () => {
    expect(sliceColor('OTHER')).toBe('var(--chart-other)')
  })

  it('gives every category a color', () => {
    for (const category of TRANSACTION_CATEGORIES) {
      expect(sliceColor(category)).toMatch(/^var\(--chart-/)
    }
  })

  it('keeps the twelve most common expense categories visually distinct', () => {
    const common = [
      'RENT',
      'UTILITIES',
      'SUPERMARKET',
      'ONLINE_SHOPPING',
      'RESTAURANTS',
      'FUEL',
      'SUBSCRIPTIONS',
      'ENTERTAINMENT',
      'TRAVEL',
      'FITNESS',
      'CLOTHING',
      'DRUGSTORE',
    ] as const
    expect(new Set(common.map((category) => sliceColor(category))).size).toBe(common.length)
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
})

describe('averageMonthlyExpenses', () => {
  const month = (m: string, expenses: number): MonthlyCashflow => ({
    month: m,
    income: 0,
    expenses,
  })

  it('normalises the range total by its actual length in months', () => {
    const result = averageMonthlyExpenses(
      [month('2026-01', 1000), month('2026-02', 2000), month('2026-03', 3000)],
      '2026-01-01',
      '2026-03-31',
    )
    expect(result).toBeCloseTo(2029.2, 1)
  })

  it('counts a month-straddling one-month range as one month, not two buckets', () => {
    const result = averageMonthlyExpenses(
      [month('2026-06', 3000), month('2026-07', 2000)],
      '2026-06-29',
      '2026-07-29',
    )
    expect(result).toBeCloseTo(4909.3, 1)
  })

  it('falls back to bucket count without a range', () => {
    expect(averageMonthlyExpenses([month('2026-01', 1000), month('2026-02', 3000)])).toBe(2000)
  })

  it('returns 0 for no months', () => {
    expect(averageMonthlyExpenses([])).toBe(0)
  })
})

describe('averageMonthlyIncome', () => {
  const month = (m: string, income: number): MonthlyCashflow => ({ month: m, income, expenses: 0 })

  it('averages the income across the returned months', () => {
    expect(averageMonthlyIncome([month('2026-01', 1000), month('2026-02', 3000)])).toBe(2000)
  })

  it('returns 0 for no months', () => {
    expect(averageMonthlyIncome([])).toBe(0)
  })
})

describe('fixedCostRatio', () => {
  it('divides monthly contracts by average monthly income', () => {
    expect(fixedCostRatio(500, 2000)).toBe(0.25)
  })

  it('returns null without income', () => {
    expect(fixedCostRatio(500, 0)).toBeNull()
  })
})

describe('runwayMonths', () => {
  it('divides balance by average monthly expenses', () => {
    expect(runwayMonths(10000, 2000)).toBe(5)
  })

  it('returns null when nothing is being spent (indefinite runway)', () => {
    expect(runwayMonths(10000, 0)).toBeNull()
  })

  it('clamps a negative (overdrawn) balance to 0', () => {
    expect(runwayMonths(-500, 2000)).toBe(0)
  })
})

describe('runwayYearsMonths', () => {
  it('splits whole months into years and months', () => {
    expect(runwayYearsMonths(18)).toEqual({ years: 1, months: 6 })
  })

  it('rounds to the nearest whole month before splitting', () => {
    expect(runwayYearsMonths(12.6)).toEqual({ years: 1, months: 1 })
    expect(runwayYearsMonths(23.6)).toEqual({ years: 2, months: 0 })
  })

  it('is exact on whole-year boundaries', () => {
    expect(runwayYearsMonths(24)).toEqual({ years: 2, months: 0 })
  })
})
