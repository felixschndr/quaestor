import { describe, expect, it } from 'vitest'
import { formatEuro, formatDate, formatIban, relativeDateKey } from '../format'

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

  it('prefixes the date with the weekday', () => {
    // 2026-05-20 is a Wednesday → Mittwoch.
    expect(formatDate('2026-05-20T12:00:00Z')).toMatch(/^Mittwoch, /)
  })
})

describe('formatIban', () => {
  it('groups a German IBAN into 4-char blocks', () => {
    expect(formatIban('DE89370400440532013000')).toBe('DE89 3704 0044 0532 0130 00')
  })

  it('accepts an already-spaced IBAN and re-emits canonical grouping', () => {
    expect(formatIban('DE89 3704 0044 0532 0130 00')).toBe('DE89 3704 0044 0532 0130 00')
  })

  it('formats a 15-char Norwegian IBAN (minimum length)', () => {
    expect(formatIban('NO9386011117947')).toBe('NO93 8601 1117 947')
  })

  it('leaves names unchanged', () => {
    expect(formatIban('Max Mustermann')).toBe('Max Mustermann')
  })

  it('leaves the empty string unchanged', () => {
    expect(formatIban('')).toBe('')
  })

  it('leaves mixed text unchanged even if it starts with a country code', () => {
    expect(formatIban('DE82 Mustermann GmbH')).toBe('DE82 Mustermann GmbH')
  })

  it('leaves lowercase IBAN-shaped strings unchanged (backend emits uppercase)', () => {
    expect(formatIban('de89370400440532013000')).toBe('de89370400440532013000')
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

  it('returns "future" for any date strictly after today', () => {
    const tomorrow = new Date(2026, 4, 23)
    const nextMonth = new Date(2026, 5, 1)
    expect(relativeDateKey(tomorrow, today)).toBe('future')
    expect(relativeDateKey(nextMonth, today)).toBe('future')
  })

  it('still returns "today" for a future-time-of-day on the same local day', () => {
    // A txn dated "today" with an arbitrary time should not be classified as future.
    expect(relativeDateKey(new Date(2026, 4, 22, 23, 59), today)).toBe('today')
  })
})
