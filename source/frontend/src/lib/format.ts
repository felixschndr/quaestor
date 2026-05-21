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
