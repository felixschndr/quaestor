import { useTranslation } from 'react-i18next'

import { CategoryMultiSelect } from '@/components/ui/category-multi-select'
import { Label } from '@/components/ui/label'
import { TypeMultiSelect } from '@/components/ui/type-multi-select'
import { TransferMultiSelect, type TransferFilter } from '@/components/ui/transfer-multi-select'
import type { TransactionCategory, TransactionType } from '@/lib/transaction'

export type { TransferFilter }

export interface TransactionFilterFieldsProps {
  selectedCategories: TransactionCategory[]
  onCategoriesChange: (next: TransactionCategory[]) => void
  selectedTypes: TransactionType[]
  onTypesChange: (next: TransactionType[]) => void
  transfer: TransferFilter | undefined
  onTransferChange: (next: TransferFilter | undefined) => void
  idPrefix?: string
}

export function TransactionFilterFields({
  selectedCategories,
  onCategoriesChange,
  selectedTypes,
  onTypesChange,
  transfer,
  onTransferChange,
  idPrefix = 'filter',
}: TransactionFilterFieldsProps) {
  const { t } = useTranslation()
  const categoriesId = `${idPrefix}-categories`
  const typeId = `${idPrefix}-type`
  const transferId = `${idPrefix}-transfer`

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={categoriesId}>{t('filters.categoriesLabel')}</Label>
        <CategoryMultiSelect
          id={categoriesId}
          selectedIds={selectedCategories}
          onChange={onCategoriesChange}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={typeId}>{t('filters.typeLabel')}</Label>
        <TypeMultiSelect id={typeId} selected={selectedTypes} onChange={onTypesChange} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={transferId}>{t('filters.transferLabel')}</Label>
        <TransferMultiSelect id={transferId} value={transfer} onChange={onTransferChange} />
      </div>
    </div>
  )
}
