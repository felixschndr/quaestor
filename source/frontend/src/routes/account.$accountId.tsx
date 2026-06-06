import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, createFileRoute, useLocation } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Check, ChevronLeft, Copy, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
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
import {
  formatDate,
  formatDecimal,
  formatEuro,
  formatIban,
  isIban,
  relativeDateKey,
} from '@/lib/format'
import { cn } from '@/lib/utils'
import { copyText } from '@/lib/clipboard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ManualTransactionForm } from '@/components/manual-transaction-form'
import { StatsIcon } from '@/components/stats-icon'
import { SyncButton } from '@/components/sync-button'
import { TwoFactorModal } from '@/components/two-factor-modal'

const MANUAL_BANK = 'manual'

export const Route = createFileRoute('/account/$accountId')({
  component: AccountDetailPage,
  validateSearch: (search: Record<string, unknown>): { focus?: number } => {
    const focus = Number(search.focus)
    return Number.isFinite(focus) && focus > 0 ? { focus } : {}
  },
})

/** Muted IBAN label with a copy-to-clipboard button when `value` is an IBAN.
 *  Non-IBAN names (e.g. "Girokonto") render as plain text without a button. */
function IbanLabel({ value, id }: { value: string; id?: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const copyTimeout = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => () => clearTimeout(copyTimeout.current), [])

  if (!isIban(value)) {
    return (
      <p id={id} className="text-muted-foreground text-sm">
        {formatIban(value)}
      </p>
    )
  }

  const handleCopy = async () => {
    try {
      await copyText(value.replace(/\s+/g, ''))
      setCopied(true)
      clearTimeout(copyTimeout.current)
      copyTimeout.current = setTimeout(() => setCopied(false), 2000)
      toast.success(t('account.iban.copied'))
    } catch {
      toast.error(t('account.iban.copyFailed'))
    }
  }

  return (
    <p id={id} className="text-muted-foreground flex items-center gap-1.5 text-sm">
      {formatIban(value)}
      <button
        type="button"
        onClick={handleCopy}
        aria-label={t('account.iban.copy')}
        className="hover:text-foreground -m-0.5 rounded p-0.5 transition-colors"
      >
        {copied ? (
          <Check className="text-success size-3.5" aria-hidden="true" />
        ) : (
          <Copy className="size-3.5" aria-hidden="true" />
        )}
      </button>
    </p>
  )
}

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
  const { focus } = Route.useSearch()
  // Unique per history entry; a fresh navigation to the same `focus` id (e.g.
  // clicking the same linked transaction again after going back) yields a new
  // key, which re-arms the scroll/highlight that the one-shot guard would
  // otherwise suppress. `__TSR_key` is the entry key TanStack itself keys scroll
  // restoration on; `state.key` is undefined on some navigation paths.
  const focusNavKey = useLocation({ select: (location) => location.state.__TSR_key })

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
        focusTransactionId={focus}
        focusNavKey={focusNavKey}
        // Manual accounts have no remote sync, so the button is suppressed
        // by leaving onSyncClick undefined.
        onSyncClick={isManual ? undefined : sync.start}
        syncDisabled={isSyncBusy}
        syncSpinning={isSyncBusy}
        syncSucceededAt={sync.succeededAt}
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
  /** Passed straight to the {@link SyncButton}; a fresh Date.now() value
   *  triggers the green-check zoom animation. */
  syncSucceededAt?: number | null
  /** When set: load history pages until this transaction is present, then
   *  smooth-scroll to it and briefly highlight it (deep-link from a counterpart). */
  focusTransactionId?: number
  /** Unique per navigation. The scroll/highlight one-shot guard is keyed on this
   *  so re-navigating to the same focus id (e.g. clicking the same linked
   *  transaction again) re-triggers it, while page loads within one visit don't. */
  focusNavKey?: string
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
  syncSucceededAt = null,
  focusTransactionId,
  focusNavKey,
}: AccountDetailViewProps) {
  const { t } = useTranslation()
  const groups = useMemo(() => groupTransactionsByDate(pages), [pages])
  const hasAnyTransactions = groups.length > 0

  const [highlightId, setHighlightId] = useState<number | null>(null)
  // Keep the latest onLoadMore without listing it as an effect dependency: the
  // parent passes a fresh arrow on every render, which would otherwise re-run
  // the focus effect (and re-fire scrollIntoView) on every render and fight the
  // user's scroll. Mirrors the ref pattern used by InfiniteScrollSentinel below.
  const onLoadMoreRef = useRef(onLoadMore)
  useEffect(() => {
    onLoadMoreRef.current = onLoadMore
  }, [onLoadMore])
  // One-shot guard: once we've scrolled for a given navigation, don't scroll
  // again when groups change as further pages load. Keyed on the navigation key
  // (falling back to the focus id when none is provided, e.g. in unit tests) so
  // a fresh navigation to the same focus id re-arms the scroll/highlight.
  const scrolledForRef = useRef<string | number | null>(null)
  useEffect(() => {
    if (!focusTransactionId) return
    const guardKey = focusNavKey ?? focusTransactionId
    if (scrolledForRef.current === guardKey) return
    const isLoaded = groups.some((group) =>
      group.transactions.some((transaction) => transaction.id === focusTransactionId),
    )
    if (!isLoaded) {
      if (hasNextPage && !isFetchingNextPage) onLoadMoreRef.current()
      return
    }
    const element = document.getElementById(`transaction-${focusTransactionId}`)
    if (!element) return
    scrolledForRef.current = guardKey
    element.scrollIntoView({ behavior: 'smooth', block: 'center' })
    // Set the highlight synchronously rather than via a 0ms timer: a quick
    // re-render right after the guard is armed (common with cached data) would
    // otherwise run this effect's cleanup, cancel the pending timer, and then
    // early-return on the guard — so the highlight was lost on every navigation
    // after the first. The one-shot guard above keeps this from looping.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHighlightId(focusTransactionId)
  }, [focusTransactionId, focusNavKey, groups, hasNextPage, isFetchingNextPage])
  // Clear the highlight ~4s after it appears. Keyed only on highlightId so
  // unrelated re-renders (e.g. pages loading) can't cancel the timer.
  useEffect(() => {
    if (highlightId === null) return
    const timer = setTimeout(() => setHighlightId(null), 4000)
    return () => clearTimeout(timer)
  }, [highlightId])
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
                <SyncButton
                  onClick={onSyncClick}
                  spinning={syncSpinning}
                  disabled={syncDisabled}
                  succeededAt={syncSucceededAt}
                  ariaLabel={t('account.sync.aria')}
                />
              ) : null}
              <Link
                to="/stats"
                search={{ account_ids: [account.id] }}
                aria-label={t('account.statistics')}
                className="text-primary hover:text-primary/80 group rounded-md p-1.5 transition-colors"
              >
                <StatsIcon className="size-5" />
              </Link>
              <Link
                to="/account/$accountId/search"
                params={{ accountId: String(account.id) }}
                aria-label={t('account.search')}
                className="text-primary hover:text-primary/80 group rounded-md p-1.5 transition-colors"
              >
                <Search className="search-icon-zoom size-5" />
              </Link>
            </div>
          </header>

          <section aria-labelledby="account-balance-label" className="flex flex-col gap-2">
            {personalisedName ? (
              <>
                <p className="text-foreground text-xl font-semibold leading-tight">
                  {personalisedName}
                </p>
                <IbanLabel id="account-balance-label" value={account.name} />
              </>
            ) : (
              <IbanLabel id="account-balance-label" value={account.name} />
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
            highlightId={highlightId}
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
  highlightId,
}: {
  accountId: number
  groups: ReturnType<typeof groupTransactionsByDate>
  today?: Date
  /** Pixel offset where date headers should park (height of the page header). */
  stickyTopOffset?: number
  isManual?: boolean
  highlightId?: number | null
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
                  highlighted={highlightId === transaction.id}
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
  highlighted = false,
}: {
  accountId: number
  transaction: TransactionRead
  /** Future-dated transactions aren't reflected in account.balance yet — render
   *  them muted so the user understands they're informational, not booked. */
  isFuture?: boolean
  /** Manual accounts get inline edit + delete buttons in place of the
   *  navigate-to-detail link. */
  isManual?: boolean
  highlighted?: boolean
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const remove = useDeleteTransaction(accountId)

  const negative = transaction.amount < 0
  const pending = transaction.pending ?? false
  const otherParty = formatIban(transaction.other_party?.trim() || '') || t('account.unknownParty')

  if (editing) {
    return (
      <li
        id={`transaction-${transaction.id}`}
        className={cn('py-2', highlighted && 'bg-primary/20 rounded-md transition-colors')}
      >
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
      <li
        id={`transaction-${transaction.id}`}
        className={cn(highlighted && 'bg-primary/20 rounded-md transition-colors')}
      >
        <Link
          to="/account/$accountId/transactions/$transactionId"
          params={{ accountId: String(accountId), transactionId: String(transaction.id) }}
          className={cn(
            'hover:bg-muted/60 flex items-center gap-3 rounded-md py-3 pl-3 transition-colors',
            (isFuture || pending) && 'opacity-60',
          )}
        >
          <span className="flex-1 truncate text-sm font-medium">
            {otherParty}
            {pending ? (
              <span className="bg-muted text-muted-foreground ml-2 rounded-full px-1.5 py-0.5 align-middle text-[10px] font-medium">
                {t('transaction.pendingBadge')}
              </span>
            ) : null}
          </span>
          <span
            className={cn(
              'text-sm font-semibold tabular-nums',
              // Future/pending transactions get a neutral color: the destructive/success accent
              // implies "this moved money" which isn't true until it books.
              isFuture || pending
                ? 'text-muted-foreground'
                : negative
                  ? 'text-destructive'
                  : 'text-success',
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
      id={`transaction-${transaction.id}`}
      className={cn(
        'flex items-center gap-3 rounded-md py-3 pl-2 transition-colors',
        isFuture && 'opacity-60',
        highlighted && 'bg-primary/20',
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
