'use client'

import { Fragment, useState } from 'react'
import { ChevronDown } from 'lucide-react'

import { cn } from '@/lib/utils'
import { usePopoverScroll } from '@/lib/use-popover-scroll'
import { Checkbox } from '@/components/ui/checkbox'
import { matchesQuery, PopoverSearchInput } from '@/components/ui/popover-search-input'
import { handleSelectListArrowKeys } from '@/components/ui/select-list-keyboard'
import { SelectAllHeader } from '@/components/ui/select-all-header'
import { GroupHeading, type SingleSelectOption } from '@/components/ui/single-select-popover'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  popoverTriggerClassName,
} from '@/components/ui/popover'

export type MultiSelectOption<T extends string> = SingleSelectOption<T>

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
    ? options.filter((option) => matchesQuery(option.label, query))
    : options

  const toggle = (values: T[], checked: boolean) => {
    const next = new Set(selectedSet)
    for (const value of values) {
      if (checked) next.add(value)
      else next.delete(value)
    }
    onChange(options.map((option) => option.value).filter((value) => next.has(value)))
  }
  const groupState = (group: string) => {
    const members = options.filter((option) => option.group === group)
    const selectedMembers = members.filter((option) => selectedSet.has(option.value)).length
    return {
      values: members.map((option) => option.value),
      checked:
        selectedMembers === members.length
          ? true
          : selectedMembers > 0
            ? ('indeterminate' as const)
            : false,
    }
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
          className="max-h-72 overflow-y-auto overscroll-contain p-1"
        >
          {visibleOptions.map((option, index) => {
            const checkboxId = `${checkboxIdPrefix}-${option.value}`
            const group = option.group ? groupState(option.group) : null
            return (
              <Fragment key={option.value}>
                <GroupHeading option={option} previous={visibleOptions[index - 1]}>
                  {group ? (
                    <Checkbox
                      aria-label={option.group}
                      data-select-row=""
                      checked={group.checked}
                      onCheckedChange={() => toggle(group.values, group.checked !== true)}
                    />
                  ) : null}
                </GroupHeading>
                <li>
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
                      onCheckedChange={() => toggle([option.value], !selectedSet.has(option.value))}
                    />
                  </label>
                </li>
              </Fragment>
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
