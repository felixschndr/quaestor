import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Check, ChevronLeft, Pencil, Plus, RefreshCw, Search, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'

import { useAuthMe, useCredentialSync, type AccountRead } from '@/lib/auth'
import {
  findAccountInUser,
  groupTransactionsByDate,
  useAccountHistory,
  type AccountHistoryPage,
  type TransactionRead,
} from '@/lib/accountHistory'
import { useUpdateAccount } from '@/lib/accounts'
import { useDeleteTransaction } from '@/lib/transaction'
import { formatDate, formatDecimal, formatEuro, formatIban, relativeDateKey } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ManualTransactionForm } from '@/components/manual-transaction-form'
import { TwoFactorModal } from '@/components/two-factor-modal'

const MANUAL_BANK = 'manual'

export const Route = createFileRoute('/account/$accountId')({
  component: AccountDetailPage,
})

function AccountDetailPage() {
  const { accountId: rawId } = Route.useParams()
  const accountId = Number(rawId)
  const { data: user } = useAuthMe()
  const accountInfo = findAccountInUser(user, accountId)

  const history = useAccountHistory(accountId)
  // Hook is unconditional (rules of hooks) — when no credential is in scope yet
  // we pass a sentinel id and skip rendering the button below.
  const sync = useCredentialSync(accountInfo?.credentialId ?? -1)
  const { t } = useTranslation()

  if (!user) return null // Root guard already redirected on 401.

  if (!accountInfo) {
    return <AccountNotFoundView />
  }

  const isManual = accountInfo.bank === MANUAL_BANK
  const isSyncBusy =
    sync.status === 'starting' || sync.status === 'running' || sync.status === 'awaiting_2fa'

  return (
    <>
      <AccountDetailView
        account={accountInfo.account}
        bank={accountInfo.bank}
        pages={history.data?.pages ?? []}
        isFetchingNextPage={history.isFetchingNextPage}
        hasNextPage={!!history.hasNextPage}
        onLoadMore={() => {
          if (history.hasNextPage && !history.isFetchingNextPage) {
            void history.fetchNextPage()
          }
        }}
        // Manual accounts have no remote sync, so the button is suppressed
        // by leaving onSyncClick undefined.
        onSyncClick={isManual ? undefined : sync.start}
        syncDisabled={isSyncBusy}
        syncSpinning={isSyncBusy}
      />
      <TwoFactorModal
        current2fa={sync.current2fa}
        onSubmit={async (code) => {
          try {
            await sync.submit2fa(code)
          } catch {
            const bankTitle = t(`banks.${accountInfo.bank}.title`, {
              defaultValue: accountInfo.bank,
            })
            toast.error(t('sync.failed', { bank: bankTitle }))
          }
        }}
        onSkip={() => {
          const bankTitle = t(`banks.${accountInfo.bank}.title`, {
            defaultValue: accountInfo.bank,
          })
          toast(t('sync.skipped', { bank: bankTitle }))
          sync.skip2fa()
        }}
      />
    </>
  )
}

function AccountNotFoundView() {
  const { t } = useTranslation()
  return (
    <main className="mx-auto max-w-2xl p-4">
      <BackLink />
      <p className="text-muted-foreground mt-6 text-sm">{t('account.notFound')}</p>
    </main>
  )
}

export interface AccountDetailViewProps {
  account: AccountRead
  /** Defaults to undefined for tests; the page sets it from useAuthMe. Manual
   *  accounts unlock the inline edit-balance / add-transaction affordances. */
  bank?: string
  pages: AccountHistoryPage[]
  isFetchingNextPage: boolean
  hasNextPage: boolean
  onLoadMore: () => void
  /** Overridable for tests so "Today" / "Yesterday" labels are deterministic. */
  today?: Date
  /** Wired by the page to {@link useCredentialSync}. Omitted = button hidden
   *  (e.g. manual accounts have no remote sync). */
  onSyncClick?: () => void
  syncDisabled?: boolean
  syncSpinning?: boolean
}

export function AccountDetailView({
  account,
  bank,
  pages,
  isFetchingNextPage,
  hasNextPage,
  onLoadMore,
  today,
  onSyncClick,
  syncDisabled = false,
  syncSpinning = false,
}: AccountDetailViewProps) {
  const { t } = useTranslation()
  const groups = useMemo(() => groupTransactionsByDate(pages), [pages])
  const hasAnyTransactions = groups.length > 0
  const negative = account.balance < 0
  const personalisedName = account.display_name?.trim() || null
  const isManual = bank === MANUAL_BANK
  const [addingTxn, setAddingTxn] = useState(false)

  // The date headers below are sticky too — they need to stop at the bottom
  // edge of this header, not at the viewport top. Measure synchronously
  // before paint so date headers get the right offset on the very first
  // render; ResizeObserver then keeps it in sync if the header reflows.
  const stickyHeaderRef = useRef<HTMLDivElement>(null)
  const [stickyHeaderHeight, setStickyHeaderHeight] = useState(0)
  useLayoutEffect(() => {
    const node = stickyHeaderRef.current
    if (!node) return
    setStickyHeaderHeight(node.getBoundingClientRect().height)
  }, [])
  useEffect(() => {
    const node = stickyHeaderRef.current
    if (!node) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setStickyHeaderHeight(entry.contentRect.height)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return (
    // The header is `position: fixed` (not sticky) so it's permanently on its
    // own compositor layer pinned to the viewport. Sticky elements jitter
    // sub-pixel during slow scrolls because the browser repositions them per
    // frame relative to the scroll offset; fixed elements just stay put.
    // Trade-off: the header is out of normal flow, so the content below gets
    // an explicit padding-top equal to the measured header height.
    <main className="flex min-h-full flex-col">
      <div ref={stickyHeaderRef} className="bg-background fixed top-0 right-0 left-0 z-20">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 pt-4 pb-3">
          <header className="flex items-center justify-between gap-2">
            <BackLink />
            {/* translate-y nudge matches the magnifier below: optical alignment
                with the chevron-shaped back arrow. */}
            <div className="flex translate-y-[6px] items-center gap-1">
              {onSyncClick ? (
                <button
                  type="button"
                  onClick={onSyncClick}
                  disabled={syncDisabled}
                  aria-label={t('account.sync.aria')}
                  className="text-primary hover:text-primary/80 group rounded-md p-1.5 transition-colors disabled:opacity-50"
                >
                  <RefreshCw
                    className={cn(
                      'size-5 transition-transform duration-500 ease-in-out',
                      syncSpinning ? 'animate-spin' : 'group-hover:rotate-[180deg]',
                    )}
                    aria-hidden="true"
                  />
                </button>
              ) : null}
              <Link
                to="/account/$accountId/search"
                params={{ accountId: String(account.id) }}
                aria-label={t('account.search')}
                className="text-primary hover:text-primary/80 rounded-md p-1.5 transition-colors"
              >
                <Search className="size-5" />
              </Link>
            </div>
          </header>

          <section aria-labelledby="account-balance-label" className="flex flex-col gap-2">
            {personalisedName ? (
              <>
                <p className="text-foreground text-xl font-semibold leading-tight">
                  {personalisedName}
                </p>
                <p id="account-balance-label" className="text-muted-foreground text-sm">
                  {formatIban(account.name)}
                </p>
              </>
            ) : (
              <p id="account-balance-label" className="text-muted-foreground text-sm">
                {formatIban(account.name)}
              </p>
            )}
            <BalanceDisplay account={account} isManual={isManual} negative={negative} />
            {isManual ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setAddingTxn((prev) => !prev)}
                >
                  <Plus className="size-3.5" aria-hidden="true" />
                  {t('credentials.manualTransactions.add')}
                </Button>
              </div>
            ) : null}
          </section>
        </div>
      </div>

      <div
        className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pb-4"
        // pt = measured header height + the visual gap (~0.5rem) the old
        // `pt-2` provided between header and first transaction group.
        style={{ paddingTop: `${stickyHeaderHeight + 8}px` }}
      >
        {isManual && addingTxn ? (
          <ManualTransactionForm
            accountId={account.id}
            mode="create"
            onDone={() => setAddingTxn(false)}
          />
        ) : null}

        {hasAnyTransactions ? (
          <TransactionGroupList
            accountId={account.id}
            groups={groups}
            today={today}
            stickyTopOffset={stickyHeaderHeight}
            isManual={isManual}
          />
        ) : (
          <p className="text-muted-foreground text-sm">{t('account.empty')}</p>
        )}

        {hasNextPage ? (
          <InfiniteScrollSentinel onIntersect={onLoadMore} isFetching={isFetchingNextPage} />
        ) : null}
      </div>
    </main>
  )
}

function BalanceDisplay({
  account,
  isManual,
  negative,
}: {
  account: AccountRead
  isManual: boolean
  negative: boolean
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(account.balance))
  const update = useUpdateAccount()

  const parsed = Number(draft.replace(',', '.'))
  const valid = draft.trim() !== '' && Number.isFinite(parsed)

  const commit = async () => {
    if (!valid || parsed === account.balance) {
      setEditing(false)
      return
    }
    try {
      await update.mutateAsync({ accountId: account.id, balance: parsed })
      toast.success(t('credentials.detail.saved'))
      setEditing(false)
    } catch {
      toast.error(t('credentials.detail.saveFailed'))
    }
  }

  const cancel = () => {
    setDraft(String(account.balance))
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="flex items-center gap-2">
        <Input
          autoFocus
          type="number"
          inputMode="decimal"
          step="0.01"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void commit()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              cancel()
            }
          }}
          aria-label={t('credentials.detail.balance')}
          placeholder={formatDecimal(0)}
          className="h-10 max-w-[10rem] text-xl font-semibold tabular-nums"
          aria-invalid={!valid || undefined}
          disabled={update.isPending}
        />
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void commit()}
          aria-label={t('common.save')}
          disabled={update.isPending}
        >
          <Check className="size-4" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onMouseDown={(event) => event.preventDefault()}
          onClick={cancel}
          aria-label={t('common.cancel')}
          disabled={update.isPending}
        >
          <X className="size-4" aria-hidden="true" />
        </Button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <p
        className={cn(
          'text-4xl font-bold tracking-tight tabular-nums',
          negative ? 'text-destructive' : 'text-primary',
        )}
      >
        {formatEuro(account.balance)}
      </p>
      {isManual ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setDraft(String(account.balance))
            setEditing(true)
          }}
          aria-label={t('credentials.detail.balance')}
          className="text-muted-foreground hover:text-foreground"
        >
          <Pencil className="size-4" aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  )
}

function BackLink() {
  const { t } = useTranslation()
  return (
    <Link
      to="/"
      aria-label={t('account.back')}
      className="text-primary hover:text-primary/80 -ml-1.5 rounded-md p-1.5 transition-colors"
    >
      <ChevronLeft className="size-5" />
    </Link>
  )
}

function TransactionGroupList({
  accountId,
  groups,
  today,
  stickyTopOffset = 0,
  isManual = false,
}: {
  accountId: number
  groups: ReturnType<typeof groupTransactionsByDate>
  today?: Date
  /** Pixel offset where date headers should park (height of the page header). */
  stickyTopOffset?: number
  isManual?: boolean
}) {
  return (
    <ul className="flex flex-col gap-6">
      {groups.map((group) => {
        const isFuture = isFutureDateString(group.date, today)
        return (
          <li key={group.date} className="flex flex-col gap-2">
            <DateHeader
              date={group.date}
              endOfDayBalance={group.endOfDayBalance}
              today={today}
              stickyTopOffset={stickyTopOffset}
            />
            <ul className="flex flex-col">
              {group.transactions.map((transaction) => (
                <TransactionRow
                  key={transaction.id}
                  accountId={accountId}
                  transaction={transaction}
                  isFuture={isFuture}
                  isManual={isManual}
                />
              ))}
            </ul>
          </li>
        )
      })}
    </ul>
  )
}

function isFutureDateString(isoDate: string, today?: Date): boolean {
  const [y, m, d] = isoDate.split('-').map(Number)
  const local = new Date(y, m - 1, d)
  const key = relativeDateKey(local, today)
  return key === 'future' || key === 'tomorrow' || key === 'dayAfterTomorrow'
}

function DateHeader({
  date,
  endOfDayBalance,
  today,
  stickyTopOffset,
}: {
  date: string
  endOfDayBalance: number | null
  today?: Date
  stickyTopOffset: number
}) {
  const { t } = useTranslation()
  // ISO yyyy-mm-dd is parsed as UTC by `new Date(...)`; pin to local midnight
  // so the "Today"/"Yesterday" check matches the user's wall clock.
  const [y, m, d] = date.split('-').map(Number)
  const local = new Date(y, m - 1, d)
  const relKey = relativeDateKey(local, today)
  const label =
    relKey === 'future'
      ? t('account.future', { date: formatDate(local) })
      : relKey
        ? t(`account.${relKey}`)
        : formatDate(local)
  return (
    // grid (not flex+justify-between) so the columns have fixed positions and
    // don't reflow as the next sticky header pushes this one out. `top` is the
    // measured page-header height so the date header parks just beneath it
    // instead of fighting it at top:0.
    <header
      className="bg-background sticky z-[1] grid grid-cols-[1fr_auto] items-baseline gap-2 py-1"
      style={{ top: `${stickyTopOffset}px` }}
    >
      <h2 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">{label}</h2>
      {endOfDayBalance !== null ? (
        <span className="text-muted-foreground text-xs tabular-nums">
          {formatEuro(endOfDayBalance)}
        </span>
      ) : null}
    </header>
  )
}

function TransactionRow({
  accountId,
  transaction,
  isFuture = false,
  isManual = false,
}: {
  accountId: number
  transaction: TransactionRead
  /** Future-dated transactions aren't reflected in account.balance yet — render
   *  them muted so the user understands they're informational, not booked. */
  isFuture?: boolean
  /** Manual accounts get inline edit + delete buttons in place of the
   *  navigate-to-detail link. */
  isManual?: boolean
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const remove = useDeleteTransaction(accountId)

  const negative = transaction.amount < 0
  const otherParty = formatIban(transaction.other_party?.trim() || '') || t('account.unknownParty')

  if (editing) {
    return (
      <li className="py-2">
        <ManualTransactionForm
          accountId={accountId}
          mode="edit"
          transaction={transaction}
          onDone={() => setEditing(false)}
        />
      </li>
    )
  }

  if (!isManual) {
    return (
      <li>
        <Link
          to="/account/$accountId/transactions/$transactionId"
          params={{ accountId: String(accountId), transactionId: String(transaction.id) }}
          className={cn(
            'hover:bg-muted/60 flex items-center gap-3 rounded-md py-3 pl-3 transition-colors',
            isFuture && 'opacity-60',
          )}
        >
          <span className="flex-1 truncate text-sm font-medium">{otherParty}</span>
          <span
            className={cn(
              'text-sm font-semibold tabular-nums',
              // Future txns get a neutral color: the destructive/success accent
              // implies "this moved money" which isn't true until the date arrives.
              isFuture ? 'text-muted-foreground' : negative ? 'text-destructive' : 'text-success',
            )}
          >
            {formatEuro(transaction.amount)}
          </span>
        </Link>
      </li>
    )
  }

  const onDelete = async () => {
    try {
      await remove.mutateAsync(transaction.id)
      toast.success(t('credentials.manualTransactions.deleted'))
    } catch {
      toast.error(t('credentials.manualTransactions.deleteFailed'))
      setConfirmingDelete(false)
    }
  }

  return (
    <li
      className={cn(
        'flex items-center gap-3 rounded-md py-3 pl-2 transition-colors',
        isFuture && 'opacity-60',
      )}
    >
      <span className="flex-1 truncate text-sm font-medium">{otherParty}</span>
      <span
        className={cn(
          'text-sm font-semibold tabular-nums',
          isFuture ? 'text-muted-foreground' : negative ? 'text-destructive' : 'text-success',
        )}
      >
        {formatEuro(transaction.amount)}
      </span>
      {confirmingDelete ? (
        <div className="flex gap-1">
          <Button
            type="button"
            size="sm"
            variant="destructive"
            onClick={() => void onDelete()}
            disabled={remove.isPending}
          >
            {t('credentials.manualTransactions.deleteConfirm')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setConfirmingDelete(false)}
            disabled={remove.isPending}
          >
            {t('credentials.manualTransactions.cancel')}
          </Button>
        </div>
      ) : (
        <div className="flex gap-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setEditing(true)}
            aria-label={t('credentials.manualTransactions.edit')}
            className="text-muted-foreground hover:text-foreground"
          >
            <Pencil className="size-3.5" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setConfirmingDelete(true)}
            aria-label={t('credentials.manualTransactions.delete')}
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
          </Button>
        </div>
      )}
    </li>
  )
}

function InfiniteScrollSentinel({
  onIntersect,
  isFetching,
}: {
  onIntersect: () => void
  isFetching: boolean
}) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const onIntersectRef = useRef(onIntersect)
  useEffect(() => {
    onIntersectRef.current = onIntersect
  }, [onIntersect])

  useEffect(() => {
    const node = ref.current
    if (!node) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) onIntersectRef.current()
        }
      },
      // Pre-fetch a bit before the user actually hits the sentinel so the next
      // page is on-screen by the time they scroll there.
      { rootMargin: '200px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={ref} className="text-muted-foreground py-4 text-center text-xs">
      {isFetching ? t('account.loadingMore') : null}
    </div>
  )
}
