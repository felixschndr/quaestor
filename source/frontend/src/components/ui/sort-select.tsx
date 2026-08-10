'use client'

import { SingleSelectPopover, type SingleSelectOption } from '@/components/ui/single-select-popover'

export interface SortSelectProps<T extends string> {
  id?: string
  value: T
  onChange: (next: T) => void
  options: SingleSelectOption<T>[]
  ariaLabel: string
}

export function SortSelect<T extends string>({
  id,
  value,
  onChange,
  options,
  ariaLabel,
}: SortSelectProps<T>) {
  return (
    <SingleSelectPopover
      id={id}
      ariaLabel={ariaLabel}
      value={value}
      onChange={onChange}
      options={options}
      width="content"
      align="end"
    />
  )
}
