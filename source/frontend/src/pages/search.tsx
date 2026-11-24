import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
} from 'react'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { useTranslation } from 'react-i18next'
import { ArrowLeftRight, ListChecks, X } from 'lucide-react'

import { BulkEditDialog } from '@/components/bulk-edit-dialog'
import { QueryStates } from '@/components/query-states'
import { TransactionListItem } from '@/components/transaction-list-item'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { AccountMultiSelect } from '@/components/ui/account-multi-select'
import { AdvancedFilters } from '@/components/ui/advanced-filters'
import { AmountRangeFields } from '@/components/ui/amount-range-fields'
import { DateRangeFields } from '@/components/ui/date-range-fields'
import { FilterHeading } from '@/components/ui/filter-heading'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PendingBadge } from '@/components/ui/pending-badge'
import { RefundBadge } from '@/components/ui/refund-badge'
import { SortSelect } from '@/components/ui/sort-select'
import { TransactionFilterFields } from '@/components/ui/transaction-filter-fields'
import type { TransactionRead } from '@/lib/accountHistory'
import { accountDisplayName, defaultAccountIds, sameAccountSelection } from '@/lib/accounts'
import { buildAccountLookup, type AccountWithBank } from '@/lib/accountDisplayGroups'
import { AccountLabel } from '@/components/AccountLabel'
import { type CredentialRead } from '@/lib/auth'
import { formatDate, transactionPartyName } from '@/lib/format'
import { TRANSACTION_TYPES, useTransaction } from '@/lib/transaction'
import { useCategoryCatalog } from '@/lib/categoryCatalog'
import { useSearchTransactions, type TransactionFilters } from '@/lib/transactionSearch'
import {
  SORT_COMPARATORS,
  type TransactionSearchParams,
  type TransactionSortKey,
} from '@/lib/transactionSearchParams'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { SMALL_SCREEN_UP, useMediaQuery } from '@/hooks/useMediaQuery'
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
  const allCategories = useCategoryCatalog().allKeys
  const selectedCategories = draft.categories ?? allCategories
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
            onUpdate('categories', next.length === allCategories.length ? undefined : next)
          }
          selectedTypes={selectedTypes}
          onTypesChange={(next) =>
            onUpdate(
              'transaction_types',
              next.length === TRANSACTION_TYPES.length ? undefined : next,
            )
          }
          related={draft.linked}
          onRelatedChange={(next) => onUpdate('linked', next)}
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
  const wideScreen = useMediaQuery(SMALL_SCREEN_UP)
  const showAccountLabel = accountIds.length > 1
  const accountById = useMemo(() => buildAccountLookup(credentials), [credentials])
  const source = useTransaction(linkSource?.accountId ?? 0, linkSource?.transactionId ?? 0, {
    enabled: linkSource !== null,
  })
  const excludedKeys = useMemo(() => {
    const keys = new Set<string>()
    if (linkSource) keys.add(`${linkSource.accountId}-${linkSource.transactionId}`)
    for (const member of source.data?.related_transactions ?? [])
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

  const [selecting, setSelecting] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [editing, setEditing] = useState(false)
  const isSelectable = (transaction: TransactionRead) =>
    !transaction.pending && (accountById.get(transaction.account_id)?.writable ?? false)
  const selectable = results.filter(isSelectable)
  const selected = selectable.filter((transaction) => selectedIds.has(transaction.id))
  const stopSelecting = () => {
    setSelecting(false)
    setEditing(false)
    setSelectedIds(new Set())
  }
  const toggle = (transactionId: number, checked: boolean) =>
    setSelectedIds((previous) => {
      const next = new Set(previous)
      if (checked) next.add(transactionId)
      else next.delete(transactionId)
      return next
    })

  return (
    <QueryStates
      query={query}
      loadingText={t('common.loading')}
      errorText={t('search.error')}
      isEmpty={results.length === 0}
      emptyText={t('common.noMatchingTransactions')}
    >
      <section aria-label={t('search.resultsHeading')} className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-primary shrink-0 text-sm font-semibold">
            {t('common.transactionCount', { count: results.length })}
          </h2>
          <div className="ml-auto min-w-0 flex-1 sm:w-60 sm:flex-none">
            <SortSelect
              ariaLabel={t('search.sortLabel')}
              value={sort}
              onChange={onSortChange}
              width="full"
              options={[
                { value: 'date_desc', label: t('search.sortDateDesc') },
                { value: 'date_asc', label: t('search.sortDateAsc') },
                { value: 'amount_desc', label: t('search.sortAmountDesc') },
                { value: 'amount_asc', label: t('search.sortAmountAsc') },
                {
                  value: 'amount_abs_desc',
                  label: t(
                    wideScreen ? 'search.sortAmountAbsDesc' : 'search.sortAmountAbsDescShort',
                  ),
                },
                {
                  value: 'amount_abs_asc',
                  label: t(wideScreen ? 'search.sortAmountAbsAsc' : 'search.sortAmountAbsAscShort'),
                },
              ]}
            />
          </div>
          {linkSource ? null : (
            <Button
              type="button"
              variant="outline"
              className="shrink-0"
              aria-label={selecting ? t('common.cancel') : t('bulkEdit.select')}
              onClick={() => (selecting ? stopSelecting() : setSelecting(true))}
            >
              {selecting ? (
                <X className="size-4" aria-hidden="true" />
              ) : (
                <ListChecks className="size-4" aria-hidden="true" />
              )}
              <span className="hidden sm:inline">
                {selecting ? t('common.cancel') : t('bulkEdit.select')}
              </span>
            </Button>
          )}
        </div>
        {selecting ? (
          <label className="flex cursor-pointer items-center gap-3 px-2 text-sm">
            <Checkbox
              checked={
                selected.length === 0
                  ? false
                  : selected.length === selectable.length
                    ? true
                    : 'indeterminate'
              }
              disabled={selectable.length === 0}
              onCheckedChange={(checked) =>
                setSelectedIds(
                  new Set(checked === true ? selectable.map((transaction) => transaction.id) : []),
                )
              }
            />
            {t('bulkEdit.selectAll', { count: selectable.length })}
          </label>
        ) : null}
        <VirtualResultList
          results={results}
          showAccountLabel={showAccountLabel}
          accountById={accountById}
          linkSource={linkSource}
          selection={selecting ? { selectedIds, isSelectable, onToggle: toggle } : undefined}
        />
        {selecting ? (
          <div className="bg-background sticky bottom-[calc(var(--bottom-bar-height)+0.5rem)] flex items-center justify-between gap-2 rounded-lg border p-2 shadow-sm sm:bottom-4">
            <span className="px-1 text-sm font-medium">
              {t('bulkEdit.selected', { count: selected.length })}
            </span>
            <Button type="button" disabled={selected.length === 0} onClick={() => setEditing(true)}>
              {t('common.edit')}
            </Button>
          </div>
        ) : null}
        {editing ? (
          <BulkEditDialog
            transactions={selected}
            accountById={accountById}
            onClose={() => setEditing(false)}
            onApplied={stopSelecting}
          />
        ) : null}
      </section>
    </QueryStates>
  )
}

const ROW_HEIGHT = 60
const SELECTION_ROW_HEIGHT = 76

interface ResultSelection {
  selectedIds: Set<number>
  isSelectable: (transaction: TransactionRead) => boolean
  onToggle: (transactionId: number, checked: boolean) => void
}

function VirtualResultList({
  results,
  showAccountLabel,
  accountById,
  linkSource,
  selection,
}: {
  results: TransactionRead[]
  showAccountLabel: boolean
  accountById: Map<number, AccountWithBank>
  linkSource: { accountId: number; transactionId: number } | null
  selection?: ResultSelection
}) {
  const listRef = useRef<HTMLUListElement>(null)
  const [listTop, setListTop] = useState(0)
  useLayoutEffect(() => setListTop(listRef.current?.offsetTop ?? 0), [])
  // While selecting, each row shows the purpose in an extra line
  const rowHeight = selection ? SELECTION_ROW_HEIGHT : ROW_HEIGHT
  const virtualizer = useWindowVirtualizer({
    count: results.length,
    estimateSize: () => rowHeight,
    overscan: 10,
    scrollMargin: listTop,
  })
  useEffect(() => virtualizer.measure(), [virtualizer, rowHeight])
  return (
    <ul ref={listRef} className="flex flex-col">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((item) => {
          const transaction = results[item.index]
          return (
            <ResultRow
              key={`${transaction.account_id}-${transaction.id}`}
              transaction={transaction}
              account={showAccountLabel ? accountById.get(transaction.account_id) : undefined}
              linkSource={linkSource}
              selection={
                selection
                  ? {
                      checked: selection.selectedIds.has(transaction.id),
                      disabled: !selection.isSelectable(transaction),
                      onCheckedChange: (checked) => selection.onToggle(transaction.id, checked),
                    }
                  : undefined
              }
              style={{
                height: rowHeight,
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${item.start - listTop}px)`,
              }}
            />
          )
        })}
      </div>
    </ul>
  )
}

function ResultRow({
  transaction,
  account,
  linkSource,
  selection,
  style,
}: {
  transaction: TransactionRead
  account: AccountWithBank | undefined
  linkSource: { accountId: number; transactionId: number } | null
  selection?: ComponentProps<typeof TransactionListItem>['selection']
  style?: CSSProperties
}) {
  const { t } = useTranslation()
  const otherParty = transactionPartyName(transaction) || t('common.unknown')
  const purpose = transaction.purpose?.trim()
  return (
    <TransactionListItem
      transaction={transaction}
      party={otherParty}
      badges={
        <>
          <PendingBadge pending={transaction.pending} />
          <RefundBadge status={transaction.refund_status} />
        </>
      }
      linkSearch={
        linkSource
          ? {
              link_account_id: linkSource.accountId,
              link_transaction_id: linkSource.transactionId,
            }
          : undefined
      }
      selection={selection}
      className="px-2 py-1.5"
      style={style}
      subline={
        <>
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
          {/* While picking, the purpose tells apart payments to the same party */}
          {selection && purpose ? (
            <span className="text-muted-foreground truncate text-xs">{purpose}</span>
          ) : null}
        </>
      }
    />
  )
}

function toFilters(search: TransactionSearchParams): TransactionFilters {
  const { account_ids, link_account_id, link_transaction_id, ...filters } = search
  return filters
}
