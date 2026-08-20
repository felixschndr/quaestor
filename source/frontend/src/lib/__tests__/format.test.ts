import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import {
  formatAmountForInput,
  formatMoney,
  formatDate,
  formatDateShortWeekdayWithoutYear,
  formatDateTime,
  formatIban,
  transactionPartyName,
  formatRelativeDateTime,
  relativeDateKey,
  setDisplayCurrency,
  setDisplayTimeZone,
  todayIso,
  wrapWithCurrency,
} from '../format'

describe('formatAmountForInput', () => {
  it.each([
    [1234.5, '1234,50'],
    [0, '0,00'],
    [-42, '-42,00'],
    [1.239, '1,24'],
  ])(
    'formats %d as %s (German comma, no thousands sep, rounded to two decimals)',
    (input, expected) => {
      expect(formatAmountForInput(input)).toBe(expected)
    },
  )
})

describe('todayIso', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('formats the current local date as YYYY-MM-DD', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 4, 20, 12, 0, 0))
    expect(todayIso()).toBe('2026-05-20')
  })

  it('zero-pads single-digit months and days', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 0, 9, 12, 0, 0))
    expect(todayIso()).toBe('2026-01-09')
  })
})

describe('formatMoney', () => {
  it('formats positive amounts in de-DE', () => {
    expect(formatMoney(1234.56)).toBe('1.234,56 €')
  })

  it('formats negative amounts with minus sign', () => {
    expect(formatMoney(-42)).toBe('-42,00 €')
  })
  it('formats the display currency in its own locale (symbol placement, grouping)', () => {
    setDisplayCurrency('USD')
    try {
      expect(formatMoney(1234.56)).toBe('$1,234.56')
    } finally {
      setDisplayCurrency('EUR') // module state is global; reset so later tests see the default.
    }
  })
})

describe('wrapWithCurrency', () => {
  it('suffixes the euro symbol (de-DE convention)', () => {
    expect(wrapWithCurrency('1,5M')).toBe('1,5M €')
  })

  it('prefixes the dollar symbol (en-US convention)', () => {
    setDisplayCurrency('USD')
    try {
      expect(wrapWithCurrency('1.5M')).toBe('$1.5M')
    } finally {
      setDisplayCurrency('EUR')
    }
  })
})

describe('formatDate', () => {
  it('formats an ISO date in long English form', () => {
    expect(formatDate('2026-05-20T12:00:00Z')).toMatch(/^Wednesday, May 20, 2026/)
  })

  it('pads a single-digit day with a leading zero', () => {
    expect(formatDate('2026-05-05T12:00:00Z')).toMatch(/May 05, 2026/)
  })

  it('prefixes the date with the weekday', () => {
    expect(formatDate('2026-05-20T12:00:00Z')).toMatch(/^Wednesday, /)
  })

  it('writes out a short weekday and long month without the year', () => {
    expect(formatDateShortWeekdayWithoutYear('2026-05-20T12:00:00Z')).toBe('Wed, May 20')
  })
})

describe('formatDateTime', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('de')
  })
  afterAll(async () => {
    setDisplayTimeZone('UTC')
    await i18n.changeLanguage('en')
  })

  it('renders a naive backend timestamp as UTC by default', () => {
    setDisplayTimeZone('UTC')
    expect(formatDateTime('2026-05-20T12:00:00')).toMatch(/20\. Mai 2026 um 12:00/)
  })

  it('converts a naive (UTC) timestamp into the configured display zone', () => {
    setDisplayTimeZone('Europe/Berlin')
    expect(formatDateTime('2026-05-20T12:00:00')).toMatch(/20\. Mai 2026 um 14:00/)
  })

  it('treats a timestamp that already carries a Z as UTC', () => {
    setDisplayTimeZone('Europe/Berlin')
    expect(formatDateTime('2026-05-20T12:00:00Z')).toMatch(/20\. Mai 2026 um 14:00/)
  })
})

describe('formatRelativeDateTime', () => {
  const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options)
  const now = new Date('2026-05-20T12:00:00Z')

  beforeAll(async () => {
    await i18n.changeLanguage('de')
  })
  afterAll(async () => {
    setDisplayTimeZone('UTC')
    await i18n.changeLanguage('en')
  })

  it.each([
    ['2026-05-20T08:30:00Z', 'Heute um 08:30 Uhr'],
    ['2026-05-19T23:00:00Z', 'Gestern um 23:00 Uhr'],
    ['2026-05-18T09:15:00Z', 'Vorgestern um 09:15 Uhr'],
  ])('labels %s as %s in the UTC display zone', (iso, expected) => {
    setDisplayTimeZone('UTC')
    expect(formatRelativeDateTime(iso, t, now)).toBe(expected)
  })

  it('falls back to a full weekday without the year for older timestamps', () => {
    setDisplayTimeZone('UTC')
    expect(formatRelativeDateTime('2026-05-10T08:30:00Z', t, now)).toBe(
      'Sonntag, 10. Mai um 08:30 Uhr',
    )
  })

  it('classifies the day and renders the time in the configured display zone', () => {
    // 22:30 UTC on the 19th is 00:30 on the 20th in Berlin. Relative to 14:00
    // Berlin on the 20th that is the *same* day ("today"), whereas in UTC it
    // would be "yesterday" — proving the zone shifts day and time together.
    setDisplayTimeZone('Europe/Berlin')
    expect(formatRelativeDateTime('2026-05-19T22:30:00Z', t, now)).toBe('Heute um 00:30 Uhr')
  })
})

describe('formatIban', () => {
  it.each([
    ['DE89370400440532013000', 'DE89 3704 0044 0532 0130 00'],
    ['DE89 3704 0044 0532 0130 00', 'DE89 3704 0044 0532 0130 00'],
    ['NO9386011117947', 'NO93 8601 1117 947'],
    ['not an iban', 'not an iban'],
    ['', ''],
    ['DE82 Example GmbH', 'DE82 Example GmbH'],
    ['de89370400440532013000', 'de89370400440532013000'],
  ])('formatIban(%j) → %j', (input, expected) => {
    expect(formatIban(input)).toBe(expected)
  })
})

describe('transactionPartyName', () => {
  it('uses the other party when present', () => {
    expect(transactionPartyName({ other_party: 'Alice', purpose: 'rent' })).toBe('Alice')
  })

  it('formats an IBAN other party', () => {
    expect(transactionPartyName({ other_party: 'DE89370400440532013000' })).toBe(
      'DE89 3704 0044 0532 0130 00',
    )
  })

  it('falls back to the purpose when the other party is missing (e.g. savings plans)', () => {
    expect(transactionPartyName({ other_party: null, purpose: 'Sparplan' })).toBe('Sparplan')
    expect(transactionPartyName({ other_party: '  ', purpose: 'Sparplan' })).toBe('Sparplan')
  })

  it('returns an empty string when neither is set, leaving the fallback to the caller', () => {
    expect(transactionPartyName({ other_party: null, purpose: null })).toBe('')
  })
})

describe('relativeDateKey', () => {
  const today = new Date(2026, 4, 22) // May 22, 2026, local midnight
  const yesterday = new Date(2026, 4, 21)
  const older = new Date(2026, 4, 20)

  it.each([
    [new Date(2026, 4, 22, 14, 30), today, 'today'],
    [yesterday, today, 'yesterday'],
    [new Date(2026, 4, 20), today, 'dayBeforeYesterday'],
    [new Date(2026, 4, 19), today, null],
    [older, new Date(2026, 4, 23), null],
    [new Date(2026, 4, 23), today, 'tomorrow'],
    [new Date(2026, 4, 24), today, 'dayAfterTomorrow'],
    [new Date(2026, 4, 25), today, 'future'],
    [new Date(2026, 5, 1), today, 'future'],
    [new Date(2026, 3, 30), new Date(2026, 4, 1), 'yesterday'],
    [new Date(2026, 4, 22, 23, 59), today, 'today'],
  ])('classifies %s relative to %s as %s', (date, reference, expected) => {
    expect(relativeDateKey(date, reference)).toBe(expected)
  })
})
