'use client'

import { useTranslation } from 'react-i18next'
import { Archive, CircleCheck, Repeat, TriangleAlert } from 'lucide-react'

import type { CredentialRead } from '@/lib/auth'
import { defaultAccountIds, sameAccountSelection } from '@/lib/accounts'
import {
  CONTRACT_FREQUENCY_FILTERS,
  CONTRACT_OVERDUE_FILTERS,
  DEFAULT_CONTRACT_STATUS,
  hasActiveContractFilters,
  type ContractFilters,
  type ContractOverdueFilter,
  type ContractStatusFilter,
} from '@/lib/contract'
import { useCategoryCatalog } from '@/lib/categoryCatalog'
import { AccountMultiSelect } from '@/components/ui/account-multi-select'
import { AdvancedFilters } from '@/components/ui/advanced-filters'
import { AmountRangeFields } from '@/components/ui/amount-range-fields'
import { CategoryMultiSelect } from '@/components/ui/category-multi-select'
import { FrequencyMultiSelect } from '@/components/ui/frequency-multi-select'
import { FilterHeading } from '@/components/ui/filter-heading'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { MultiSelectOption } from '@/components/ui/multi-select-popover'
import { TwoOptionMultiSelect } from '@/components/ui/two-option-multi-select'

export interface ContractFilterBarProps {
  credentials: CredentialRead[]
  filters: ContractFilters
  onChange: (next: ContractFilters) => void
}

function ContractFilterBar({ credentials, filters, onChange }: ContractFilterBarProps) {
  const { t } = useTranslation()
  const catalog = useCategoryCatalog()
  const iconClass = 'text-muted-foreground size-4 shrink-0'
  const defaultIds = defaultAccountIds(credentials)

  const update = <K extends keyof ContractFilters>(key: K, value: ContractFilters[K]) =>
    onChange({ ...filters, [key]: value })

  const shownOrAll = <T,>(selected: T[] | undefined, all: readonly T[]): T[] => selected ?? [...all]
  const normalize = <T,>(next: T[], total: number): T[] | undefined =>
    next.length >= total ? undefined : next

  const overdueOptions: MultiSelectOption<ContractOverdueFilter>[] = [
    {
      value: 'CURRENT',
      label: t('common.current'),
      leading: <CircleCheck className={iconClass} />,
    },
    {
      value: 'OVERDUE',
      label: t('common.overdue'),
      leading: <TriangleAlert className={iconClass} />,
    },
  ]
  const statusOptions: MultiSelectOption<ContractStatusFilter>[] = [
    {
      value: 'ACTIVE',
      label: t('contracts.statusOption.active'),
      leading: <Repeat className={iconClass} />,
    },
    { value: 'ARCHIVED', label: t('common.archived'), leading: <Archive className={iconClass} /> },
  ]
  const statusEqualsDefault = (next: ContractStatusFilter[]): boolean =>
    next.length === DEFAULT_CONTRACT_STATUS.length && next.every((value) => value === 'ACTIVE')

  return (
    <section className="border-border bg-card flex flex-col gap-3 rounded-lg border p-3">
      <FilterHeading onReset={hasActiveContractFilters(filters) ? () => onChange({}) : undefined} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="contract-filter-text">{t('common.name')}</Label>
        <Input
          id="contract-filter-text"
          type="search"
          inputMode="search"
          value={filters.text ?? ''}
          placeholder={t('contracts.searchPlaceholder')}
          onChange={(event) => update('text', event.target.value || undefined)}
        />
      </div>

      <AmountRangeFields
        idPrefix="contract-filter"
        fromLabel={t('common.amountFrom')}
        toLabel={t('common.amountTo')}
        from={filters.amount_from}
        to={filters.amount_to}
        onFromChange={(value) => update('amount_from', value)}
        onToChange={(value) => update('amount_to', value)}
      />

      <AdvancedFilters storageKey="contracts">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="contract-filter-accounts">{t('common.account')}</Label>
            <AccountMultiSelect
              id="contract-filter-accounts"
              credentials={credentials}
              selectedIds={filters.account_ids ?? defaultIds}
              onChange={(next) =>
                update('account_ids', sameAccountSelection(next, defaultIds) ? undefined : next)
              }
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="contract-filter-categories">{t('common.categories')}</Label>
            <CategoryMultiSelect
              id="contract-filter-categories"
              selectedIds={shownOrAll(filters.categories, catalog.allKeys)}
              onChange={(next) => update('categories', normalize(next, catalog.allKeys.length))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="contract-filter-frequencies">{t('filters.frequenciesLabel')}</Label>
            <FrequencyMultiSelect
              id="contract-filter-frequencies"
              selectedIds={shownOrAll(filters.frequencies, CONTRACT_FREQUENCY_FILTERS)}
              onChange={(next) =>
                update('frequencies', normalize(next, CONTRACT_FREQUENCY_FILTERS.length))
              }
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="contract-filter-overdue">{t('common.overdue')}</Label>
            <TwoOptionMultiSelect
              id="contract-filter-overdue"
              ariaLabel={t('common.overdue')}
              checkboxIdPrefix="contract-overdue"
              options={overdueOptions}
              selected={filters.overdue ?? [...CONTRACT_OVERDUE_FILTERS]}
              onChange={(next) =>
                update('overdue', normalize(next, CONTRACT_OVERDUE_FILTERS.length))
              }
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="contract-filter-status">{t('contracts.statusLabel')}</Label>
            <TwoOptionMultiSelect
              id="contract-filter-status"
              ariaLabel={t('contracts.statusLabel')}
              checkboxIdPrefix="contract-status"
              options={statusOptions}
              selected={filters.status ?? DEFAULT_CONTRACT_STATUS}
              onChange={(next) => update('status', statusEqualsDefault(next) ? undefined : next)}
            />
          </div>
        </div>
      </AdvancedFilters>
    </section>
  )
}

export { ContractFilterBar }
