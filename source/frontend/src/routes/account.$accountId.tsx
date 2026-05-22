import { useEffect, useMemo, useRef } from 'react'
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
import { formatDate, formatEuro, relativeDateKey } from '@/lib/format'
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

  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col gap-6 p-4">
      <header className="flex items-center justify-between gap-2">
        <BackLink />
        <button
          type="button"
          aria-label={t('account.search')}
          // Magnifier placeholder per §3.3 — backend search endpoint TODO.
          disabled
          className="text-muted-foreground rounded-md p-1.5 opacity-50"
        >
          <Search className="size-5" />
        </button>
      </header>

      <section aria-labelledby="account-balance-label" className="flex flex-col gap-1">
        <p id="account-balance-label" className="text-muted-foreground text-sm">
          {account.name}
        </p>
        <p
          className={cn(
            'text-4xl font-bold tracking-tight tabular-nums',
            negative ? 'text-destructive' : 'text-primary',
          )}
        >
          {formatEuro(account.balance)}
        </p>
      </section>

      {hasAnyTransactions ? (
        <TransactionGroupList accountId={account.id} groups={groups} today={today} />
      ) : (
        <p className="text-muted-foreground text-sm">{t('account.empty')}</p>
      )}

      {hasNextPage ? (
        <InfiniteScrollSentinel onIntersect={onLoadMore} isFetching={isFetchingNextPage} />
      ) : null}
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
}: {
  accountId: number
  groups: ReturnType<typeof groupTransactionsByDate>
  today?: Date
}) {
  return (
    <ul className="flex flex-col gap-6">
      {groups.map((group) => (
        <li key={group.date} className="flex flex-col gap-2">
          <DateHeader date={group.date} endOfDayBalance={group.endOfDayBalance} today={today} />
          <ul className="flex flex-col">
            {group.transactions.map((transaction) => (
              <TransactionRow
                key={transaction.id}
                accountId={accountId}
                transaction={transaction}
              />
            ))}
          </ul>
        </li>
      ))}
    </ul>
  )
}

function DateHeader({
  date,
  endOfDayBalance,
  today,
}: {
  date: string
  endOfDayBalance: number | null
  today?: Date
}) {
  const { t } = useTranslation()
  // ISO yyyy-mm-dd is parsed as UTC by `new Date(...)`; pin to local midnight
  // so the "Today"/"Yesterday" check matches the user's wall clock.
  const [y, m, d] = date.split('-').map(Number)
  const local = new Date(y, m - 1, d)
  const relKey = relativeDateKey(local, today)
  const label = relKey ? t(`account.${relKey}`) : formatDate(local)
  return (
    <header className="bg-background sticky top-0 z-[1] flex items-baseline justify-between gap-2 py-1">
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
}: {
  accountId: number
  transaction: TransactionRead
}) {
  const { t } = useTranslation()
  const negative = transaction.amount < 0
  const otherParty = transaction.other_party?.trim() || t('account.unknownParty')
  return (
    <li>
      <Link
        to="/account/$accountId/transactions/$transactionId"
        params={{ accountId: String(accountId), transactionId: String(transaction.id) }}
        className="hover:bg-muted/60 flex items-center gap-3 rounded-md px-2 py-3 transition-colors"
      >
        <span className="flex-1 truncate text-sm font-medium">{otherParty}</span>
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
