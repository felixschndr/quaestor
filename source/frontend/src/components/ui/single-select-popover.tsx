'use client'

import { useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'

import { cn } from '@/lib/utils'
import { usePopoverScroll } from '@/lib/use-popover-scroll'
import { handleSelectListArrowKeys } from '@/components/ui/select-list-keyboard'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  popoverTriggerClassName,
} from '@/components/ui/popover'

export interface SingleSelectOption<T extends string> {
  value: T
  label: string
  leading?: React.ReactNode
}

export interface SingleSelectPopoverProps<T extends string> {
  id?: string
  ariaLabel: string
  options: SingleSelectOption<T>[]
  value: T
  onChange: (next: T) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}

export function SingleSelectPopover<T extends string>({
  id,
  ariaLabel,
  options,
  value,
  onChange,
  placeholder,
  disabled,
  className,
}: SingleSelectPopoverProps<T>) {
  const [open, setOpen] = useState(false)
  const listRef = usePopoverScroll<HTMLUListElement>()
  const selected = options.find((option) => option.value === value) ?? null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        id={id}
        type="button"
        aria-label={ariaLabel}
        disabled={disabled}
        className={cn(
          popoverTriggerClassName,
          'justify-between disabled:pointer-events-none disabled:opacity-50',
          className,
        )}
      >
        <span
          className={cn(
            'flex min-w-0 items-center gap-2 truncate',
            !selected && 'text-muted-foreground',
          )}
        >
          {selected?.leading}
          <span className="truncate">{selected ? selected.label : (placeholder ?? '')}</span>
        </span>
        <ChevronDown className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-1rem)] p-0"
        onKeyDown={handleSelectListArrowKeys}
      >
        <ul
          ref={listRef}
          aria-label={ariaLabel}
          className="max-h-72 overflow-y-auto overscroll-contain p-1"
        >
          {options.map((option) => (
            <li key={option.value}>
              <button
                type="button"
                data-select-row=""
                onClick={() => {
                  onChange(option.value)
                  setOpen(false)
                }}
                className="hover:bg-muted/60 focus-visible:bg-muted/60 flex w-full cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-left text-sm outline-none"
              >
                {option.leading}
                <span className="flex-1 truncate">{option.label}</span>
                {option.value === value ? (
                  <Check className="text-primary size-4 shrink-0" aria-hidden="true" />
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
