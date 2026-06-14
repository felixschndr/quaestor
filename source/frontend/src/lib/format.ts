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

// Date formatters depend on the user's active UI language (i18next), so weekday
// and month names follow whatever language is selected — not a fixed German
// locale. Formatters are cached per locale (and, for datetimes, per display
// zone) because constructing an `Intl.DateTimeFormat` is comparatively
// expensive.
const dateFormatters = new Map<string, Intl.DateTimeFormat>()
const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>()

function getDateFormatter(
  cache: Map<string, Intl.DateTimeFormat>,
  options: Intl.DateTimeFormatOptions,
  timeZone?: string,
): Intl.DateTimeFormat {
  const locale = i18n.language || i18n.options.fallbackLng?.toString() || 'en'
  const key = timeZone ? `${locale}|${timeZone}` : locale
  let formatter = cache.get(key)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, timeZone ? { ...options, timeZone } : options)
    cache.set(key, formatter)
  }
  return formatter
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

// Today's date as a local-time YYYY-MM-DD string, suitable for a date input's value.
export function todayIso(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
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
  return getDateFormatter(dateFormatters, DATE_OPTIONS).format(
    typeof d === 'string' ? new Date(d) : d,
  )
}

const DATE_SHORT_WEEKDAY_OPTIONS: Intl.DateTimeFormatOptions = { ...DATE_OPTIONS, weekday: 'short' }
const shortWeekdayDateFormatters = new Map<string, Intl.DateTimeFormat>()

export function formatDateShortWeekday(d: Date | string): string {
  return getDateFormatter(shortWeekdayDateFormatters, DATE_SHORT_WEEKDAY_OPTIONS).format(
    typeof d === 'string' ? new Date(d) : d,
  )
}

const DATE_NO_YEAR_OPTIONS: Intl.DateTimeFormatOptions = { ...DATE_OPTIONS, year: undefined }
const noYearDateFormatters = new Map<string, Intl.DateTimeFormat>()

export function formatDateWithoutYear(d: Date | string): string {
  return getDateFormatter(noYearDateFormatters, DATE_NO_YEAR_OPTIONS).format(
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
  return getDateFormatter(dateTimeFormatters, DATE_TIME_OPTIONS, displayTimeZone).format(
    parseTimestamp(d),
  )
}

/**
 * Treats two `Date`s as the same day if their local year/month/date match.
 * `Date.toDateString()` collapses to ISO-month/day in the local zone, which is
 * exactly what the account view needs when grouping transactions.
 */
function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/**
 * Returns the i18n key (or a translated label, depending on context) for a
 * date relative to `today`. Caller is expected to translate the returned key
 * via i18next. For older dates, returns null so the caller can fall back to
 * `formatDate`.
 */
export function relativeDateKey(
  date: Date,
  today: Date = new Date(),
): 'future' | 'today' | 'yesterday' | 'tomorrow' | 'dayAfterTomorrow' | null {
  if (isSameLocalDay(date, today)) return 'today'
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  if (isSameLocalDay(date, yesterday)) return 'yesterday'
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  if (isSameLocalDay(date, tomorrow)) return 'tomorrow'
  const dayAfterTomorrow = new Date(today)
  dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2)
  if (isSameLocalDay(date, dayAfterTomorrow)) return 'dayAfterTomorrow'
  const startOfDayAfterTomorrow = new Date(today)
  startOfDayAfterTomorrow.setHours(0, 0, 0, 0)
  startOfDayAfterTomorrow.setDate(startOfDayAfterTomorrow.getDate() + 3)
  if (date.getTime() >= startOfDayAfterTomorrow.getTime()) return 'future'
  return null
}
