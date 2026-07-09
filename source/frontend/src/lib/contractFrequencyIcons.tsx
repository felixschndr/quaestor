import {
  Calendar1,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  CalendarSync,
  Shuffle,
  type LucideIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { CONTRACT_FREQUENCY_FILTERS, type ContractFrequencyFilter } from '@/lib/contract'
import type { SingleSelectOption } from '@/components/ui/single-select-popover'

const FREQUENCY_ICONS: Record<ContractFrequencyFilter, LucideIcon> = {
  WEEKLY: CalendarDays,
  BIWEEKLY: CalendarRange,
  MONTHLY: Calendar1,
  QUARTERLY: CalendarClock,
  YEARLY: CalendarSync,
  NONE: Shuffle,
}

export function useFrequencyOptions(): SingleSelectOption<ContractFrequencyFilter>[] {
  const { t } = useTranslation()
  return CONTRACT_FREQUENCY_FILTERS.map((frequency) => {
    const Icon = FREQUENCY_ICONS[frequency]
    return {
      value: frequency,
      label:
        frequency === 'NONE'
          ? t('contracts.frequencyUnknown')
          : t(`contracts.frequency.${frequency}`),
      leading: <Icon className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />,
    }
  })
}
