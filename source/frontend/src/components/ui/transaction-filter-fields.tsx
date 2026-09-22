import { useTranslation } from 'react-i18next'
import { ArrowLeftRight, FileX, Paperclip, Unlink } from 'lucide-react'

import { CategoryMultiSelect } from '@/components/ui/category-multi-select'
import { Label } from '@/components/ui/label'
import { TypeMultiSelect } from '@/components/ui/type-multi-select'
import { ScalarMultiSelect } from '@/components/ui/two-option-multi-select'
import type { CategoryKey, TransactionType } from '@/lib/transaction'

export type RelatedFilter = 'linked' | 'unlinked' | 'none'
export type AttachmentFilter = 'with' | 'without' | 'none'

const iconClass = 'text-muted-foreground size-4 shrink-0'

export interface TransactionFilterFieldsProps {
  selectedCategories: CategoryKey[]
  onCategoriesChange: (next: CategoryKey[]) => void
  selectedTypes: TransactionType[]
  onTypesChange: (next: TransactionType[]) => void
  related?: RelatedFilter | undefined
  onRelatedChange?: (next: RelatedFilter | undefined) => void
  attachment?: AttachmentFilter | undefined
  onAttachmentChange?: (next: AttachmentFilter | undefined) => void
  idPrefix?: string
}

export function TransactionFilterFields({
  selectedCategories,
  onCategoriesChange,
  selectedTypes,
  onTypesChange,
  related,
  onRelatedChange,
  attachment,
  onAttachmentChange,
  idPrefix = 'filter',
}: TransactionFilterFieldsProps) {
  const { t } = useTranslation()
  const categoriesId = `${idPrefix}-categories`
  const typeId = `${idPrefix}-type`
  const relatedId = `${idPrefix}-related`
  const attachmentId = `${idPrefix}-attachment`

  const fieldCount = 2 + (onRelatedChange ? 1 : 0) + (onAttachmentChange ? 1 : 0)
  const columns = fieldCount === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'

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
      {onRelatedChange ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={relatedId}>{t('common.relatedTransactions')}</Label>
          <ScalarMultiSelect
            id={relatedId}
            ariaLabel={t('common.relatedTransactions')}
            options={[
              {
                value: 'linked',
                label: t('filters.related.linked'),
                leading: <ArrowLeftRight className={iconClass} aria-hidden="true" />,
              },
              {
                value: 'unlinked',
                label: t('filters.related.unlinked'),
                leading: <Unlink className={iconClass} aria-hidden="true" />,
              },
            ]}
            value={related}
            onChange={onRelatedChange}
            checkboxIdPrefix="related"
          />
        </div>
      ) : null}
      {onAttachmentChange ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={attachmentId}>{t('filters.attachmentLabel')}</Label>
          <ScalarMultiSelect
            id={attachmentId}
            ariaLabel={t('filters.attachmentLabel')}
            options={[
              {
                value: 'with',
                label: t('filters.attachment.with'),
                leading: <Paperclip className={iconClass} aria-hidden="true" />,
              },
              {
                value: 'without',
                label: t('filters.attachment.without'),
                leading: <FileX className={iconClass} aria-hidden="true" />,
              },
            ]}
            value={attachment}
            onChange={onAttachmentChange}
            checkboxIdPrefix="attachment"
          />
        </div>
      ) : null}
    </div>
  )
}
