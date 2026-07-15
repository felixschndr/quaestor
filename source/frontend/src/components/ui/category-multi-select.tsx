'use client'

import { useTranslation } from 'react-i18next'

import { MultiSelectPopover, multiSelectTriggerLabel } from '@/components/ui/multi-select-popover'
import { useCategoryOptions } from '@/lib/categoryIcons'
import type { TransactionCategory } from '@/lib/transaction'

export interface CategoryMultiSelectProps {
  id?: string
  selectedIds: TransactionCategory[]
  onChange: (next: TransactionCategory[]) => void
  className?: string
}

function CategoryMultiSelect({ id, selectedIds, onChange, className }: CategoryMultiSelectProps) {
  const { t } = useTranslation()
  const options = useCategoryOptions()

  return (
    <MultiSelectPopover
      id={id}
      ariaLabel={t('common.categories')}
      options={options}
      selected={selectedIds}
      onChange={onChange}
      triggerLabel={multiSelectTriggerLabel(selectedIds.length, options.length, {
        none: t('filters.categoriesNone'),
        all: t('common.allCategories'),
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
