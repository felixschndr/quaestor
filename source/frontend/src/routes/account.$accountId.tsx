import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, Search } from 'lucide-react'

import { useAuthMe, type AccountRead } from '@/lib/auth'
import {
  findAccountInUser,
  groupTransactionsByDate,
  useAccountHistory,
  type AccountHistoryPage,
  type TransactionRead,
} from '@/lib/accountHistory'
import { formatDate, formatEuro, formatIban, relativeDateKey } from '@/lib/format'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/account/$accountId')({
  component: AccountDetailPage,
})

function AccountDetailPage() {
  const { accountId: rawId } = Route.useParams()
  const accountId = Number(rawId)
  const { data: user } = useAuthMe()
  const accountInfo = findAccountInUser(user, accountId)

  const history = useAccountHistory(accountId)

  if (!user) return null // Root guard already redirected on 401.

  if (!accountInfo) {
    return <AccountNotFoundView />
  }

  return (
    <AccountDetailView
      account={accountInfo.account}
      pages={history.data?.pages ?? []}
      isFetchingNextPage={history.isFetchingNextPage}
      hasNextPage={!!history.hasNextPage}
      onLoadMore={() => {
        if (history.hasNextPage && !history.isFetchingNextPage) {
          void history.fetchNextPage()
        }
      }}
    />
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
  pages: AccountHistoryPage[]
  isFetchingNextPage: boolean
  hasNextPage: boolean
  onLoadMore: () => void
  /** Overridable for tests so "Today" / "Yesterday" labels are deterministic. */
  today?: Date
}

export function AccountDetailView({
  account,
  pages,
  isFetchingNextPage,
  hasNextPage,
  onLoadMore,
  today,
}: AccountDetailViewProps) {
  const { t } = useTranslation()
  const groups = useMemo(() => groupTransactionsByDate(pages), [pages])
  const hasAnyTransactions = groups.length > 0
  const negative = account.balance < 0
  const personalisedName = account.display_name?.trim() || null

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
            <Link
              to="/account/$accountId/search"
              params={{ accountId: String(account.id) }}
              aria-label={t('account.search')}
              // Same `text-primary` token as the back arrow.
              // translate-y nudge: optically the magnifier sits high vs. the
              // chevron because its visual mass is in the lower half.
              className="text-primary hover:text-primary/80 translate-y-[6px] rounded-md p-1.5 transition-colors"
            >
              <Search className="size-5" />
            </Link>
          </header>

          <section aria-labelledby="account-balance-label" className="flex flex-col gap-1">
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
            <p
              className={cn(
                'text-4xl font-bold tracking-tight tabular-nums',
                negative ? 'text-destructive' : 'text-primary',
              )}
            >
              {formatEuro(account.balance)}
            </p>
          </section>
        </div>
      </div>

      <div
        className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pb-4"
        // pt = measured header height + the visual gap (~0.5rem) the old
        // `pt-2` provided between header and first transaction group.
        style={{ paddingTop: `${stickyHeaderHeight + 8}px` }}
      >
        {hasAnyTransactions ? (
          <TransactionGroupList
            accountId={account.id}
            groups={groups}
            today={today}
            stickyTopOffset={stickyHeaderHeight}
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
}: {
  accountId: number
  groups: ReturnType<typeof groupTransactionsByDate>
  today?: Date
  /** Pixel offset where date headers should park (height of the page header). */
  stickyTopOffset?: number
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
  return relativeDateKey(local, today) === 'future'
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
}: {
  accountId: number
  transaction: TransactionRead
  /** Future-dated transactions aren't reflected in account.balance yet — render
   *  them muted so the user understands they're informational, not booked. */
  isFuture?: boolean
}) {
  const { t } = useTranslation()
  const negative = transaction.amount < 0
  const otherParty = formatIban(transaction.other_party?.trim() || '') || t('account.unknownParty')
  return (
    <li>
      <Link
        to="/account/$accountId/transactions/$transactionId"
        params={{ accountId: String(accountId), transactionId: String(transaction.id) }}
        className={cn(
          'hover:bg-muted/60 flex items-center gap-3 rounded-md px-2 py-3 transition-colors',
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
