import { useEffect, useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ArrowLeftRight } from 'lucide-react'

import { QueryStates } from '@/components/query-states'
import { AccountMultiSelect } from '@/components/ui/account-multi-select'
import { AdvancedFilters } from '@/components/ui/advanced-filters'
import { AmountRangeFields } from '@/components/ui/amount-range-fields'
import { DateRangeFields } from '@/components/ui/date-range-fields'
import { FilterHeading } from '@/components/ui/filter-heading'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SortSelect } from '@/components/ui/sort-select'
import { TransactionFilterFields } from '@/components/ui/transaction-filter-fields'
import type { TransactionRead } from '@/lib/accountHistory'
import { accountDisplayName, defaultAccountIds, sameAccountSelection } from '@/lib/accounts'
import { buildAccountLookup, type AccountWithBank } from '@/lib/accountDisplayGroups'
import { AccountLabel } from '@/components/AccountLabel'
import { type CredentialRead } from '@/lib/auth'
import { formatDate, formatMoney, transactionPartyName } from '@/lib/format'
import { CategoryAvatar } from '@/lib/categoryIcons'
import { TRANSACTION_CATEGORIES, TRANSACTION_TYPES, useTransaction } from '@/lib/transaction'
import { useSearchTransactions, type TransactionFilters } from '@/lib/transactionSearch'
import {
  SORT_COMPARATORS,
  type TransactionSearchParams,
  type TransactionSortKey,
} from '@/lib/transactionSearchParams'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { cn } from '@/lib/utils'
import { BackLink } from '@/components/back-link'

export interface TransactionSearchViewProps {
  credentials: CredentialRead[]
  search: TransactionSearchParams
  onChange: (payload: { accountIds: number[]; filters: TransactionFilters }) => void
  onSortChange: (sort: TransactionSortKey) => void
}

export function nextSearchParams(
  { accountIds, filters }: { accountIds: number[]; filters: TransactionFilters },
  search: TransactionSearchParams,
  credentials: CredentialRead[],
): TransactionSearchParams {
  const isDefault = sameAccountSelection(accountIds, defaultAccountIds(credentials))
  return {
    ...filters,
    account_ids: isDefault ? undefined : accountIds,
    link_account_id: search.link_account_id,
    link_transaction_id: search.link_transaction_id,
    sort: search.sort,
  }
}

export function TransactionSearchView({
  credentials,
  search,
  onChange,
  onSortChange,
}: TransactionSearchViewProps) {
  const { t } = useTranslation()
  const defaultIds = useMemo(() => defaultAccountIds(credentials), [credentials])
  const [accountIds, setAccountIds] = useState<number[]>(search.account_ids ?? defaultIds)
  const [draft, setDraft] = useState<TransactionFilters>(toFilters(search))

  const update = <K extends keyof TransactionFilters>(key: K, value: TransactionFilters[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }))

  const debouncedDraft = useDebouncedValue(draft, 300)

  const [initial] = useState(() => ({
    accountIds: search.account_ids ?? defaultIds,
    draft: toFilters(search),
  }))
  const sortedIds = (ids: number[]) => [...ids].sort((a, b) => a - b).join(',')
  const isNonDefault =
    sortedIds(accountIds) !== sortedIds(initial.accountIds) ||
    JSON.stringify(draft) !== JSON.stringify(initial.draft)
  const resetFilters = () => {
    setAccountIds(initial.accountIds)
    setDraft(initial.draft)
  }

  const hasSelection =
    accountIds.length > 0 &&
    debouncedDraft.categories?.length !== 0 &&
    debouncedDraft.transaction_types?.length !== 0 &&
    debouncedDraft.linked !== 'none' &&
    debouncedDraft.has_attachment !== 'none'

  useEffect(() => {
    onChange({ accountIds, filters: debouncedDraft })
  }, [accountIds, debouncedDraft, onChange])

  const linkSource =
    search.link_account_id !== undefined && search.link_transaction_id !== undefined
      ? { accountId: search.link_account_id, transactionId: search.link_transaction_id }
      : null

  return (
    <main className="mx-auto flex min-h-full max-w-page flex-col gap-6 p-4">
      <header className="flex items-center gap-2">
        <BackLink to="/" />
        <h1 className="text-foreground text-lg font-semibold">{t('search.title')}</h1>
      </header>

      {linkSource ? (
        <p className="border-border bg-muted/40 text-muted-foreground flex items-center gap-2 rounded-lg border p-3 text-sm">
          <ArrowLeftRight className="size-4 shrink-0" aria-hidden="true" />
          {t('search.linkModeHint')}
        </p>
      ) : null}

      <SearchForm
        credentials={credentials}
        accountIds={accountIds}
        onAccountIdsChange={setAccountIds}
        draft={draft}
        onUpdate={update}
        onReset={isNonDefault ? resetFilters : undefined}
      />

      {hasSelection ? (
        <SearchResults
          accountIds={accountIds}
          credentials={credentials}
          filters={debouncedDraft}
          linkSource={linkSource}
          sort={search.sort ?? 'date_desc'}
          onSortChange={onSortChange}
        />
      ) : (
        <p className="text-muted-foreground text-sm">{t('common.noMatchingTransactions')}</p>
      )}
    </main>
  )
}

function SearchForm({
  credentials,
  accountIds,
  onAccountIdsChange,
  draft,
  onUpdate,
  onReset,
}: {
  credentials: CredentialRead[]
  accountIds: number[]
  onAccountIdsChange: (ids: number[]) => void
  draft: TransactionFilters
  onUpdate: <K extends keyof TransactionFilters>(key: K, value: TransactionFilters[K]) => void
  onReset?: () => void
}) {
  const { t } = useTranslation()
  const selectedCategories = draft.categories ?? [...TRANSACTION_CATEGORIES]
  const selectedTypes = draft.transaction_types ?? [...TRANSACTION_TYPES]

  return (
    <form
      onSubmit={(event) => event.preventDefault()}
      noValidate
      className="border-border bg-card flex flex-col gap-3 rounded-lg border p-3"
    >
      <FilterHeading onReset={onReset} />
      <Field id="search-text" label={t('search.text')}>
        <Input
          id="search-text"
          type="search"
          inputMode="search"
          autoFocus
          value={draft.text ?? ''}
          onChange={(event) => onUpdate('text', event.target.value)}
          placeholder={t('search.textPlaceholder')}
        />
      </Field>

      <AmountRangeFields
        idPrefix="search"
        fromLabel={t('common.amountFrom')}
        toLabel={t('common.amountTo')}
        from={draft.amount_from}
        to={draft.amount_to}
        onFromChange={(value) => onUpdate('amount_from', value)}
        onToChange={(value) => onUpdate('amount_to', value)}
      />

      <AdvancedFilters storageKey="search">
        <Field id="search-accounts" label={t('common.accounts')}>
          <AccountMultiSelect
            id="search-accounts"
            credentials={credentials}
            selectedIds={accountIds}
            onChange={onAccountIdsChange}
          />
        </Field>

        <DateRangeFields
          idPrefix="search"
          placeholder={t('search.datePlaceholder')}
          dateFrom={draft.date_from}
          dateTo={draft.date_to}
          onDateFromChange={(next) => onUpdate('date_from', next)}
          onDateToChange={(next) => onUpdate('date_to', next)}
        />

        <TransactionFilterFields
          idPrefix="search"
          selectedCategories={selectedCategories}
          onCategoriesChange={(next) =>
            onUpdate('categories', next.length === TRANSACTION_CATEGORIES.length ? undefined : next)
          }
          selectedTypes={selectedTypes}
          onTypesChange={(next) =>
            onUpdate(
              'transaction_types',
              next.length === TRANSACTION_TYPES.length ? undefined : next,
            )
          }
          transfer={draft.linked}
          onTransferChange={(next) => onUpdate('linked', next)}
          attachment={draft.has_attachment}
          onAttachmentChange={(next) => onUpdate('has_attachment', next)}
        />
      </AdvancedFilters>
    </form>
  )
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  )
}

function SearchResults({
  accountIds,
  credentials,
  filters,
  linkSource,
  sort,
  onSortChange,
}: {
  accountIds: number[]
  credentials: CredentialRead[]
  filters: TransactionFilters
  linkSource: { accountId: number; transactionId: number } | null
  sort: TransactionSortKey
  onSortChange: (sort: TransactionSortKey) => void
}) {
  const { t } = useTranslation()
  const query = useSearchTransactions(accountIds, filters)
  const showAccountLabel = accountIds.length > 1
  const accountById = useMemo(() => buildAccountLookup(credentials), [credentials])
  const source = useTransaction(linkSource?.accountId ?? 0, linkSource?.transactionId ?? 0, {
    enabled: linkSource !== null,
  })
  const excludedKeys = useMemo(() => {
    const keys = new Set<string>()
    if (linkSource) keys.add(`${linkSource.accountId}-${linkSource.transactionId}`)
    for (const member of source.data?.flow_members ?? [])
      keys.add(`${member.account_id}-${member.id}`)
    return keys
  }, [linkSource, source.data])
  const results = useMemo(() => {
    const sorted = [...(query.data ?? [])].sort(SORT_COMPARATORS[sort])
    if (!linkSource) return sorted
    return sorted.filter(
      (transaction) =>
        !transaction.pending && !excludedKeys.has(`${transaction.account_id}-${transaction.id}`),
    )
  }, [query.data, sort, linkSource, excludedKeys])

  return (
    <QueryStates
      query={query}
      loadingText={t('common.loading')}
      errorText={t('search.error')}
      isEmpty={results.length === 0}
      emptyText={t('common.noMatchingTransactions')}
    >
      <section aria-label={t('search.resultsHeading')} className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-primary text-sm font-semibold">
            {t('search.resultsCount', { count: results.length })}
          </h2>
          <SortSelect
            ariaLabel={t('search.sortLabel')}
            value={sort}
            onChange={onSortChange}
            options={[
              { value: 'date_desc', label: t('search.sortDateDesc') },
              { value: 'date_asc', label: t('search.sortDateAsc') },
              { value: 'amount_desc', label: t('search.sortAmountDesc') },
              { value: 'amount_asc', label: t('search.sortAmountAsc') },
              { value: 'amount_abs_desc', label: t('search.sortAmountAbsDesc') },
              { value: 'amount_abs_asc', label: t('search.sortAmountAbsAsc') },
            ]}
          />
        </div>
        <ul className="flex flex-col">
          {results.map((transaction) => (
            <ResultRow
              key={`${transaction.account_id}-${transaction.id}`}
              transaction={transaction}
              account={showAccountLabel ? accountById.get(transaction.account_id) : undefined}
              linkSource={linkSource}
            />
          ))}
        </ul>
      </section>
    </QueryStates>
  )
}

function ResultRow({
  transaction,
  account,
  linkSource,
}: {
  transaction: TransactionRead
  account: AccountWithBank | undefined
  linkSource: { accountId: number; transactionId: number } | null
}) {
  const { t } = useTranslation()
  const negative = transaction.amount < 0
  const otherParty = transactionPartyName(transaction) || t('account.unknownParty')
  return (
    <li>
      <Link
        to="/transactions/$transactionId"
        params={{ transactionId: String(transaction.id) }}
        search={
          linkSource
            ? {
                link_account_id: linkSource.accountId,
                link_transaction_id: linkSource.transactionId,
              }
            : undefined
        }
        className="hover:bg-muted/60 grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-md px-2 py-3 transition-colors"
      >
        <CategoryAvatar category={transaction.category} className="size-8" iconClassName="size-4" />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">{otherParty}</span>
          <span className="text-muted-foreground flex items-center gap-1 text-xs">
            <span className="truncate">{formatDate(transaction.date)}</span>
            {account ? (
              <>
                <span aria-hidden="true">·</span>
                <AccountLabel
                  icon={account.bankIcon}
                  bankName={account.bankName ?? account.bank}
                  accountName={accountDisplayName(account)}
                  iconClassName="size-3.5 rounded"
                  nameClassName="truncate"
                  className="gap-1"
                />
              </>
            ) : null}
          </span>
        </span>
        <span
          className={cn(
            'text-sm font-semibold tabular-nums',
            negative ? 'text-destructive' : 'text-success',
          )}
        >
          {formatMoney(transaction.amount)}
        </span>
      </Link>
    </li>
  )
}

function toFilters(search: TransactionSearchParams): TransactionFilters {
  const { account_ids, link_account_id, link_transaction_id, ...filters } = search
  return filters
}
