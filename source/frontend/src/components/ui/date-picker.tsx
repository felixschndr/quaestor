'use client'

import { CalendarIcon } from 'lucide-react'
import { de, enUS, type Locale } from 'date-fns/locale'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'
import { formatDate } from '@/lib/format'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

const LOCALES: Record<string, Locale> = { en: enUS, de }

export interface DatePickerProps {
  id?: string
  /** ISO yyyy-mm-dd (or empty string for "no date"). */
  value: string
  onChange: (next: string) => void
  placeholder?: string
  className?: string
}

/**
 * A button that opens a Popover with a Calendar. Mirrors the visual shape of
 * the Input component so it lines up with text/number fields in the same
 * grid. Values are exchanged as ISO yyyy-mm-dd strings — same wire format
 * as `<input type="date">` had — so the surrounding form state doesn't
 * need to know about Date objects.
 */
function DatePicker({ id, value, onChange, placeholder, className }: DatePickerProps) {
  const { i18n } = useTranslation()
  const locale = LOCALES[i18n.language] ?? enUS
  const selected = value ? parseIsoDate(value) : undefined

  const label = selected ? formatDate(selected) : (placeholder ?? '')

  return (
    <Popover>
      <PopoverTrigger
        id={id}
        type="button"
        aria-label={label}
        className={cn(
          'border-input flex h-8 w-full min-w-0 items-center gap-2 rounded-lg border bg-transparent px-2.5 py-1 text-left text-sm transition-colors outline-none',
          'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-3',
          'aria-expanded:border-ring',
          'dark:bg-input/30',
          !value && 'text-muted-foreground',
          className,
        )}
      >
        <CalendarIcon className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{label}</span>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2">
        <Calendar
          mode="single"
          locale={locale}
          weekStartsOn={1}
          selected={selected}
          defaultMonth={selected}
          onSelect={(date) => {
            onChange(date ? formatIsoDate(date) : '')
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

function parseIsoDate(iso: string): Date | undefined {
  // Parse manually so that "2026-05-23" is treated as a local date, not as
  // UTC midnight (which `new Date("2026-05-23")` would do).
  const [year, month, day] = iso.split('-').map(Number)
  if (!year || !month || !day) return undefined
  return new Date(year, month - 1, day)
}

function formatIsoDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export { DatePicker }
