import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import {
  formatAmountForInput,
  formatEuro,
  formatDate,
  formatDateTime,
  formatIban,
  formatRelativeDateTime,
  relativeDateKey,
  setDisplayTimeZone,
  todayIso,
} from '../format'

describe('formatAmountForInput', () => {
  it('renders two decimals with a German comma and no thousands separator', () => {
    expect(formatAmountForInput(1234.5)).toBe('1234,50')
  })

  it('formats zero', () => {
    expect(formatAmountForInput(0)).toBe('0,00')
  })

  it('formats negative values with a minus sign', () => {
    expect(formatAmountForInput(-42)).toBe('-42,00')
  })

  it('rounds to two decimals', () => {
    expect(formatAmountForInput(1.239)).toBe('1,24')
  })
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

describe('formatEuro', () => {
  it('formats positive amounts in de-DE', () => {
    expect(formatEuro(1234.56)).toBe('1.234,56 €')
  })

  it('formats negative amounts with minus sign', () => {
    expect(formatEuro(-42)).toBe('-42,00 €')
  })
})

describe('formatDate', () => {
  // formatDate follows the active i18next language; restore the default
  // afterwards so language state doesn't leak into other test files.
  afterAll(async () => {
    await i18n.changeLanguage('en')
  })

  it('formats an ISO date in long German form when the language is German', async () => {
    await i18n.changeLanguage('de')
    expect(formatDate('2026-05-20T12:00:00Z')).toMatch(/20\. Mai 2026/)
  })

  it('pads a single-digit day with a leading zero', async () => {
    await i18n.changeLanguage('de')
    expect(formatDate('2026-05-05T12:00:00Z')).toMatch(/05\. Mai 2026/)
  })

  it('prefixes the date with the weekday in German', async () => {
    await i18n.changeLanguage('de')
    // 2026-05-20 is a Wednesday → Mittwoch.
    expect(formatDate('2026-05-20T12:00:00Z')).toMatch(/^Mittwoch, /)
  })

  it('formats the same date in long English form when the language is English', async () => {
    await i18n.changeLanguage('en')
    // 2026-05-20 is a Wednesday → "Wednesday, May 20, 2026".
    expect(formatDate('2026-05-20T12:00:00Z')).toMatch(/^Wednesday, May 20, 2026/)
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

  it('labels the same calendar day as "today" with the time', () => {
    setDisplayTimeZone('UTC')
    expect(formatRelativeDateTime('2026-05-20T08:30:00Z', t, now)).toBe('Heute um 08:30 Uhr')
  })

  it('labels the previous calendar day as "yesterday"', () => {
    setDisplayTimeZone('UTC')
    expect(formatRelativeDateTime('2026-05-19T23:00:00Z', t, now)).toBe('Gestern um 23:00 Uhr')
  })

  it('labels two calendar days ago as "the day before yesterday"', () => {
    setDisplayTimeZone('UTC')
    expect(formatRelativeDateTime('2026-05-18T09:15:00Z', t, now)).toBe('Vorgestern um 09:15 Uhr')
  })

  it('falls back to the full long date for older timestamps', () => {
    setDisplayTimeZone('UTC')
    expect(formatRelativeDateTime('2026-05-10T08:30:00Z', t, now)).toMatch(
      /10\. Mai 2026 um 08:30 Uhr/,
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

  it('returns "dayBeforeYesterday" for two local days ago', () => {
    expect(relativeDateKey(new Date(2026, 4, 20), today)).toBe('dayBeforeYesterday')
  })

  it('returns null for dates older than the day before yesterday', () => {
    expect(relativeDateKey(new Date(2026, 4, 19), today)).toBeNull()
    expect(relativeDateKey(older, new Date(2026, 4, 23))).toBeNull()
  })

  it('handles month boundaries correctly', () => {
    const may1 = new Date(2026, 4, 1)
    const apr30 = new Date(2026, 3, 30)
    expect(relativeDateKey(apr30, may1)).toBe('yesterday')
  })

  it('returns "tomorrow" for the day immediately after today', () => {
    const tomorrow = new Date(2026, 4, 23)
    expect(relativeDateKey(tomorrow, today)).toBe('tomorrow')
  })

  it('returns "dayAfterTomorrow" for two days after today', () => {
    const dayAfter = new Date(2026, 4, 24)
    expect(relativeDateKey(dayAfter, today)).toBe('dayAfterTomorrow')
  })

  it('returns "future" for any date three or more days after today', () => {
    const threeDaysOut = new Date(2026, 4, 25)
    const nextMonth = new Date(2026, 5, 1)
    expect(relativeDateKey(threeDaysOut, today)).toBe('future')
    expect(relativeDateKey(nextMonth, today)).toBe('future')
  })

  it('still returns "today" for a future-time-of-day on the same local day', () => {
    // A txn dated "today" with an arbitrary time should not be classified as future.
    expect(relativeDateKey(new Date(2026, 4, 22, 23, 59), today)).toBe('today')
  })
})
