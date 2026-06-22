'use client'

import { useTranslation } from 'react-i18next'

import { MultiSelectPopover, multiSelectTriggerLabel } from '@/components/ui/multi-select-popover'
import { FILTERABLE_CATEGORIES } from '@/lib/statistics'
import type { TransactionCategory } from '@/lib/transaction'

export interface CategoryMultiSelectProps {
  id?: string
  selectedIds: TransactionCategory[]
  onChange: (next: TransactionCategory[]) => void
  className?: string
}

function CategoryMultiSelect({ id, selectedIds, onChange, className }: CategoryMultiSelectProps) {
  const { t, i18n } = useTranslation()

  const options = [...FILTERABLE_CATEGORIES]
    .sort((a, b) => {
      if (a === 'UNKNOWN') return 1
      if (b === 'UNKNOWN') return -1
      return t(`category.${a}`).localeCompare(t(`category.${b}`), i18n.language)
    })
    .map((category) => ({ value: category, label: t(`category.${category}`) }))

  return (
    <MultiSelectPopover
      id={id}
      ariaLabel={t('filters.categoriesLabel')}
      options={options}
      selected={selectedIds}
      onChange={onChange}
      triggerLabel={multiSelectTriggerLabel(selectedIds.length, options.length, {
        none: t('filters.categoriesNone'),
        all: t('filters.categoriesAll'),
        some: (count) => t('filters.categoriesCount', { count }),
      })}
      selectAll={{
        all: t('search.selectAll'),
        none: t('search.selectNone'),
        count: (count) => t('filters.categoriesCount', { count }),
      }}
      checkboxIdPrefix="category-multi"
      className={className}
    />
  )
}

export { CategoryMultiSelect }
