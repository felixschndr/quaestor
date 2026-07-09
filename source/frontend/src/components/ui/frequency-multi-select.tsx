'use client'

import { useTranslation } from 'react-i18next'

import { MultiSelectPopover, multiSelectTriggerLabel } from '@/components/ui/multi-select-popover'
import { useFrequencyOptions } from '@/lib/contractFrequencyIcons'
import type { ContractFrequencyFilter } from '@/lib/contract'

export interface FrequencyMultiSelectProps {
  id?: string
  selectedIds: ContractFrequencyFilter[]
  onChange: (next: ContractFrequencyFilter[]) => void
  className?: string
}

function FrequencyMultiSelect({ id, selectedIds, onChange, className }: FrequencyMultiSelectProps) {
  const { t } = useTranslation()
  const options = useFrequencyOptions()

  return (
    <MultiSelectPopover
      id={id}
      ariaLabel={t('filters.frequenciesLabel')}
      options={options}
      selected={selectedIds}
      onChange={onChange}
      triggerLabel={multiSelectTriggerLabel(selectedIds.length, options.length, {
        none: t('filters.frequenciesNone'),
        all: t('filters.frequenciesAll'),
        some: (count) => t('filters.frequenciesCount', { count }),
      })}
      selectAll={{
        all: t('search.selectAll'),
        none: t('search.selectNone'),
        count: (count) => t('filters.frequenciesCount', { count }),
      }}
      checkboxIdPrefix="frequency-multi"
      className={className}
    />
  )
}

export { FrequencyMultiSelect }
