import { useEffect, useMemo, useState } from 'react'
import { Link, useCanGoBack, useRouter } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ArrowLeftRight, ChevronLeft } from 'lucide-react'

import { AccountMultiSelect } from '@/components/ui/account-multi-select'
import { AmountRangeFields } from '@/components/ui/amount-range-fields'
import { DateRangeFields } from '@/components/ui/date-range-fields'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SingleSelectPopover } from '@/components/ui/single-select-popover'
import { TransactionFilterFields } from '@/components/ui/transaction-filter-fields'
import type { TransactionRead } from '@/lib/accountHistory'
import { accountDisplayName } from '@/lib/accounts'
import { type CredentialRead } from '@/lib/auth'
import { formatDate, formatEuro, formatIban } from '@/lib/format'
import { CategoryAvatar } from '@/lib/categoryIcons'
import { TRANSACTION_CATEGORIES, TRANSACTION_TYPES } from '@/lib/transaction'
import { useSearchTransactions, type TransactionFilters } from '@/lib/transactionSearch'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { cn } from '@/lib/utils'
import type {
  TransactionSearchParams,
  TransactionSearchViewProps,
} from '@/routes/account.$accountId_.search'

export function TransactionSearchView({
  anchorAccountId,
  credentials,
  search,
  onChange,
}: TransactionSearchViewProps) {
  const { t } = useTranslation()
  const [accountIds, setAccountIds] = useState<number[]>(search.account_ids ?? [anchorAccountId])
  const [draft, setDraft] = useState<TransactionFilters>(toFilters(search))

  const update = <K extends keyof TransactionFilters>(key: K, value: TransactionFilters[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }))

  const debouncedDraft = useDebouncedValue(draft, 300)

  const hasSelection =
    accountIds.length > 0 &&
    debouncedDraft.categories?.length !== 0 &&
    debouncedDraft.transaction_types?.length !== 0

  useEffect(() => {
    onChange({ accountIds, filters: debouncedDraft })
  }, [accountIds, debouncedDraft, onChange])

  const linkSource =
    search.link_account_id !== undefined && search.link_transaction_id !== undefined
      ? { accountId: search.link_account_id, transactionId: search.link_transaction_id }
      : null

  return (
    <main className="mx-auto flex min-h-full max-w-3xl flex-col gap-6 p-4">
      <header className="flex items-center gap-2">
        <BackLink accountId={anchorAccountId} />
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
      />

      {hasSelection ? (
        <SearchResults
          accountIds={accountIds}
          credentials={credentials}
          filters={debouncedDraft}
          linkSource={linkSource}
        />
      ) : null}
    </main>
  )
}

function BackLink({ accountId }: { accountId: number }) {
  const { t } = useTranslation()
  const router = useRouter()
  const canGoBack = useCanGoBack()
  return (
    <Link
      to="/account/$accountId"
      params={{ accountId: String(accountId) }}
      onClick={(event) => {
        if (canGoBack) {
          event.preventDefault()
          router.history.back()
        }
      }}
      aria-label={t('search.back')}
      className="text-primary hover:text-primary/80 -ml-1.5 rounded-md p-1.5 transition-colors"
    >
      <ChevronLeft className="size-5" />
    </Link>
  )
}

function SearchForm({
  credentials,
  accountIds,
  onAccountIdsChange,
  draft,
  onUpdate,
}: {
  credentials: CredentialRead[]
  accountIds: number[]
  onAccountIdsChange: (ids: number[]) => void
  draft: TransactionFilters
  onUpdate: <K extends keyof TransactionFilters>(key: K, value: TransactionFilters[K]) => void
}) {
  const { t } = useTranslation()
  const selectedCategories = draft.categories ?? [...TRANSACTION_CATEGORIES]
  const selectedTypes = draft.transaction_types ?? [...TRANSACTION_TYPES]

  return (
    <form onSubmit={(event) => event.preventDefault()} noValidate className="flex flex-col gap-4">
      <Field id="search-accounts" label={t('search.accountsLabel')}>
        <AccountMultiSelect
          id="search-accounts"
          credentials={credentials}
          selectedIds={accountIds}
          onChange={onAccountIdsChange}
        />
      </Field>

      <Field id="search-text" label={t('search.text')}>
        <Input
          id="search-text"
          type="search"
          inputMode="search"
          value={draft.text ?? ''}
          onChange={(event) => onUpdate('text', event.target.value)}
          placeholder={t('search.textPlaceholder')}
        />
      </Field>

      <AmountRangeFields
        idPrefix="search"
        fromLabel={t('search.amountFrom')}
        toLabel={t('search.amountTo')}
        from={draft.amount_from}
        to={draft.amount_to}
        onFromChange={(value) => onUpdate('amount_from', value)}
        onToChange={(value) => onUpdate('amount_to', value)}
      />

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
          onUpdate('transaction_types', next.length === TRANSACTION_TYPES.length ? undefined : next)
        }
        transfer={draft.linked}
        onTransferChange={(next) => onUpdate('linked', next)}
      />
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

type SortKey =
  | 'date_desc'
  | 'date_asc'
  | 'amount_desc'
  | 'amount_asc'
  | 'amount_abs_desc'
  | 'amount_abs_asc'

const SORT_COMPARATORS: Record<SortKey, (a: TransactionRead, b: TransactionRead) => number> = {
  date_desc: (a, b) => b.date.localeCompare(a.date) || b.id - a.id,
  date_asc: (a, b) => a.date.localeCompare(b.date) || a.id - b.id,
  amount_desc: (a, b) => b.amount - a.amount || b.id - a.id,
  amount_asc: (a, b) => a.amount - b.amount || a.id - b.id,
  amount_abs_desc: (a, b) => Math.abs(b.amount) - Math.abs(a.amount) || b.id - a.id,
  amount_abs_asc: (a, b) => Math.abs(a.amount) - Math.abs(b.amount) || a.id - b.id,
}

function SearchResults({
  accountIds,
  credentials,
  filters,
  linkSource,
}: {
  accountIds: number[]
  credentials: CredentialRead[]
  filters: TransactionFilters
  linkSource: { accountId: number; transactionId: number } | null
}) {
  const { t } = useTranslation()
  const query = useSearchTransactions(accountIds, filters)
  const [sort, setSort] = useState<SortKey>('date_desc')
  // Only show the per-row account label when the search spans more than
  // one account — otherwise it'd be redundant.
  const showAccountLabel = accountIds.length > 1
  const accountNameById = useMemo(() => {
    const map = new Map<number, string>()
    for (const credential of credentials) {
      for (const account of credential.accounts) map.set(account.id, accountDisplayName(account))
    }
    return map
  }, [credentials])
  const results = useMemo(() => {
    const sorted = [...(query.data ?? [])].sort(SORT_COMPARATORS[sort])
    if (!linkSource) return sorted
    return sorted.filter(
      (transaction) =>
        transaction.account_id !== linkSource.accountId ||
        transaction.id !== linkSource.transactionId,
    )
  }, [query.data, sort, linkSource])

  if (query.isLoading) {
    return <p className="text-muted-foreground text-sm">{t('common.loading')}</p>
  }
  if (query.isError) {
    return <p className="text-destructive text-sm">{t('search.error')}</p>
  }
  if (results.length === 0) {
    return <p className="text-muted-foreground text-sm">{t('search.empty')}</p>
  }

  return (
    <section aria-label={t('search.resultsHeading')} className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
          {t('search.resultsCount', { count: results.length })}
        </h2>
        <SingleSelectPopover
          ariaLabel={t('search.sortLabel')}
          value={sort}
          onChange={setSort}
          className="w-auto"
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
            accountName={showAccountLabel ? accountNameById.get(transaction.account_id) : undefined}
            linkSource={linkSource}
          />
        ))}
      </ul>
    </section>
  )
}

function ResultRow({
  transaction,
  accountName,
  linkSource,
}: {
  transaction: TransactionRead
  accountName: string | undefined
  linkSource: { accountId: number; transactionId: number } | null
}) {
  const { t } = useTranslation()
  const negative = transaction.amount < 0
  const otherParty = formatIban(transaction.other_party?.trim() || '') || t('account.unknownParty')
  return (
    <li>
      <Link
        to="/account/$accountId/transactions/$transactionId"
        params={{
          accountId: String(transaction.account_id),
          transactionId: String(transaction.id),
        }}
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
          <span className="text-muted-foreground truncate text-xs">
            {formatDate(transaction.date)}
            {accountName ? ` · ${accountName}` : ''}
          </span>
        </span>
        <span
          className={cn(
            'text-sm font-semibold tabular-nums',
            negative ? 'text-destructive' : 'text-success',
          )}
        >
          {formatEuro(transaction.amount)}
        </span>
      </Link>
    </li>
  )
}

function toFilters(search: TransactionSearchParams): TransactionFilters {
  const {
    account_ids: _accountIds,
    link_account_id: _linkAccountId,
    link_transaction_id: _linkTransactionId,
    ...filters
  } = search
  void _accountIds
  void _linkAccountId
  void _linkTransactionId
  return filters
}
