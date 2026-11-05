'use client'

import * as React from 'react'
import { DayPicker } from 'react-day-picker'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'

export type CalendarProps = React.ComponentProps<typeof DayPicker>

function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  return (
    <DayPicker
      data-slot="calendar"
      showOutsideDays={showOutsideDays}
      className={cn('p-1', className)}
      classNames={{
        // `relative` on the months container so the absolute-positioned nav
        // below has a positioning context. Otherwise the prev/next buttons
        // anchor to the page and the visible chevrons no longer overlap
        // their real click targets — they look right but do nothing.
        months: 'relative flex flex-col gap-4',
        month: 'flex flex-col gap-3',
        // Same height as the prev/next buttons (size-7) so the caption sits level with them.
        month_caption: 'flex h-7 justify-center items-center',
        // In dropdown mode the label carries a chevron; hidden so the caption reads as plain text.
        caption_label: 'text-primary text-sm leading-none font-medium [&>svg]:hidden',
        // captionLayout="dropdown": the native <select> sits invisibly on top of the caption label, so
        // the caption looks like text but opens the platform's month/year picker on click.
        dropdowns: 'flex items-center gap-2',
        dropdown_root: 'relative flex h-7 items-center rounded-md px-1 hover:bg-muted',
        dropdown: 'absolute inset-0 cursor-pointer opacity-0',
        // The nav spans the full width above the caption: let clicks through to the month/year
        // dropdowns in between, only the prev/next buttons themselves take them.
        nav: 'pointer-events-none absolute inset-x-1 top-0 z-10 flex items-center justify-between [&>button]:pointer-events-auto',
        button_previous: cn(
          buttonVariants({ variant: 'ghost', size: 'icon-sm' }),
          'text-primary hover:text-primary size-7 p-0',
        ),
        button_next: cn(
          buttonVariants({ variant: 'ghost', size: 'icon-sm' }),
          'text-primary hover:text-primary size-7 p-0',
        ),
        month_grid: 'w-full border-collapse',
        weekdays: 'flex',
        weekday:
          'text-muted-foreground select-none rounded-md w-8 font-normal text-[0.75rem] uppercase tracking-wide',
        week: 'flex w-full mt-1',
        day: 'h-8 w-8 text-center text-sm p-0 relative focus-within:relative focus-within:z-20',
        day_button: cn(
          buttonVariants({ variant: 'ghost', size: 'icon-sm' }),
          'size-8 p-0 font-normal aria-selected:opacity-100',
        ),
        selected:
          '[&_button]:bg-primary [&_button]:text-primary-foreground [&_button:hover]:bg-primary [&_button:hover]:text-primary-foreground',
        today: '[&_button]:text-primary [&_button]:font-semibold',
        outside: 'text-muted-foreground/50 aria-selected:text-muted-foreground',
        disabled: 'text-muted-foreground opacity-40',
        hidden: 'invisible',
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, ...rest }) =>
          orientation === 'left' ? (
            <ChevronLeft className="size-4" {...rest} />
          ) : (
            <ChevronRight className="size-4" {...rest} />
          ),
      }}
      {...props}
    />
  )
}

export { Calendar }
