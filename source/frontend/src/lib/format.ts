import i18n from '@/i18n'

const DISPLAY_LOCALE = 'de-DE'

let displayCurrency = 'EUR'
const moneyFormatters = new Map<string, Intl.NumberFormat>()

const CURRENCY_LOCALES: Record<string, string> = {
  EUR: 'de-DE',
  USD: 'en-US',
  GBP: 'en-GB',
  CHF: 'de-CH',
  JPY: 'ja-JP',
  CAD: 'en-CA',
  AUD: 'en-AU',
}

function moneyFormatter(currency: string): Intl.NumberFormat {
  let formatter = moneyFormatters.get(currency)
  if (!formatter) {
    formatter = new Intl.NumberFormat(CURRENCY_LOCALES[currency] ?? DISPLAY_LOCALE, {
      style: 'currency',
      currency,
    })
    moneyFormatters.set(currency, formatter)
  }
  return formatter
}

export function setDisplayCurrency(currency: string): void {
  displayCurrency = currency
}

export function wrapWithCurrency(text: string): string {
  const parts = moneyFormatter(displayCurrency).formatToParts(0)
  const symbol = parts.find((p) => p.type === 'currency')?.value ?? displayCurrency
  const currencyIndex = parts.findIndex((p) => p.type === 'currency')
  const numberIndex = parts.findIndex((p) => p.type === 'integer')
  return currencyIndex < numberIndex ? `${symbol}${text}` : `${text} ${symbol}`
}

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

export function formatMoney(amount: number): string {
  return moneyFormatter(displayCurrency).format(amount)
}

const decimalFormatter = new Intl.NumberFormat(DISPLAY_LOCALE, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function formatDecimal(value: number): string {
  return decimalFormatter.format(value)
}

const monthsFormatter = new Intl.NumberFormat(DISPLAY_LOCALE, {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

export function formatMonths(value: number): string {
  return monthsFormatter.format(value)
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

const wholePercentFormatter = new Intl.NumberFormat(DISPLAY_LOCALE, {
  style: 'percent',
  maximumFractionDigits: 0,
})

export function formatPercent(ratio: number, whole = false): string {
  return (whole ? wholePercentFormatter : percentFormatter).format(ratio)
}

function formatWith(d: Date | string, overrides?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(activeLocale(), { ...DATE_OPTIONS, ...overrides }).format(
    typeof d === 'string' ? new Date(d) : d,
  )
}

export function formatDate(d: Date | string): string {
  return formatWith(d)
}

export function formatDateShortWeekday(d: Date | string): string {
  return formatWith(d, { weekday: 'short' })
}

export function formatDateWithoutYear(d: Date | string): string {
  return formatWith(d, { year: undefined })
}

const IBAN_PATTERN = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/

export function formatIban(value: string): string {
  const compact = value.replace(/\s+/g, '')
  if (!IBAN_PATTERN.test(compact)) return value
  return compact.match(/.{1,4}/g)!.join(' ')
}

export function transactionPartyName(transaction: {
  other_party?: string | null
  purpose?: string | null
}): string {
  return formatIban(transaction.other_party?.trim() || '') || transaction.purpose?.trim() || ''
}

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
