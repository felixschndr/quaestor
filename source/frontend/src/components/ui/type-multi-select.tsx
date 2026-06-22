'use client'

import { useTranslation } from 'react-i18next'

import { MultiSelectPopover, multiSelectTriggerLabel } from '@/components/ui/multi-select-popover'
import { TRANSACTION_TYPES, type TransactionType } from '@/lib/transaction'

export interface TypeMultiSelectProps {
  id?: string
  selected: TransactionType[]
  onChange: (next: TransactionType[]) => void
  className?: string
}

export function TypeMultiSelect({ id, selected, onChange, className }: TypeMultiSelectProps) {
  const { t, i18n } = useTranslation()

  const options = [...TRANSACTION_TYPES]
    .sort((a, b) => {
      if (a === 'ZERO') return 1
      if (b === 'ZERO') return -1
      return t(`transactionType.${a}`).localeCompare(t(`transactionType.${b}`), i18n.language)
    })
    .map((type) => ({ value: type, label: t(`transactionType.${type}`) }))

  return (
    <MultiSelectPopover
      id={id}
      ariaLabel={t('filters.typeLabel')}
      options={options}
      selected={selected}
      onChange={onChange}
      triggerLabel={multiSelectTriggerLabel(selected.length, options.length, {
        none: t('filters.typeNone'),
        all: t('filters.typeAll'),
        some: (count) => t('filters.typeCount', { count }),
      })}
      selectAll={{
        all: t('search.selectAll'),
        none: t('search.selectNone'),
        count: (count) => t('filters.typeCount', { count }),
      }}
      checkboxIdPrefix="type-multi"
      className={className}
    />
  )
}
