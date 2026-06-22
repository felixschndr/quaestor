import { useTranslation } from 'react-i18next'

import { DatePicker } from '@/components/ui/date-picker'
import { Label } from '@/components/ui/label'

export interface DateRangeFieldsProps {
  dateFrom: string | undefined
  dateTo: string | undefined
  onDateFromChange: (next: string | undefined) => void
  onDateToChange: (next: string | undefined) => void
  placeholder?: string
  idPrefix?: string
}

export function DateRangeFields({
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  placeholder,
  idPrefix = 'range',
}: DateRangeFieldsProps) {
  const { t } = useTranslation()
  const fromId = `${idPrefix}-date-from`
  const toId = `${idPrefix}-date-to`

  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={fromId}>{t('filters.dateFrom')}</Label>
        <DatePicker
          id={fromId}
          value={dateFrom ?? ''}
          onChange={(next) => onDateFromChange(next || undefined)}
          placeholder={placeholder}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={toId}>{t('filters.dateTo')}</Label>
        <DatePicker
          id={toId}
          value={dateTo ?? ''}
          onChange={(next) => onDateToChange(next || undefined)}
          placeholder={placeholder}
        />
      </div>
    </div>
  )
}
