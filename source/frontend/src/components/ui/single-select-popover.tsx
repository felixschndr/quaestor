'use client'

import { useCallback, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'

import { cn } from '@/lib/utils'
import { usePopoverScroll } from '@/lib/use-popover-scroll'
import { matchesQuery, PopoverSearchInput } from '@/components/ui/popover-search-input'
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
  searchPlaceholder?: string
  disabled?: boolean
  className?: string
  width?: 'full' | 'content'
  align?: 'start' | 'end'
}

export function SingleSelectPopover<T extends string>({
  id,
  ariaLabel,
  options,
  value,
  onChange,
  placeholder,
  searchPlaceholder,
  disabled,
  className,
  width = 'full',
  align = 'start',
}: SingleSelectPopoverProps<T>) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const scrollRef = usePopoverScroll<HTMLUListElement>()
  const listRef = useCallback(
    (node: HTMLUListElement | null) => {
      scrollRef(node)
      const row = node?.querySelector<HTMLElement>('[data-selected]')
      if (node && row) node.scrollTop = row.offsetTop - (node.clientHeight - row.offsetHeight) / 2
    },
    [scrollRef],
  )
  const selected = options.find((option) => option.value === value) ?? null
  const visibleOptions = query
    ? options.filter((option) => matchesQuery(option.label, query))
    : options

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setQuery('')
      }}
    >
      <PopoverTrigger
        id={id}
        type="button"
        aria-label={ariaLabel}
        disabled={disabled}
        className={cn(
          popoverTriggerClassName,
          'justify-between disabled:pointer-events-none disabled:opacity-50',
          width === 'content' && 'w-auto gap-3 px-3',
          className,
        )}
      >
        <span
          className={cn(
            'flex items-center gap-2',
            width === 'content' ? 'min-w-0' : 'min-w-0 truncate',
            !selected && 'text-muted-foreground',
          )}
        >
          {selected?.leading}
          {width === 'content' ? (
            <span className="grid">
              {options.map((option) => (
                <span
                  key={option.value}
                  aria-hidden={option.value !== value || undefined}
                  className={cn(
                    'col-start-1 row-start-1 whitespace-nowrap',
                    option.value !== value && 'invisible',
                  )}
                >
                  {option.label}
                </span>
              ))}
              {!selected ? (
                <span className="col-start-1 row-start-1 whitespace-nowrap">
                  {placeholder ?? ''}
                </span>
              ) : null}
            </span>
          ) : (
            <span className="truncate">{selected ? selected.label : (placeholder ?? '')}</span>
          )}
        </span>
        <ChevronDown className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent
        align={align}
        className={cn(
          'max-w-[calc(100vw-1rem)] p-0',
          width === 'content'
            ? 'w-auto min-w-[var(--radix-popover-trigger-width)]'
            : 'w-[var(--radix-popover-trigger-width)]',
        )}
        onKeyDown={handleSelectListArrowKeys}
      >
        {searchPlaceholder ? (
          <PopoverSearchInput
            value={query}
            placeholder={searchPlaceholder}
            onChange={setQuery}
            bordered={visibleOptions.length > 0}
          />
        ) : null}
        <ul
          ref={listRef}
          aria-label={ariaLabel}
          className="relative max-h-72 overflow-y-auto overscroll-contain p-1"
        >
          {visibleOptions.map((option) => (
            <li key={option.value}>
              <button
                type="button"
                data-select-row=""
                data-selected={option.value === value ? '' : undefined}
                onClick={() => {
                  onChange(option.value)
                  setOpen(false)
                }}
                className="hover:bg-muted/60 focus-visible:bg-muted/60 flex w-full cursor-pointer items-center gap-3 rounded-md px-2 py-3 text-left text-sm outline-none"
              >
                {option.leading}
                <span
                  className={cn('flex-1', width === 'content' ? 'whitespace-nowrap' : 'truncate')}
                >
                  {option.label}
                </span>
                <Check
                  className={cn(
                    'text-primary size-4 shrink-0',
                    option.value !== value && 'invisible',
                  )}
                  aria-hidden="true"
                />
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
