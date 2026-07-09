'use client'

import { ChevronDown } from 'lucide-react'

import { cn } from '@/lib/utils'
import { useWheelScroll } from '@/lib/use-wheel-scroll'
import { Checkbox } from '@/components/ui/checkbox'
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
  checkboxIdPrefix,
  className,
}: MultiSelectPopoverProps<T>) {
  const listRef = useWheelScroll<HTMLUListElement>()
  const selectedSet = new Set(selected)
  const selectedCount = selected.length

  const toggle = (value: T) => {
    const next = new Set(selectedSet)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    onChange(options.map((option) => option.value).filter((value) => next.has(value)))
  }

  return (
    <Popover>
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
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-1rem)] p-0">
        {selectAll ? (
          <div className="border-border/40 flex items-center justify-between gap-2 border-b px-3 py-2 text-xs">
            <span className="text-muted-foreground">{selectAll.count(selectedCount)}</span>
            <div className="flex gap-1">
              <button
                type="button"
                className="text-primary hover:text-primary/80 cursor-pointer rounded-md px-2 py-0.5 transition-colors"
                onClick={() => onChange(options.map((option) => option.value))}
              >
                {selectAll.all}
              </button>
              <button
                type="button"
                className="text-primary hover:text-primary/80 cursor-pointer rounded-md px-2 py-0.5 transition-colors"
                onClick={() => onChange([])}
              >
                {selectAll.none}
              </button>
            </div>
          </div>
        ) : null}
        <ul
          ref={listRef}
          aria-label={ariaLabel}
          className="max-h-72 overflow-y-auto overscroll-contain py-1"
        >
          {options.map((option) => {
            const checkboxId = `${checkboxIdPrefix}-${option.value}`
            return (
              <li key={option.value}>
                <label
                  htmlFor={checkboxId}
                  className="hover:bg-muted/60 flex cursor-pointer items-center gap-3 px-3 py-2 text-sm"
                >
                  {option.leading}
                  <span className="flex-1 truncate">{option.label}</span>
                  <Checkbox
                    id={checkboxId}
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
