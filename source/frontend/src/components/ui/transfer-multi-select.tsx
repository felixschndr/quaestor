'use client'

import { useTranslation } from 'react-i18next'

import { MultiSelectPopover } from '@/components/ui/multi-select-popover'

export type TransferFilter = 'linked' | 'unlinked'

export interface TransferMultiSelectProps {
  id?: string
  value: TransferFilter | undefined
  onChange: (next: TransferFilter | undefined) => void
  className?: string
}

export function TransferMultiSelect({ id, value, onChange, className }: TransferMultiSelectProps) {
  const { t } = useTranslation()

  const options = [
    { value: 'linked' as const, label: t('filters.transfer.linked') },
    { value: 'unlinked' as const, label: t('filters.transfer.unlinked') },
  ]
  const selected: TransferFilter[] = value ? [value] : ['linked', 'unlinked']
  const handleChange = (next: TransferFilter[]) => onChange(next.length === 1 ? next[0] : undefined)

  const triggerLabel =
    value === 'linked'
      ? t('filters.transfer.linked')
      : value === 'unlinked'
        ? t('filters.transfer.unlinked')
        : t('filters.anyOption')

  return (
    <MultiSelectPopover
      id={id}
      ariaLabel={t('filters.transferLabel')}
      options={options}
      selected={selected}
      onChange={handleChange}
      triggerLabel={triggerLabel}
      checkboxIdPrefix="transfer-multi"
      className={className}
    />
  )
}
