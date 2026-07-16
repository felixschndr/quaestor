'use client'

import { useState } from 'react'
import { CalendarIcon } from 'lucide-react'

import { cn } from '@/lib/utils'
import { formatDate, formatDateShortWeekday } from '@/lib/format'
import { Calendar } from '@/components/ui/calendar'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  popoverTriggerClassName,
} from '@/components/ui/popover'
import { useDateFnsLocale } from '@/components/stats/chartTheme'
import { format, isValid, parseISO } from 'date-fns'

export interface DatePickerProps {
  id?: string
  /** ISO yyyy-mm-dd (or empty string for "no date"). */
  value: string
  onChange: (next: string) => void
  placeholder?: string
  className?: string
  max?: string
}

function DatePicker({ id, value, onChange, placeholder, className, max }: DatePickerProps) {
  const [open, setOpen] = useState(false)
  const locale = useDateFnsLocale()
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
  const parsed = parseISO(iso)
  return isValid(parsed) ? parsed : undefined
}

const formatIsoDate = (date: Date): string => format(date, 'yyyy-MM-dd')

export { DatePicker }
