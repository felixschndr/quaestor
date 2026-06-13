import { useMemo, useState, type FormEvent } from 'react'
import { Link, createFileRoute, useCanGoBack, useNavigate, useRouter } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ChevronLeft } from 'lucide-react'
import { z } from 'zod'

import { AccountMultiSelect } from '@/components/ui/account-multi-select'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { TransactionRead } from '@/lib/accountHistory'
import { accountDisplayName } from '@/lib/accounts'
import { useAuthMe, type CredentialRead } from '@/lib/auth'
import { formatDate, formatEuro, formatIban } from '@/lib/format'
import {
  TRANSACTION_CATEGORIES,
  TRANSACTION_TYPES,
  type TransactionCategory,
  type TransactionType,
} from '@/lib/transaction'
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
  transaction_type: z.enum(TRANSACTION_TYPES).optional(),
  category: z.enum(TRANSACTION_CATEGORIES).optional(),
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
    <main className="mx-auto flex min-h-full max-w-2xl flex-col gap-6 p-4">
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
  const { t, i18n } = useTranslation()
  const [accountIds, setAccountIds] = useState<number[]>(initialAccountIds)
  const [draft, setDraft] = useState<TransactionFilters>(initialFilters)

  const update = <K extends keyof TransactionFilters>(key: K, value: TransactionFilters[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }))

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    onSubmit({ accountIds, filters: draft })
  }

  const typeOptions = [...TRANSACTION_TYPES].sort((a, b) => {
    if (a === 'ZERO') return 1
    if (b === 'ZERO') return -1
    return t(`transactionType.${a}`).localeCompare(t(`transactionType.${b}`), i18n.language)
  })
  const categoryOptions = [...TRANSACTION_CATEGORIES].sort((a, b) => {
    if (a === 'UNKNOWN') return 1
    if (b === 'UNKNOWN') return -1
    return t(`category.${a}`).localeCompare(t(`category.${b}`), i18n.language)
  })

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
          />
        </Field>
        <Field id="search-amount-to" label={t('search.amountTo')}>
          <AmountInput
            id="search-amount-to"
            value={draft.amount_to}
            onChange={(value) => update('amount_to', value)}
          />
        </Field>
      </Pair>

      <Pair>
        <Field id="search-date-from" label={t('search.dateFrom')}>
          <DatePicker
            id="search-date-from"
            value={draft.date_from ?? ''}
            onChange={(next) => update('date_from', next || undefined)}
            placeholder={t('search.datePlaceholder')}
          />
        </Field>
        <Field id="search-date-to" label={t('search.dateTo')}>
          <DatePicker
            id="search-date-to"
            value={draft.date_to ?? ''}
            onChange={(next) => update('date_to', next || undefined)}
            placeholder={t('search.datePlaceholder')}
          />
        </Field>
      </Pair>

      <Field id="search-type" label={t('search.transactionType')}>
        <NativeSelect
          id="search-type"
          value={draft.transaction_type ?? ''}
          onChange={(event) =>
            update(
              'transaction_type',
              (event.target.value || undefined) as TransactionType | undefined,
            )
          }
        >
          <option value="">{t('search.anyOption')}</option>
          {typeOptions.map((typeValue) => (
            <option key={typeValue} value={typeValue}>
              {t(`transactionType.${typeValue}`)}
            </option>
          ))}
        </NativeSelect>
      </Field>

      <Field id="search-category" label={t('search.category')}>
        <NativeSelect
          id="search-category"
          value={draft.category ?? ''}
          onChange={(event) =>
            update('category', (event.target.value || undefined) as TransactionCategory | undefined)
          }
        >
          <option value="">{t('search.anyOption')}</option>
          {categoryOptions.map((categoryValue) => (
            <option key={categoryValue} value={categoryValue}>
              {t(`category.${categoryValue}`)}
            </option>
          ))}
        </NativeSelect>
      </Field>

      <Field id="search-linked" label={t('search.linked')}>
        <NativeSelect
          id="search-linked"
          value={draft.linked ?? ''}
          onChange={(event) =>
            update('linked', (event.target.value || undefined) as TransactionFilters['linked'])
          }
        >
          <option value="">{t('search.anyOption')}</option>
          <option value="linked">{t('search.linkedYes')}</option>
          <option value="unlinked">{t('search.linkedNo')}</option>
        </NativeSelect>
      </Field>

      <Button type="submit" disabled={accountIds.length === 0}>
        {t('search.submit')}
      </Button>
    </form>
  )
}

/**
 * Amount input that supports negative values on iOS. iOS Safari's decimal
 * pad has no `-` key (no keyboard config exposes it), so the input is split:
 * the magnitude (digits + decimal point) lives in a normal text input that
 * gets the decimal pad on iOS, and the sign lives in a one-tap toggle
 * button. Submitting combines the two into a signed number.
 */
function AmountInput({
  id,
  value,
  onChange,
}: {
  id: string
  value: number | undefined
  onChange: (next: number | undefined) => void
}) {
  const { t } = useTranslation()
  const initialNegative = value !== undefined && value < 0
  const initialMagnitude = value === undefined ? '' : String(Math.abs(value))
  const [magnitude, setMagnitude] = useState<string>(initialMagnitude)
  const [isNegative, setIsNegative] = useState<boolean>(initialNegative)

  const emit = (nextMagnitude: string, nextNegative: boolean) => {
    if (nextMagnitude === '' || nextMagnitude === '.') {
      onChange(undefined)
      return
    }
    const parsed = Number(nextMagnitude)
    if (!Number.isFinite(parsed)) {
      onChange(undefined)
      return
    }
    onChange(nextNegative ? -parsed : parsed)
  }

  return (
    <div className="flex min-w-0 gap-1.5">
      <button
        type="button"
        aria-label={isNegative ? t('search.amountMakePositive') : t('search.amountMakeNegative')}
        aria-pressed={isNegative}
        onClick={() => {
          const next = !isNegative
          setIsNegative(next)
          emit(magnitude, next)
        }}
        className={cn(
          'border-input flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border bg-transparent text-sm font-medium transition-colors',
          'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-3',
          'dark:bg-input/30',
          isNegative ? 'text-destructive' : 'text-success',
        )}
      >
        {isNegative ? '−' : '+'}
      </button>
      <Input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={magnitude}
        onChange={(event) => {
          const raw = event.target.value
          setMagnitude(raw)
          emit(raw, isNegative)
        }}
      />
    </div>
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

function NativeSelect({
  id,
  value,
  onChange,
  children,
}: {
  id: string
  value: string
  onChange: (event: React.ChangeEvent<HTMLSelectElement>) => void
  children: React.ReactNode
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={onChange}
      className="border-input focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full rounded-lg border bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:ring-3 dark:bg-input/30"
    >
      {children}
    </select>
  )
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

  if (query.isLoading) {
    return <p className="text-muted-foreground text-sm">{t('common.loading')}</p>
  }
  if (query.isError) {
    return <p className="text-destructive text-sm">{t('search.error')}</p>
  }
  const results = query.data ?? []
  if (results.length === 0) {
    return <p className="text-muted-foreground text-sm">{t('search.empty')}</p>
  }

  return (
    <section aria-label={t('search.resultsHeading')} className="flex flex-col gap-2">
      <h2 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
        {t('search.resultsCount', { count: results.length })}
      </h2>
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
