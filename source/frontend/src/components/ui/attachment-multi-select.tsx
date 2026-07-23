'use client'

import { useTranslation } from 'react-i18next'
import { FileX, ListFilter, Paperclip } from 'lucide-react'

import { SingleSelectPopover } from '@/components/ui/single-select-popover'

export type AttachmentFilter = 'with' | 'without'

export interface AttachmentMultiSelectProps {
  id?: string
  value: AttachmentFilter | undefined
  onChange: (next: AttachmentFilter | undefined) => void
  className?: string
}

export function AttachmentMultiSelect({
  id,
  value,
  onChange,
  className,
}: AttachmentMultiSelectProps) {
  const { t } = useTranslation()

  const iconClass = 'text-muted-foreground size-4 shrink-0'
  const options = [
    {
      value: 'any' as const,
      label: t('common.any'),
      leading: <ListFilter className={iconClass} aria-hidden="true" />,
    },
    {
      value: 'with' as const,
      label: t('filters.attachment.with'),
      leading: <Paperclip className={iconClass} aria-hidden="true" />,
    },
    {
      value: 'without' as const,
      label: t('filters.attachment.without'),
      leading: <FileX className={iconClass} aria-hidden="true" />,
    },
  ]

  return (
    <SingleSelectPopover
      id={id}
      ariaLabel={t('filters.attachmentLabel')}
      options={options}
      value={value ?? 'any'}
      onChange={(next) => onChange(next === 'any' ? undefined : next)}
      className={className}
    />
  )
}
