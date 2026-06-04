import { de, enUS, type Locale } from 'date-fns/locale'
import { format } from 'date-fns'
import { useTranslation } from 'react-i18next'

import { formatEuro } from '@/lib/format'

const LOCALES: Record<string, Locale> = { en: enUS, de }

/**
 * Euro formatter tolerant of recharts' loosely-typed tick/tooltip callback
 * values (which may be string | number | undefined). Coerces to a number first.
 */
export const euroFormat = (value: unknown): string => formatEuro(Number(value))

/**
 * Returns a formatter that turns a "YYYY-MM" month key into a short, localized
 * axis label like "Apr. 26". Bound to the active i18n language.
 */
export function useMonthLabel(): (month: string) => string {
  const { i18n } = useTranslation()
  const locale = LOCALES[i18n.language] ?? enUS
  return (month: string) => {
    const [year, monthNumber] = month.split('-').map(Number)
    if (!year || !monthNumber) return month
    return format(new Date(year, monthNumber - 1, 1), 'MMM yy', { locale })
  }
}

// Recharts renders into raw SVG/HTML, so it can't pick up Tailwind classes on
// its internals. Feed it the theme CSS variables directly so tooltips and axes
// track light/dark mode.
export const TOOLTIP_STYLE = {
  background: 'var(--color-popover)',
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  color: 'var(--color-popover-foreground)',
  fontSize: 12,
} as const

export const TOOLTIP_LABEL_STYLE = { color: 'var(--color-muted-foreground)' } as const

// Axis ticks and legend use the full-contrast foreground (white in dark mode,
// near-black in light mode) rather than the muted gray, so labels stay legible.
export const AXIS_TICK = { fill: 'var(--color-foreground)', fontSize: 11 } as const

export const LEGEND_STYLE = { fontSize: 12, color: 'var(--color-foreground)' } as const
