'use client'

import { useTranslation } from 'react-i18next'

import { MultiSelectPopover, type MultiSelectOption } from '@/components/ui/multi-select-popover'

export interface TwoOptionMultiSelectProps<T extends string> {
  id?: string
  ariaLabel: string
  options: MultiSelectOption<T>[]
  selected: T[]
  onChange: (next: T[]) => void
  checkboxIdPrefix: string
  className?: string
}

export function TwoOptionMultiSelect<T extends string>({
  id,
  ariaLabel,
  options,
  selected,
  onChange,
  checkboxIdPrefix,
  className,
}: TwoOptionMultiSelectProps<T>) {
  const { t } = useTranslation()

  const triggerLabel =
    selected.length === 0
      ? t('search.selectNone')
      : selected.length >= options.length
        ? t('common.any')
        : (options.find((option) => option.value === selected[0])?.label ?? t('common.any'))

  return (
    <MultiSelectPopover
      id={id}
      ariaLabel={ariaLabel}
      options={options}
      selected={selected}
      onChange={onChange}
      triggerLabel={triggerLabel}
      checkboxIdPrefix={checkboxIdPrefix}
      className={className}
    />
  )
}

export function scalarToSelection<T extends string>(value: T | 'none' | undefined, all: T[]): T[] {
  return value === undefined ? all : value === 'none' ? [] : [value]
}

export function selectionToScalar<T extends string>(
  next: T[],
  total: number,
): T | 'none' | undefined {
  return next.length >= total ? undefined : next.length === 1 ? next[0] : 'none'
}

export function ScalarMultiSelect<T extends string>({
  id,
  ariaLabel,
  options,
  value,
  onChange,
  checkboxIdPrefix,
  className,
}: {
  id?: string
  ariaLabel: string
  options: MultiSelectOption<T>[]
  value: T | 'none' | undefined
  onChange: (next: T | 'none' | undefined) => void
  checkboxIdPrefix: string
  className?: string
}) {
  const all = options.map((option) => option.value)
  return (
    <TwoOptionMultiSelect
      id={id}
      ariaLabel={ariaLabel}
      options={options}
      selected={scalarToSelection(value, all)}
      onChange={(next) => onChange(selectionToScalar(next, all.length))}
      checkboxIdPrefix={checkboxIdPrefix}
      className={className}
    />
  )
}
