import { useTranslation } from 'react-i18next'

import {
  AttachmentMultiSelect,
  type AttachmentFilter,
} from '@/components/ui/attachment-multi-select'
import { CategoryMultiSelect } from '@/components/ui/category-multi-select'
import { Label } from '@/components/ui/label'
import { TypeMultiSelect } from '@/components/ui/type-multi-select'
import { TransferMultiSelect, type TransferFilter } from '@/components/ui/transfer-multi-select'
import type { TransactionCategory, TransactionType } from '@/lib/transaction'

export type { TransferFilter, AttachmentFilter }

export interface TransactionFilterFieldsProps {
  selectedCategories: TransactionCategory[]
  onCategoriesChange: (next: TransactionCategory[]) => void
  selectedTypes: TransactionType[]
  onTypesChange: (next: TransactionType[]) => void
  transfer: TransferFilter | undefined
  onTransferChange: (next: TransferFilter | undefined) => void
  // Attachment filter only makes sense in transaction search, not in stats aggregation.
  attachment?: AttachmentFilter | undefined
  onAttachmentChange?: (next: AttachmentFilter | undefined) => void
  idPrefix?: string
}

export function TransactionFilterFields({
  selectedCategories,
  onCategoriesChange,
  selectedTypes,
  onTypesChange,
  transfer,
  onTransferChange,
  attachment,
  onAttachmentChange,
  idPrefix = 'filter',
}: TransactionFilterFieldsProps) {
  const { t } = useTranslation()
  const categoriesId = `${idPrefix}-categories`
  const typeId = `${idPrefix}-type`
  const transferId = `${idPrefix}-transfer`
  const attachmentId = `${idPrefix}-attachment`

  const columns = onAttachmentChange ? 'sm:grid-cols-2' : 'sm:grid-cols-3'

  return (
    <div className={`grid grid-cols-1 gap-3 ${columns}`}>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={categoriesId}>{t('common.categories')}</Label>
        <CategoryMultiSelect
          id={categoriesId}
          selectedIds={selectedCategories}
          onChange={onCategoriesChange}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={typeId}>{t('common.type')}</Label>
        <TypeMultiSelect id={typeId} selected={selectedTypes} onChange={onTypesChange} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={transferId}>{t('filters.transferLabel')}</Label>
        <TransferMultiSelect id={transferId} value={transfer} onChange={onTransferChange} />
      </div>
      {onAttachmentChange ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={attachmentId}>{t('filters.attachmentLabel')}</Label>
          <AttachmentMultiSelect
            id={attachmentId}
            value={attachment}
            onChange={onAttachmentChange}
          />
        </div>
      ) : null}
    </div>
  )
}
