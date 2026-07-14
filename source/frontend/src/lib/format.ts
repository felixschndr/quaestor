import i18n from '@/i18n'

const DISPLAY_LOCALE = 'de-DE'

const eurFormatter = new Intl.NumberFormat(DISPLAY_LOCALE, {
  style: 'currency',
  currency: 'EUR',
})

const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  weekday: 'long',
  day: '2-digit',
  month: 'long',
  year: 'numeric',
}

const DATE_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  ...DATE_OPTIONS,
  hour: '2-digit',
  minute: '2-digit',
}

let displayTimeZone = 'UTC'

export function setDisplayTimeZone(timeZone: string): void {
  displayTimeZone = timeZone
}

const HAS_TIMEZONE_DESIGNATOR = /[zZ]|[+-]\d{2}:?\d{2}$/

function parseTimestamp(d: Date | string): Date {
  if (typeof d !== 'string') return d
  if (d.includes('T') && !HAS_TIMEZONE_DESIGNATOR.test(d)) return new Date(`${d}Z`)
  return new Date(d)
}

function activeLocale(): string {
  return i18n.language || i18n.options.fallbackLng?.toString() || 'en'
}

export function formatEuro(amount: number): string {
  return eurFormatter.format(amount)
}

const decimalFormatter = new Intl.NumberFormat(DISPLAY_LOCALE, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function formatDecimal(value: number): string {
  return decimalFormatter.format(value)
}

const factorMultiplierFormatter = new Intl.NumberFormat(DISPLAY_LOCALE, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
})

export function formatFactorMultiplier(value: number): string {
  return factorMultiplierFormatter.format(value)
}

const inputAmountFormatter = new Intl.NumberFormat(DISPLAY_LOCALE, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: false,
})

// Renders an amount for editing inside a text input: two decimals, no thousands
// separators (so the value round-trips through the form without reformatting).
export function formatAmountForInput(value: number): string {
  return inputAmountFormatter.format(value)
}

// Today's date as a local-time YYYY-MM-DD string, suitable for a date input's
// value. en-CA's date format happens to be exactly ISO 8601.
export function todayIso(): string {
  return new Date().toLocaleDateString('en-CA')
}

const percentFormatter = new Intl.NumberFormat(DISPLAY_LOCALE, {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

export function formatPercent(ratio: number): string {
  return percentFormatter.format(ratio)
}

export function formatDate(d: Date | string): string {
  return new Intl.DateTimeFormat(activeLocale(), DATE_OPTIONS).format(
    typeof d === 'string' ? new Date(d) : d,
  )
}

export function formatDateShortWeekday(d: Date | string): string {
  return new Intl.DateTimeFormat(activeLocale(), { ...DATE_OPTIONS, weekday: 'short' }).format(
    typeof d === 'string' ? new Date(d) : d,
  )
}

export function formatDateWithoutYear(d: Date | string): string {
  return new Intl.DateTimeFormat(activeLocale(), { ...DATE_OPTIONS, year: undefined }).format(
    typeof d === 'string' ? new Date(d) : d,
  )
}

const IBAN_PATTERN = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/

/**
 * If `value` is an IBAN (country code + checksum + 11–30 uppercase alnum,
 * total length 15–34), return it in canonical 4-char groups separated by
 * spaces. Otherwise return `value` untouched — important for freeform fields
 * like `other_party`, which may incidentally start with two letters but be a
 * name, not an IBAN.
 */
export function formatIban(value: string): string {
  const compact = value.replace(/\s+/g, '')
  if (!IBAN_PATTERN.test(compact)) return value
  return compact.match(/.{1,4}/g)!.join(' ')
}

/** Whether `value` is an IBAN (see {@link formatIban}), ignoring whitespace. */
export function isIban(value: string): boolean {
  return IBAN_PATTERN.test(value.replace(/\s+/g, ''))
}

export function formatDateTime(d: Date | string): string {
  return new Intl.DateTimeFormat(activeLocale(), {
    ...DATE_TIME_OPTIONS,
    timeZone: displayTimeZone,
  }).format(parseTimestamp(d))
}

function formatTime(d: Date): string {
  return new Intl.DateTimeFormat(activeLocale(), {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: displayTimeZone,
  }).format(d)
}

const RUNTIME_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

function zonedDayStartUtc(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const value = (type: string) => Number(parts.find((part) => part.type === type)!.value)
  return Date.UTC(value('year'), value('month') - 1, value('day'))
}

export function relativeDateKey(
  date: Date,
  today: Date = new Date(),
  timeZone: string = RUNTIME_TIME_ZONE,
):
  | 'future'
  | 'today'
  | 'yesterday'
  | 'dayBeforeYesterday'
  | 'tomorrow'
  | 'dayAfterTomorrow'
  | null {
  const diffDays = Math.round(
    (zonedDayStartUtc(date, timeZone) - zonedDayStartUtc(today, timeZone)) / 86_400_000,
  )
  if (diffDays === 0) return 'today'
  if (diffDays === -1) return 'yesterday'
  if (diffDays === -2) return 'dayBeforeYesterday'
  if (diffDays === 1) return 'tomorrow'
  if (diffDays === 2) return 'dayAfterTomorrow'
  if (diffDays >= 3) return 'future'
  return null
}

export function formatRelativeDateTime(
  d: Date | string,
  t: (key: string, options?: Record<string, unknown>) => string,
  now: Date = new Date(),
): string {
  const date = parseTimestamp(d)
  const relativeKey = relativeDateKey(date, now, displayTimeZone)
  const dayLabel =
    relativeKey === 'today' || relativeKey === 'yesterday' || relativeKey === 'dayBeforeYesterday'
      ? t(`account.${relativeKey}`)
      : new Intl.DateTimeFormat(activeLocale(), {
          ...DATE_OPTIONS,
          timeZone: displayTimeZone,
        }).format(date)
  // The day/time connector is locale-specific ("um … Uhr" in German, "at …" in
  // English), so it lives in a translation template rather than a literal join.
  return t('account.dateTimeAt', { day: dayLabel, time: formatTime(date) })
}
