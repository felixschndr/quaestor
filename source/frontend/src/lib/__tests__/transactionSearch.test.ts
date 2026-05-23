import { describe, expect, it } from 'vitest'

import { buildFilterQueryString } from '@/lib/transactionSearch'

describe('buildFilterQueryString', () => {
  it('emits one account_ids entry per id', () => {
    const result = buildFilterQueryString([42, 99], {})
    const params = new URLSearchParams(result)
    expect(params.getAll('account_ids')).toEqual(['42', '99'])
  })

  it('emits an empty query when no accounts and no filters are set', () => {
    expect(buildFilterQueryString([], {})).toBe('')
  })

  it('encodes every set filter as a query parameter', () => {
    const result = buildFilterQueryString([42], {
      text: 'rewe',
      amount_from: -50,
      amount_to: 0,
      date_from: '2026-01-01',
      date_to: '2026-12-31',
      transaction_type: 'OUTGOING',
      category: 'SUPERMARKET',
    })
    const params = new URLSearchParams(result)
    expect(params.get('account_ids')).toBe('42')
    expect(params.get('text')).toBe('rewe')
    expect(params.get('amount_from')).toBe('-50')
    expect(params.get('amount_to')).toBe('0')
    expect(params.get('date_from')).toBe('2026-01-01')
    expect(params.get('date_to')).toBe('2026-12-31')
    expect(params.get('transaction_type')).toBe('OUTGOING')
    expect(params.get('category')).toBe('SUPERMARKET')
  })

  it('skips empty strings (treats them as "no filter")', () => {
    const result = buildFilterQueryString([42], { text: '', category: 'SALARY' })
    const params = new URLSearchParams(result)
    expect(params.get('text')).toBeNull()
    expect(params.get('category')).toBe('SALARY')
  })

  it('keeps the literal value 0 — `amount_from=0` is a real filter', () => {
    const result = buildFilterQueryString([42], { amount_from: 0 })
    const params = new URLSearchParams(result)
    expect(params.get('amount_from')).toBe('0')
  })

  it('skips undefined fields', () => {
    const result = buildFilterQueryString([42], { text: 'foo', amount_from: undefined })
    const params = new URLSearchParams(result)
    expect(params.get('text')).toBe('foo')
    expect(params.get('amount_from')).toBeNull()
  })
})
