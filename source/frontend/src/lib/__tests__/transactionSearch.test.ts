import { describe, expect, it } from 'vitest'

import { buildFilterQueryString } from '@/lib/transactionSearch'

describe('buildFilterQueryString', () => {
  it('returns an empty string when no filters are set', () => {
    expect(buildFilterQueryString({})).toBe('')
  })

  it('encodes every set filter as a query parameter', () => {
    const result = buildFilterQueryString({
      text: 'rewe',
      amount_from: -50,
      amount_to: 0,
      date_from: '2026-01-01',
      date_to: '2026-12-31',
      transaction_type: 'OUTGOING',
      category: 'SUPERMARKET',
    })
    const params = new URLSearchParams(result)
    expect(params.get('text')).toBe('rewe')
    expect(params.get('amount_from')).toBe('-50')
    expect(params.get('amount_to')).toBe('0')
    expect(params.get('date_from')).toBe('2026-01-01')
    expect(params.get('date_to')).toBe('2026-12-31')
    expect(params.get('transaction_type')).toBe('OUTGOING')
    expect(params.get('category')).toBe('SUPERMARKET')
  })

  it('skips empty strings (treats them as "no filter")', () => {
    const result = buildFilterQueryString({ text: '', category: 'SALARY' })
    expect(result).toBe('category=SALARY')
  })

  it('keeps the literal value 0 — `amount_from=0` is a real filter', () => {
    const result = buildFilterQueryString({ amount_from: 0 })
    expect(result).toBe('amount_from=0')
  })

  it('skips undefined fields', () => {
    const result = buildFilterQueryString({ text: 'foo', amount_from: undefined })
    expect(result).toBe('text=foo')
  })
})
