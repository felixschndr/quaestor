'use client'

import { useTranslation } from 'react-i18next'

import type { CredentialRead } from '@/lib/auth'
import {
  CONTRACT_FREQUENCY_FILTERS,
  hasActiveContractFilters,
  type ContractFilters,
} from '@/lib/contract'
import { FILTERABLE_CATEGORIES } from '@/lib/statistics'
import { AccountMultiSelect } from '@/components/ui/account-multi-select'
import { AmountRangeFields } from '@/components/ui/amount-range-fields'
import { CategoryMultiSelect } from '@/components/ui/category-multi-select'
import { FrequencyMultiSelect } from '@/components/ui/frequency-multi-select'
import { FilterHeading } from '@/components/ui/filter-heading'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

export interface ContractFilterBarProps {
  credentials: CredentialRead[]
  filters: ContractFilters
  onChange: (next: ContractFilters) => void
}

function ContractFilterBar({ credentials, filters, onChange }: ContractFilterBarProps) {
  const { t } = useTranslation()
  const accountIds = credentials.flatMap((credential) =>
    credential.accounts.map((account) => account.id),
  )

  const update = <K extends keyof ContractFilters>(key: K, value: ContractFilters[K]) =>
    onChange({ ...filters, [key]: value })

  const shownOrAll = <T,>(selected: T[] | undefined, all: readonly T[]): T[] => selected ?? [...all]
  const normalize = <T,>(next: T[], total: number): T[] | undefined =>
    next.length >= total ? undefined : next

  return (
    <section className="border-border bg-card flex flex-col gap-3 rounded-lg border p-3">
      <FilterHeading />
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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="contract-filter-accounts">{t('common.account')}</Label>
          <AccountMultiSelect
            id="contract-filter-accounts"
            credentials={credentials}
            selectedIds={shownOrAll(filters.account_ids, accountIds)}
            onChange={(next) => update('account_ids', normalize(next, accountIds.length))}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="contract-filter-categories">{t('common.categories')}</Label>
          <CategoryMultiSelect
            id="contract-filter-categories"
            selectedIds={shownOrAll(filters.categories, FILTERABLE_CATEGORIES)}
            onChange={(next) => update('categories', normalize(next, FILTERABLE_CATEGORIES.length))}
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

      <AmountRangeFields
        idPrefix="contract-filter"
        fromLabel={t('common.amountFrom')}
        toLabel={t('common.amountTo')}
        from={filters.amount_from}
        to={filters.amount_to}
        onFromChange={(value) => update('amount_from', value)}
        onToChange={(value) => update('amount_to', value)}
      />

      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="contract-filter-overdue" className="cursor-pointer">
          {t('contracts.overdueFilter')}
        </Label>
        <Switch
          id="contract-filter-overdue"
          checked={filters.overdue ?? false}
          onCheckedChange={(next) => update('overdue', next ? true : undefined)}
        />
      </div>

      {hasActiveContractFilters(filters) ? (
        <button
          type="button"
          className="text-primary hover:text-primary/80 cursor-pointer self-end text-xs transition-colors"
          onClick={() => onChange({})}
        >
          {t('contracts.filtersReset')}
        </button>
      ) : null}
    </section>
  )
}

export { ContractFilterBar }
