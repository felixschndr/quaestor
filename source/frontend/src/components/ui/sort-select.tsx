'use client'

import { SingleSelectPopover, type SingleSelectOption } from '@/components/ui/single-select-popover'

export interface SortSelectProps<T extends string> {
  id?: string
  value: T
  onChange: (next: T) => void
  options: SingleSelectOption<T>[]
  ariaLabel: string
  width?: 'full' | 'content'
}

export function SortSelect<T extends string>({
  id,
  value,
  onChange,
  options,
  ariaLabel,
  width = 'content',
}: SortSelectProps<T>) {
  return (
    <SingleSelectPopover
      id={id}
      ariaLabel={ariaLabel}
      value={value}
      onChange={onChange}
      options={options}
      width={width}
      align="end"
    />
  )
}
