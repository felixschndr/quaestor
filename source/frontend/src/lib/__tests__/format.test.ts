import { describe, expect, it } from 'vitest'
import { formatEuro, formatDate, relativeDateKey } from '../format'

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

describe('relativeDateKey', () => {
  const today = new Date(2026, 4, 22) // May 22, 2026, local midnight
  const yesterday = new Date(2026, 4, 21)
  const older = new Date(2026, 4, 20)

  it('returns "today" for the same local day', () => {
    expect(relativeDateKey(new Date(2026, 4, 22, 14, 30), today)).toBe('today')
  })

  it('returns "yesterday" for the previous local day', () => {
    expect(relativeDateKey(yesterday, today)).toBe('yesterday')
  })

  it('returns null for older dates', () => {
    expect(relativeDateKey(older, today)).toBeNull()
  })

  it('handles month boundaries correctly', () => {
    const may1 = new Date(2026, 4, 1)
    const apr30 = new Date(2026, 3, 30)
    expect(relativeDateKey(apr30, may1)).toBe('yesterday')
  })
})
