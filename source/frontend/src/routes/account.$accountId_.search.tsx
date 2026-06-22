import { useMemo, useState, type FormEvent } from 'react'
import { Link, createFileRoute, useCanGoBack, useNavigate, useRouter } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ChevronLeft } from 'lucide-react'
import { z } from 'zod'

import { AccountMultiSelect } from '@/components/ui/account-multi-select'
import { AmountInput } from '@/components/ui/amount-input'
import { Button } from '@/components/ui/button'
import { DateRangeFields } from '@/components/ui/date-range-fields'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { TransactionFilterFields } from '@/components/ui/transaction-filter-fields'
import type { TransactionRead } from '@/lib/accountHistory'
import { accountDisplayName } from '@/lib/accounts'
import { useAuthMe, type CredentialRead } from '@/lib/auth'
import { formatDate, formatEuro, formatIban } from '@/lib/format'
import { TRANSACTION_CATEGORIES, TRANSACTION_TYPES } from '@/lib/transaction'
import { useSearchTransactions, type TransactionFilters } from '@/lib/transactionSearch'
import { cn } from '@/lib/utils'

// URL-state schema. Everything optional; an empty URL renders an empty form
// and skips the query (no "run search on mount" — user must press Submit).
const searchParamsSchema = z.object({
  text: z.string().optional(),
  amount_from: z.coerce.number().optional(),
  amount_to: z.coerce.number().optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  transaction_types: z
    .union([z.enum(TRANSACTION_TYPES), z.array(z.enum(TRANSACTION_TYPES))])
    .transform((value) => (Array.isArray(value) ? value : [value]))
    .optional(),
  categories: z
    .union([z.enum(TRANSACTION_CATEGORIES), z.array(z.enum(TRANSACTION_CATEGORIES))])
    .transform((value) => (Array.isArray(value) ? value : [value]))
    .optional(),
  linked: z.enum(['linked', 'unlinked']).optional(),
  account_ids: z
    .union([z.array(z.coerce.number()), z.coerce.number()])
    .transform((value) => (Array.isArray(value) ? value : [value]))
    .optional(),
  submitted: z.literal('1').optional(),
})

export type TransactionSearchParams = z.infer<typeof searchParamsSchema>

export const Route = createFileRoute('/account/$accountId_/search')({
  component: TransactionSearchPage,
  validateSearch: (search) => searchParamsSchema.parse(search),
})

function TransactionSearchPage() {
  const { accountId: rawId } = Route.useParams()
  const accountId = Number(rawId)
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const { data: user } = useAuthMe()

  if (!user) return null // root guard already redirected

  return (
    <TransactionSearchView
      anchorAccountId={accountId}
      credentials={user.credentials}
      search={search}
      onSubmit={({ accountIds, filters }) =>
        navigate({
          search: {
            ...filters,
            account_ids: accountIds,
            submitted: '1',
          } as TransactionSearchParams,
          replace: false,
        })
      }
    />
  )
}

export interface TransactionSearchViewProps {
  anchorAccountId: number
  credentials: CredentialRead[]
  search: TransactionSearchParams
  onSubmit: (payload: { accountIds: number[]; filters: TransactionFilters }) => void
}

export function TransactionSearchView({
  anchorAccountId,
  credentials,
  search,
  onSubmit,
}: TransactionSearchViewProps) {
  const { t } = useTranslation()
  const initialAccountIds = search.account_ids ?? [anchorAccountId]
  const submittedAccountIds = search.account_ids ?? []

  return (
    <main className="mx-auto flex min-h-full max-w-3xl flex-col gap-6 p-4">
      <header className="flex items-center gap-2">
        <BackLink accountId={anchorAccountId} />
        <h1 className="text-foreground text-lg font-semibold">{t('search.title')}</h1>
      </header>

      <SearchForm
        // `key` resets the form's local draft when the URL search changes
        // (e.g. the user opens a deep-link with prefilled filters).
        key={JSON.stringify(search)}
        credentials={credentials}
        initialAccountIds={initialAccountIds}
        initialFilters={toFilters(search)}
        onSubmit={onSubmit}
      />

      {search.submitted ? (
        <SearchResults
          accountIds={submittedAccountIds}
          credentials={credentials}
          filters={toFilters(search)}
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
  initialAccountIds,
  initialFilters,
  onSubmit,
}: {
  credentials: CredentialRead[]
  initialAccountIds: number[]
  initialFilters: TransactionFilters
  onSubmit: (payload: { accountIds: number[]; filters: TransactionFilters }) => void
}) {
  const { t } = useTranslation()
  const [accountIds, setAccountIds] = useState<number[]>(initialAccountIds)
  const [draft, setDraft] = useState<TransactionFilters>(initialFilters)
  // The from/to amount signs are independent, but the range must stay ordered:
  // "from +, to −" is nonsensical, so making "to" negative pulls "from" negative
  // too, and making "from" positive pushes "to" positive too. Every other combo
  // (incl. from −, to +) is left untouched.
  const [fromNegative, setFromNegative] = useState<boolean>((initialFilters.amount_from ?? 0) < 0)
  const [toNegative, setToNegative] = useState<boolean>((initialFilters.amount_to ?? 0) < 0)

  const handleFromNegativeChange = (next: boolean) => {
    setFromNegative(next)
    if (!next) setToNegative(false)
  }
  const handleToNegativeChange = (next: boolean) => {
    setToNegative(next)
    if (next) setFromNegative(true)
  }

  const update = <K extends keyof TransactionFilters>(key: K, value: TransactionFilters[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }))

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    onSubmit({ accountIds, filters: draft })
  }

  const selectedCategories = draft.categories ?? [...TRANSACTION_CATEGORIES]
  const selectedTypes = draft.transaction_types ?? [...TRANSACTION_TYPES]

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <Field id="search-accounts" label={t('search.accountsLabel')}>
        <AccountMultiSelect
          id="search-accounts"
          credentials={credentials}
          selectedIds={accountIds}
          onChange={setAccountIds}
        />
      </Field>

      <Field id="search-text" label={t('search.text')}>
        <Input
          id="search-text"
          type="search"
          inputMode="search"
          value={draft.text ?? ''}
          onChange={(event) => update('text', event.target.value)}
          placeholder={t('search.textPlaceholder')}
        />
      </Field>

      <Pair>
        <Field id="search-amount-from" label={t('search.amountFrom')}>
          <AmountInput
            id="search-amount-from"
            value={draft.amount_from}
            onChange={(value) => update('amount_from', value)}
            negative={fromNegative}
            onNegativeChange={handleFromNegativeChange}
          />
        </Field>
        <Field id="search-amount-to" label={t('search.amountTo')}>
          <AmountInput
            id="search-amount-to"
            value={draft.amount_to}
            onChange={(value) => update('amount_to', value)}
            negative={toNegative}
            onNegativeChange={handleToNegativeChange}
          />
        </Field>
      </Pair>

      <DateRangeFields
        idPrefix="search"
        placeholder={t('search.datePlaceholder')}
        dateFrom={draft.date_from}
        dateTo={draft.date_to}
        onDateFromChange={(next) => update('date_from', next)}
        onDateToChange={(next) => update('date_to', next)}
      />

      <TransactionFilterFields
        idPrefix="search"
        selectedCategories={selectedCategories}
        onCategoriesChange={(next) =>
          update('categories', next.length === TRANSACTION_CATEGORIES.length ? undefined : next)
        }
        selectedTypes={selectedTypes}
        onTypesChange={(next) =>
          update('transaction_types', next.length === TRANSACTION_TYPES.length ? undefined : next)
        }
        transfer={draft.linked}
        onTransferChange={(next) => update('linked', next)}
      />

      <Button type="submit" disabled={accountIds.length === 0}>
        {t('search.submit')}
      </Button>
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

function Pair({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3">{children}</div>
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
}: {
  accountIds: number[]
  credentials: CredentialRead[]
  filters: TransactionFilters
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
  const results = useMemo(
    () => [...(query.data ?? [])].sort(SORT_COMPARATORS[sort]),
    [query.data, sort],
  )

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
        <select
          aria-label={t('search.sortLabel')}
          value={sort}
          onChange={(event) => setSort(event.target.value as SortKey)}
          className="border-input focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-auto rounded-lg border bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:ring-3 dark:bg-input/30"
        >
          <option value="date_desc">{t('search.sortDateDesc')}</option>
          <option value="date_asc">{t('search.sortDateAsc')}</option>
          <option value="amount_desc">{t('search.sortAmountDesc')}</option>
          <option value="amount_asc">{t('search.sortAmountAsc')}</option>
          <option value="amount_abs_desc">{t('search.sortAmountAbsDesc')}</option>
          <option value="amount_abs_asc">{t('search.sortAmountAbsAsc')}</option>
        </select>
      </div>
      <ul className="flex flex-col">
        {results.map((transaction) => (
          <ResultRow
            key={`${transaction.account_id}-${transaction.id}`}
            transaction={transaction}
            accountName={showAccountLabel ? accountNameById.get(transaction.account_id) : undefined}
          />
        ))}
      </ul>
    </section>
  )
}

function ResultRow({
  transaction,
  accountName,
}: {
  transaction: TransactionRead
  accountName: string | undefined
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
        className="hover:bg-muted/60 grid grid-cols-[1fr_auto] items-baseline gap-3 rounded-md px-2 py-3 transition-colors"
      >
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

/**
 * Strip the meta-only `submitted` flag and the `account_ids` list (those go
 * to the API as a separate scoping arg) and re-emit only the actual filter
 * fields. Keeps the URL-state schema and the API-filter schema separate.
 */
function toFilters(search: TransactionSearchParams): TransactionFilters {
  const { submitted: _submitted, account_ids: _accountIds, ...filters } = search
  void _submitted
  void _accountIds
  return filters
}
