const DISPLAY_LOCALE = 'de-DE'

const eurFormatter = new Intl.NumberFormat(DISPLAY_LOCALE, {
  style: 'currency',
  currency: 'EUR',
})

const dateFormatter = new Intl.DateTimeFormat(DISPLAY_LOCALE, {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

const dateTimeFormatter = new Intl.DateTimeFormat(DISPLAY_LOCALE, {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

export function formatEuro(amount: number): string {
  return eurFormatter.format(amount)
}

export function formatDate(d: Date | string): string {
  return dateFormatter.format(typeof d === 'string' ? new Date(d) : d)
}

export function formatDateTime(d: Date | string): string {
  return dateTimeFormatter.format(typeof d === 'string' ? new Date(d) : d)
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
): 'today' | 'yesterday' | null {
  if (isSameLocalDay(date, today)) return 'today'
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  if (isSameLocalDay(date, yesterday)) return 'yesterday'
  return null
}
