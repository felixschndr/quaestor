import { useTranslation } from 'react-i18next'

import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { TRANSACTION_TYPES, type TransactionType } from '@/lib/transaction'

export type TransferFilter = 'linked' | 'unlinked'

export interface TransactionFilterFieldsProps {
  categoryLabel: string
  categoryControlId: string
  categoryControl: React.ReactNode
  transactionType: TransactionType | undefined
  onTransactionTypeChange: (next: TransactionType | undefined) => void
  transfer: TransferFilter | undefined
  onTransferChange: (next: TransferFilter | undefined) => void
  idPrefix?: string
}

export function TransactionFilterFields({
  categoryLabel,
  categoryControlId,
  categoryControl,
  transactionType,
  onTransactionTypeChange,
  transfer,
  onTransferChange,
  idPrefix = 'filter',
}: TransactionFilterFieldsProps) {
  const { t, i18n } = useTranslation()
  const typeId = `${idPrefix}-type`
  const transferId = `${idPrefix}-transfer`

  const typeOptions = [...TRANSACTION_TYPES].sort((a, b) => {
    if (a === 'ZERO') return 1
    if (b === 'ZERO') return -1
    return t(`transactionType.${a}`).localeCompare(t(`transactionType.${b}`), i18n.language)
  })

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={categoryControlId}>{categoryLabel}</Label>
        {categoryControl}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={typeId}>{t('filters.typeLabel')}</Label>
        <NativeSelect
          id={typeId}
          value={transactionType ?? ''}
          onChange={(event) =>
            onTransactionTypeChange(
              (event.target.value || undefined) as TransactionType | undefined,
            )
          }
        >
          <option value="">{t('filters.anyOption')}</option>
          {typeOptions.map((typeValue) => (
            <option key={typeValue} value={typeValue}>
              {t(`transactionType.${typeValue}`)}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={transferId}>{t('filters.transferLabel')}</Label>
        <NativeSelect
          id={transferId}
          value={transfer ?? ''}
          onChange={(event) =>
            onTransferChange((event.target.value || undefined) as TransferFilter | undefined)
          }
        >
          <option value="">{t('filters.anyOption')}</option>
          <option value="linked">{t('filters.transfer.linked')}</option>
          <option value="unlinked">{t('filters.transfer.unlinked')}</option>
        </NativeSelect>
      </div>
    </div>
  )
}
