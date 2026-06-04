import { describe, expect, it } from 'vitest'

import {
  aggregateTopN,
  buildStatsQueryString,
  defaultStatsDateRange,
  sliceColor,
  type CategoryChartDatum,
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
  it('spans the three months up to the given day', () => {
    expect(defaultStatsDateRange(new Date(2026, 5, 15))).toEqual({
      date_from: '2026-03-15',
      date_to: '2026-06-15',
    })
  })

  it('handles year boundaries', () => {
    expect(defaultStatsDateRange(new Date(2026, 1, 10))).toEqual({
      date_from: '2025-11-10',
      date_to: '2026-02-10',
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
