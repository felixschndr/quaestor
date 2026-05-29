import i18n from '@/i18n'

const DISPLAY_LOCALE = 'de-DE'

const eurFormatter = new Intl.NumberFormat(DISPLAY_LOCALE, {
  style: 'currency',
  currency: 'EUR',
})

const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
}

const DATE_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  ...DATE_OPTIONS,
  hour: '2-digit',
  minute: '2-digit',
}

// Date formatters depend on the user's active UI language (i18next), so weekday
// and month names follow whatever language is selected — not a fixed German
// locale. Formatters are cached per locale because constructing an
// `Intl.DateTimeFormat` is comparatively expensive.
const dateFormatters = new Map<string, Intl.DateTimeFormat>()
const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>()

function getDateFormatter(
  cache: Map<string, Intl.DateTimeFormat>,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const locale = i18n.language || i18n.options.fallbackLng?.toString() || 'en'
  let formatter = cache.get(locale)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options)
    cache.set(locale, formatter)
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

export function formatDate(d: Date | string): string {
  return getDateFormatter(dateFormatters, DATE_OPTIONS).format(
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

export function formatDateTime(d: Date | string): string {
  return getDateFormatter(dateTimeFormatters, DATE_TIME_OPTIONS).format(
    typeof d === 'string' ? new Date(d) : d,
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
