'use client'

import { useTranslation } from 'react-i18next'

import type { CredentialRead } from '@/lib/auth'
import {
  CONTRACT_FREQUENCIES,
  hasActiveContractFilters,
  type ContractFilters,
} from '@/lib/contract'
import { FILTERABLE_CATEGORIES } from '@/lib/statistics'
import { AccountMultiSelect } from '@/components/ui/account-multi-select'
import { AmountRangeFields } from '@/components/ui/amount-range-fields'
import { CategoryMultiSelect } from '@/components/ui/category-multi-select'
import { FrequencyMultiSelect } from '@/components/ui/frequency-multi-select'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

export interface ContractFilterBarProps {
  credentials: CredentialRead[]
  filters: ContractFilters
  onChange: (next: ContractFilters) => void
}

/**
 * Filter controls for the contract list, built entirely from the shared filter
 * primitives used by transaction search. Every facet is live and defaults to
 * "all": an unset facet shows every option selected, and selecting all (or none)
 * collapses back to no filter so the URL stays clean.
 */
function ContractFilterBar({ credentials, filters, onChange }: ContractFilterBarProps) {
  const { t } = useTranslation()
  const accountIds = credentials.flatMap((credential) =>
    credential.accounts.map((account) => account.id),
  )

  const update = <K extends keyof ContractFilters>(key: K, value: ContractFilters[K]) =>
    onChange({ ...filters, [key]: value })

  const shownOrAll = <T,>(selected: T[] | undefined, all: readonly T[]): T[] => selected ?? [...all]
  // A full selection is the default ("all", no filter); anything less — including
  // an empty selection from the "Keine" button — is kept as an explicit filter.
  const normalize = <T,>(next: T[], total: number): T[] | undefined =>
    next.length >= total ? undefined : next

  return (
    <section className="border-border bg-card flex flex-col gap-3 rounded-lg border p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="contract-filter-accounts">{t('contracts.account')}</Label>
          <AccountMultiSelect
            id="contract-filter-accounts"
            credentials={credentials}
            selectedIds={shownOrAll(filters.account_ids, accountIds)}
            onChange={(next) => update('account_ids', normalize(next, accountIds.length))}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="contract-filter-categories">{t('filters.categoriesLabel')}</Label>
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
            selectedIds={shownOrAll(filters.frequencies, CONTRACT_FREQUENCIES)}
            onChange={(next) => update('frequencies', normalize(next, CONTRACT_FREQUENCIES.length))}
          />
        </div>
      </div>

      <AmountRangeFields
        idPrefix="contract-filter"
        fromLabel={t('search.amountFrom')}
        toLabel={t('search.amountTo')}
        from={filters.amount_from}
        to={filters.amount_to}
        onFromChange={(value) => update('amount_from', value)}
        onToChange={(value) => update('amount_to', value)}
      />

      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="contract-filter-overdue">{t('contracts.overdueFilter')}</Label>
        <Switch
          id="contract-filter-overdue"
          checked={filters.overdue ?? false}
          onCheckedChange={(next) => update('overdue', next ? true : undefined)}
        />
      </div>

      {hasActiveContractFilters(filters) ? (
        <button
          type="button"
          className="text-primary hover:text-primary/80 self-end text-xs transition-colors"
          onClick={() => onChange({})}
        >
          {t('contracts.filtersReset')}
        </button>
      ) : null}
    </section>
  )
}

export { ContractFilterBar }
