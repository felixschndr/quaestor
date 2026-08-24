'use client'

import { useTranslation } from 'react-i18next'
import { ArrowLeftRight, Unlink } from 'lucide-react'

import type { MultiSelectOption } from '@/components/ui/multi-select-popover'
import {
  TwoOptionMultiSelect,
  scalarToSelection,
  selectionToScalar,
} from '@/components/ui/two-option-multi-select'

export type TransferFilter = 'linked' | 'unlinked' | 'none'

export interface TransferMultiSelectProps {
  id?: string
  value: TransferFilter | undefined
  onChange: (next: TransferFilter | undefined) => void
  className?: string
}

export function TransferMultiSelect({ id, value, onChange, className }: TransferMultiSelectProps) {
  const { t } = useTranslation()

  const iconClass = 'text-muted-foreground size-4 shrink-0'
  const options: MultiSelectOption<'linked' | 'unlinked'>[] = [
    {
      value: 'linked',
      label: t('filters.transfer.linked'),
      leading: <ArrowLeftRight className={iconClass} aria-hidden="true" />,
    },
    {
      value: 'unlinked',
      label: t('filters.transfer.unlinked'),
      leading: <Unlink className={iconClass} aria-hidden="true" />,
    },
  ]

  const all = options.map((option) => option.value)

  return (
    <TwoOptionMultiSelect
      id={id}
      ariaLabel={t('filters.transferLabel')}
      options={options}
      selected={scalarToSelection(value, all)}
      onChange={(next) => onChange(selectionToScalar(next, all.length))}
      checkboxIdPrefix="transfer"
      className={className}
    />
  )
}
