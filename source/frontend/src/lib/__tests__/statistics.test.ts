import { describe, expect, it } from 'vitest'

import {
  aggregateTopN,
  averageMonthlyExpenses,
  buildStatsQueryString,
  defaultStatsDateRange,
  fillTransactionCountBuckets,
  runwayMonths,
  runwayYearsMonths,
  sliceColor,
  type CategoryChartDatum,
  type MonthlyCashflow,
} from '@/lib/statistics'

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
  it('is positional — same rank yields the same color regardless of category', () => {
    expect(sliceColor('SALARY', 0)).toBe(sliceColor('FUEL', 0))
  })

  it('gives the first ranks distinct colors', () => {
    expect(sliceColor('SALARY', 0)).not.toBe(sliceColor('FUEL', 1))
  })

  it('uses a neutral gray for the OTHER bucket', () => {
    expect(sliceColor('OTHER', 3)).toBe('oklch(0.6 0 0)')
  })
})

describe('fillTransactionCountBuckets', () => {
  it('fills missing days with zero across the selected range', () => {
    const filled = fillTransactionCountBuckets(
      [{ bucket: '2026-06-02', count: 3 }],
      'day',
      '2026-06-01',
      '2026-06-03',
    )
    expect(filled).toEqual([
      { bucket: '2026-06-01', count: 0 },
      { bucket: '2026-06-02', count: 3 },
      { bucket: '2026-06-03', count: 0 },
    ])
  })

  it('keys weeks by their Monday, starting at the week containing the range start', () => {
    const filled = fillTransactionCountBuckets(
      [{ bucket: '2026-06-08', count: 2 }],
      'week',
      '2026-06-03',
      '2026-06-10',
    )
    expect(filled).toEqual([
      { bucket: '2026-06-01', count: 0 },
      { bucket: '2026-06-08', count: 2 },
    ])
  })

  it('fills months and falls back to the data extent without an explicit range', () => {
    const filled = fillTransactionCountBuckets(
      [
        { bucket: '2026-04', count: 1 },
        { bucket: '2026-06', count: 2 },
      ],
      'month',
    )
    expect(filled).toEqual([
      { bucket: '2026-04', count: 1 },
      { bucket: '2026-05', count: 0 },
      { bucket: '2026-06', count: 2 },
    ])
  })

  it('always returns all seven weekdays, Monday first', () => {
    const filled = fillTransactionCountBuckets(
      [
        { bucket: '0', count: 4 },
        { bucket: '3', count: 1 },
      ],
      'weekday',
    )
    expect(filled.map((entry) => entry.bucket)).toEqual(['1', '2', '3', '4', '5', '6', '0'])
    expect(filled[2]).toEqual({ bucket: '3', count: 1 })
    expect(filled[6]).toEqual({ bucket: '0', count: 4 })
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

  it('averages the expenses across the returned months', () => {
    expect(
      averageMonthlyExpenses([
        month('2026-01', 1000),
        month('2026-02', 2000),
        month('2026-03', 3000),
      ]),
    ).toBe(2000)
  })

  it('returns 0 for no months', () => {
    expect(averageMonthlyExpenses([])).toBe(0)
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
