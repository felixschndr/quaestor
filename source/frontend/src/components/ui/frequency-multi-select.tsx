'use client'

import { useTranslation } from 'react-i18next'

import { MultiSelectPopover, multiSelectTriggerLabel } from '@/components/ui/multi-select-popover'
import { CONTRACT_FREQUENCIES, type ContractFrequency } from '@/lib/contract'

export interface FrequencyMultiSelectProps {
  id?: string
  selectedIds: ContractFrequency[]
  onChange: (next: ContractFrequency[]) => void
  className?: string
}

function FrequencyMultiSelect({ id, selectedIds, onChange, className }: FrequencyMultiSelectProps) {
  const { t } = useTranslation()

  const options = CONTRACT_FREQUENCIES.map((frequency) => ({
    value: frequency,
    label: t(`contracts.frequency.${frequency}`),
  }))

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
