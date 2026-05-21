import { describe, expect, it } from 'vitest'
import { formatEuro, formatDate } from '../format'

describe('formatEuro', () => {
  it('formats positive amounts in de-DE', () => {
    expect(formatEuro(1234.56)).toBe('1.234,56 €')
  })

  it('formats negative amounts with minus sign', () => {
    expect(formatEuro(-42)).toBe('-42,00 €')
  })
})

describe('formatDate', () => {
  it('formats an ISO date in long German form', () => {
    expect(formatDate('2026-05-20T12:00:00Z')).toMatch(/20\. Mai 2026/)
  })
})
