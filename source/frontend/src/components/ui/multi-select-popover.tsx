'use client'

import { useState } from 'react'
import { ChevronDown, Search } from 'lucide-react'

import { cn } from '@/lib/utils'
import { usePopoverScroll } from '@/lib/use-popover-scroll'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { handleSelectListArrowKeys } from '@/components/ui/select-list-keyboard'
import { SelectAllHeader } from '@/components/ui/select-all-header'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  popoverTriggerClassName,
} from '@/components/ui/popover'

export interface MultiSelectOption<T extends string> {
  value: T
  label: string
  leading?: React.ReactNode
}

export interface MultiSelectPopoverProps<T extends string> {
  id?: string
  ariaLabel: string
  options: MultiSelectOption<T>[]
  selected: T[]
  onChange: (next: T[]) => void
  triggerLabel: string
  selectAll?: { all: string; none: string; count: (selectedCount: number) => string }
  searchPlaceholder?: string
  checkboxIdPrefix: string
  className?: string
}

export function MultiSelectPopover<T extends string>({
  id,
  ariaLabel,
  options,
  selected,
  onChange,
  triggerLabel,
  selectAll,
  searchPlaceholder,
  checkboxIdPrefix,
  className,
}: MultiSelectPopoverProps<T>) {
  const listRef = usePopoverScroll<HTMLUListElement>()
  const [query, setQuery] = useState('')
  const selectedSet = new Set(selected)
  const selectedCount = selected.length
  const visibleOptions = query
    ? options.filter((option) => option.label.toLowerCase().includes(query.toLowerCase()))
    : options

  const toggle = (value: T) => {
    const next = new Set(selectedSet)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    onChange(options.map((option) => option.value).filter((value) => next.has(value)))
  }

  return (
    <Popover onOpenChange={(open) => open || setQuery('')}>
      <PopoverTrigger
        id={id}
        type="button"
        aria-label={ariaLabel}
        className={cn(popoverTriggerClassName, 'justify-between', className)}
      >
        <span className={cn('truncate', selectedCount === 0 && 'text-destructive')}>
          {triggerLabel}
        </span>
        <ChevronDown className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-1rem)] p-0"
        onKeyDown={handleSelectListArrowKeys}
      >
        {selectAll ? (
          <SelectAllHeader
            countLabel={selectAll.count(selectedCount)}
            allLabel={selectAll.all}
            noneLabel={selectAll.none}
            onAll={() => onChange(options.map((option) => option.value))}
            onNone={() => onChange([])}
          />
        ) : null}
        {searchPlaceholder ? (
          <div
            className={cn('border-border/40 relative p-2', visibleOptions.length > 0 && 'border-b')}
          >
            <Search
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2"
              aria-hidden="true"
            />
            <Input
              type="search"
              inputMode="search"
              value={query}
              placeholder={searchPlaceholder}
              onChange={(event) => setQuery(event.target.value)}
              className="pl-8"
            />
          </div>
        ) : null}
        <ul
          ref={listRef}
          aria-label={ariaLabel}
          className="max-h-72 overflow-y-auto overscroll-contain p-1"
        >
          {visibleOptions.map((option) => {
            const checkboxId = `${checkboxIdPrefix}-${option.value}`
            return (
              <li key={option.value}>
                <label
                  htmlFor={checkboxId}
                  className="hover:bg-muted/60 has-focus-visible:bg-muted/60 flex cursor-pointer items-center gap-3 rounded-md px-2 py-3 text-sm"
                >
                  {option.leading}
                  <span className="flex-1 truncate">{option.label}</span>
                  <Checkbox
                    id={checkboxId}
                    data-select-row=""
                    checked={selectedSet.has(option.value)}
                    onCheckedChange={() => toggle(option.value)}
                  />
                </label>
              </li>
            )
          })}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

export function multiSelectTriggerLabel(
  selectedCount: number,
  totalCount: number,
  labels: { none: string; all: string; some: (count: number) => string },
): string {
  if (selectedCount === 0) return labels.none
  if (selectedCount === totalCount) return labels.all
  return labels.some(selectedCount)
}
