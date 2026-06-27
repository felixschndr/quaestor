'use client'

import { useState } from 'react'
import { CalendarIcon } from 'lucide-react'
import { de, enUS, type Locale } from 'date-fns/locale'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'
import { formatDate, formatDateShortWeekday } from '@/lib/format'
import { Calendar } from '@/components/ui/calendar'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  popoverTriggerClassName,
} from '@/components/ui/popover'

const LOCALES: Record<string, Locale> = { en: enUS, de }

export interface DatePickerProps {
  id?: string
  /** ISO yyyy-mm-dd (or empty string for "no date"). */
  value: string
  onChange: (next: string) => void
  placeholder?: string
  className?: string
  max?: string
}

/**
 * A button that opens a Popover with a Calendar. Mirrors the visual shape of
 * the Input component so it lines up with text/number fields in the same
 * grid. Values are exchanged as ISO yyyy-mm-dd strings — same wire format
 * as `<input type="date">` had — so the surrounding form state doesn't
 * need to know about Date objects.
 */
function DatePicker({ id, value, onChange, placeholder, className, max }: DatePickerProps) {
  const { i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const locale = LOCALES[i18n.language] ?? enUS
  const selected = value ? parseIsoDate(value) : undefined
  const maxDate = max ? parseIsoDate(max) : undefined

  const fullLabel = selected ? formatDate(selected) : (placeholder ?? '')
  const shortLabel = selected ? formatDateShortWeekday(selected) : (placeholder ?? '')

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        id={id}
        type="button"
        aria-label={fullLabel}
        onKeyDown={(event) => {
          // Arrow keys open the calendar too (on top of the default Enter/Space),
          // mirroring the native <input type="date"> affordance.
          if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
            event.preventDefault()
            setOpen(true)
          }
        }}
        className={cn(popoverTriggerClassName, !value && 'text-muted-foreground', className)}
      >
        <CalendarIcon className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
        {selected ? (
          <span className="truncate">
            <span className="sm:hidden">{shortLabel}</span>
            <span className="hidden sm:inline">{fullLabel}</span>
          </span>
        ) : (
          <span className="truncate">{fullLabel}</span>
        )}
      </PopoverTrigger>
      {/* Prevent the popover from focusing its first element (the prev-month
          chevron); `autoFocus` on the calendar focuses the selected day instead. */}
      <PopoverContent className="w-auto p-2" onOpenAutoFocus={(event) => event.preventDefault()}>
        <Calendar
          mode="single"
          // `required` keeps the current day selected when it's re-confirmed
          // (e.g. pressing Enter on it) instead of toggling it off and clearing.
          required
          autoFocus
          locale={locale}
          weekStartsOn={1}
          selected={selected}
          defaultMonth={selected}
          disabled={maxDate ? { after: maxDate } : undefined}
          onSelect={(date) => {
            onChange(date ? formatIsoDate(date) : '')
            setOpen(false)
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
