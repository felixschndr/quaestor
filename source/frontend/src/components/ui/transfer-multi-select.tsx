'use client'

import { useTranslation } from 'react-i18next'
import { ArrowLeftRight, ListFilter, Unlink } from 'lucide-react'

import { SingleSelectPopover } from '@/components/ui/single-select-popover'

export type TransferFilter = 'linked' | 'unlinked'

export interface TransferMultiSelectProps {
  id?: string
  value: TransferFilter | undefined
  onChange: (next: TransferFilter | undefined) => void
  className?: string
}

export function TransferMultiSelect({ id, value, onChange, className }: TransferMultiSelectProps) {
  const { t } = useTranslation()

  const iconClass = 'text-muted-foreground size-4 shrink-0'
  const options = [
    {
      value: 'any' as const,
      label: t('common.any'),
      leading: <ListFilter className={iconClass} aria-hidden="true" />,
    },
    {
      value: 'linked' as const,
      label: t('filters.transferLabel'),
      leading: <ArrowLeftRight className={iconClass} aria-hidden="true" />,
    },
    {
      value: 'unlinked' as const,
      label: t('filters.transfer.unlinked'),
      leading: <Unlink className={iconClass} aria-hidden="true" />,
    },
  ]

  return (
    <SingleSelectPopover
      id={id}
      ariaLabel={t('filters.transferLabel')}
      options={options}
      value={value ?? 'any'}
      onChange={(next) => onChange(next === 'any' ? undefined : next)}
      className={className}
    />
  )
}
