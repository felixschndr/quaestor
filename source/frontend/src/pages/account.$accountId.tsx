import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Check, ChevronRight, Copy, Pencil, Plus, Search, X } from 'lucide-react'
import { Collapsible } from 'radix-ui'
import { toast } from 'sonner'

import { type AccountRead } from '@/lib/auth'
import { groupTransactionsByDate, type TransactionRead } from '@/lib/accountHistory'
import { useUpdateAccount } from '@/lib/accounts'
import { useDeleteTransaction } from '@/lib/transaction'
import { CategoryAvatar } from '@/lib/categoryIcons'
import {
  useDeleteRecurringTransaction,
  useRecurringTransactions,
  type RecurringTransactionRead,
} from '@/lib/recurringTransaction'
import {
  useDeleteExpectedTransaction,
  useExpectedTransactions,
  type ExpectedTransactionRead,
} from '@/lib/expectedTransaction'
import {
  formatDate,
  formatDateWithoutYear,
  formatDecimal,
  formatMoney,
  formatIban,
  formatRelativeDateTime,
  isIban,
  relativeDateKey,
  transactionPartyName,
} from '@/lib/format'
import { isManualBank } from '@/lib/credentials'
import { presetDateRange, useNetWorthStats } from '@/lib/statistics'
import { Sparkline } from '@/components/sparkline'
import { copyText } from '@/lib/clipboard'
import { EXPECTED_TRANSACTIONS_KEY, useCollapsedGroups } from '@/lib/collapsedGroups'
import { cn } from '@/lib/utils'
import { AmountInput } from '@/components/ui/amount-input'
import { Button } from '@/components/ui/button'
import { ManualTransactionForm } from '@/components/manual-transaction-form'
import { ExpectedTransactionForm } from '@/components/expected-transaction-form'
import { ContractIcon } from '@/components/contract-icon'
import { StatsIcon } from '@/components/stats-icon'
import { SyncButton } from '@/components/sync-button'
import { PrivacyToggle } from '@/components/privacy-toggle'
import type { AccountDetailViewProps } from '@/routes/account.$accountId'
import { BackLink } from '@/components/back-link'
import { RowActions } from '@/components/row-actions'

const SPARKLINE_FLAT_RATIO = 0.05

function SparklineAxis({ dates, activeSlot }: { dates: string[]; activeSlot?: number }) {
  const active = activeSlot != null
  return (
    <div className="private-chart text-muted-foreground mt-1 flex items-center gap-2 text-[11px]">
      {dates.map((date, index) => (
        <Fragment key={index}>
          {index > 0 ? (
            <span
              className={cn(
                'bg-foreground/20 h-px flex-1 transition-opacity',
                active && 'opacity-40',
              )}
              aria-hidden="true"
            />
          ) : null}
          <span
            className={cn(
              'whitespace-nowrap transition-opacity',
              index === activeSlot ? 'text-foreground font-medium' : active && 'opacity-40', // dim the flanking start/end dates while scrubbing
            )}
          >
            {formatDateWithoutYear(date)}
          </span>
        </Fragment>
      ))}
    </div>
  )
}

function AccountSparkline({
  accountId,
  onActiveDayChange,
}: {
  accountId: number
  onActiveDayChange: (value: number | null) => void
}) {
  const { t } = useTranslation()
  const accountIds = useMemo(() => [accountId], [accountId])
  const range = useMemo(() => presetDateRange('1m'), [])
  const { data } = useNetWorthStats(accountIds, range)
  const series = data?.series ?? []

  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const startX = useRef<number | null>(null)
  const scrubbed = useRef(false)
  const detachTouchGuard = useRef<(() => void) | undefined>(undefined)
  const setChartRef = useCallback((node: HTMLDivElement | null) => {
    detachTouchGuard.current?.()
    detachTouchGuard.current = undefined
    containerRef.current = node
    if (!node) return
    const onTouchStart = (event: TouchEvent) => event.stopPropagation()
    const onTouchMove = (event: TouchEvent) => {
      event.stopPropagation()
      if (event.cancelable) event.preventDefault()
    }
    node.addEventListener('touchstart', onTouchStart, { passive: true })
    node.addEventListener('touchmove', onTouchMove, { passive: false })
    detachTouchGuard.current = () => {
      node.removeEventListener('touchstart', onTouchStart)
      node.removeEventListener('touchmove', onTouchMove)
    }
  }, [])

  const indexAt = (clientX: number): number | null => {
    const node = containerRef.current
    if (!node || series.length < 2) return null
    const rect = node.getBoundingClientRect()
    if (rect.width === 0) return null
    const ratio = (clientX - rect.left) / rect.width
    const index = Math.round(ratio * (series.length - 1))
    return Math.min(Math.max(index, 0), series.length - 1)
  }
  // Drive both the local dot and the parent balance/date override from one place.
  const applyIndex = (index: number | null) => {
    setActiveIndex(index)
    onActiveDayChange(index != null && index < series.length ? series[index].value : null)
  }
  const clear = () => {
    applyIndex(null)
    startX.current = null
  }
  // Reset the parent override if this chart unmounts mid-scrub.
  useEffect(() => () => onActiveDayChange(null), [onActiveDayChange])

  if (series.length < 2) return null

  const start = series[0].value
  const delta = series[series.length - 1].value - start
  const flat = Math.abs(delta) <= Math.abs(start) * SPARKLINE_FLAT_RATIO
  const tone = flat ? 'text-muted-foreground' : delta > 0 ? 'text-success' : 'text-destructive'
  const active = activeIndex != null && activeIndex < series.length ? series[activeIndex] : null
  // While scrubbing, the middle axis label shows the day under the finger; otherwise the mid date.
  const axisDates = active
    ? [series[0].date, active.date, series[series.length - 1].date]
    : [
        ...new Set([
          series[0].date,
          series[Math.floor(series.length / 2)].date,
          series[series.length - 1].date,
        ]),
      ]
  return (
    <Link
      to="/stats"
      search={{ account_ids: [accountId] }}
      aria-label={t('account.statistics')}
      onClick={(event) => {
        if (scrubbed.current) {
          event.preventDefault()
          scrubbed.current = false
        }
      }}
      className="focus-visible:ring-ring block rounded-md focus-visible:ring-2 focus-visible:outline-none"
    >
      <div
        ref={setChartRef}
        style={{ touchAction: 'none' }}
        onPointerDown={(event) => {
          startX.current = event.clientX
          scrubbed.current = false
          applyIndex(indexAt(event.clientX))
        }}
        onPointerMove={(event) => {
          if (startX.current != null && Math.abs(event.clientX - startX.current) > 6) {
            scrubbed.current = true
          }
          applyIndex(indexAt(event.clientX))
        }}
        onPointerUp={clear}
        onPointerLeave={clear}
        onPointerCancel={clear}
      >
        <Sparkline
          values={series.map((point) => point.value)}
          activeIndex={activeIndex}
          className={cn('private-chart h-10 w-full', tone)}
        />
      </div>
      <SparklineAxis dates={axisDates} activeSlot={active ? 1 : undefined} />
    </Link>
  )
}

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
        className="hover:text-foreground -m-0.5 cursor-pointer rounded p-0.5 transition-colors"
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

export function AccountDetailView({
  account,
  bank,
  lastUpdated,
  pages,
  isLoading = false,
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHighlightId(focusTransactionId)
  }, [focusTransactionId, focusNavKey, groups, hasNextPage, isFetchingNextPage])
  useEffect(() => {
    if (highlightId === null) return
    const timer = setTimeout(() => setHighlightId(null), 4000)
    return () => clearTimeout(timer)
  }, [highlightId])
  const personalisedName = account.display_name?.trim() || null
  const isManual = isManualBank(bank)
  const [addingTxn, setAddingTxn] = useState(false)
  const [addingExpected, setAddingExpected] = useState(false)
  const [sparklineValue, setSparklineValue] = useState<number | null>(null)

  const stickyHeaderRef = useRef<HTMLDivElement>(null)
  const nameRowRef = useRef<HTMLDivElement>(null)
  const amountRef = useRef<HTMLDivElement>(null)
  const mainRef = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    if (!CSS.supports('animation-timeline: scroll()')) return
    const bar = stickyHeaderRef.current
    const nameRow = nameRowRef.current
    const amount = amountRef.current
    if (!bar || !nameRow || !amount) return

    const measure = () => {
      mainRef.current?.style.setProperty(
        '--account-header-height',
        `${bar.getBoundingClientRect().height}px`,
      )
      amount.classList.remove('account-balance-dock')
      const flow = amount.getBoundingClientRect()
      const name = nameRow.getBoundingClientRect()
      amount.style.setProperty('--dock-top', `${name.bottom - flow.height}px`)
      amount.style.setProperty('--dock-tx', `${name.right - flow.right}px`)
      const distance = Math.max(flow.bottom + window.scrollY - name.bottom, 1)
      amount.style.setProperty('--dock-distance', `${distance}px`)
      amount.classList.add('account-balance-dock')
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(bar)
    observer.observe(nameRow)
    observer.observe(amount)
    let width = window.innerWidth
    const onResize = () => {
      if (window.innerWidth === width) return
      width = window.innerWidth
      measure()
    }
    window.addEventListener('resize', onResize)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', onResize)
      amount.classList.remove('account-balance-dock')
    }
  }, [])

  return (
    <main ref={mainRef} className="flex min-h-full flex-col">
      <div ref={stickyHeaderRef} className="bg-background fixed top-0 right-0 left-0 z-20">
        <div className="mx-auto flex w-full max-w-page flex-col px-4 pt-4 pb-3">
          <header className="flex items-center justify-between gap-2 pr-2">
            <BackLink to="/" label={t('account.back')} />
            <div className="-mr-2.5 flex items-center gap-1">
              <PrivacyToggle className="p-2.5" />
              {onSyncClick ? (
                <SyncButton
                  onClick={onSyncClick}
                  spinning={syncSpinning}
                  disabled={syncDisabled}
                  succeededAt={syncSucceededAt}
                  ariaLabel={t('account.sync.aria')}
                  className="p-2.5"
                />
              ) : null}
              <Link
                to="/stats"
                search={{ account_ids: [account.id] }}
                aria-label={t('account.statistics')}
                title={t('account.statistics')}
                className="text-primary hover:text-primary/80 group rounded-md p-2.5 transition-colors max-sm:hidden"
              >
                <StatsIcon className="size-5" />
              </Link>
              <Link
                to="/contracts"
                search={{ account_ids: [account.id] }}
                aria-label={t('contracts.title')}
                title={t('contracts.title')}
                className="text-primary hover:text-primary/80 group rounded-md p-2.5 transition-colors max-sm:hidden"
              >
                <ContractIcon className="size-5" />
              </Link>
              <Link
                to="/search"
                search={{ account_ids: [account.id] }}
                aria-label={t('account.search')}
                title={t('account.search')}
                className="text-primary hover:text-primary/80 group rounded-md p-2.5 transition-colors max-sm:hidden"
              >
                <Search className="search-icon-zoom size-5" />
              </Link>
            </div>
          </header>

          <div ref={nameRowRef} className="mt-2 flex min-h-7 items-end">
            <p className="text-foreground max-w-[55%] truncate text-xl leading-tight font-semibold">
              {personalisedName ?? formatIban(account.name)}
            </p>
          </div>
        </div>
      </div>

      <div
        className="mx-auto flex w-full max-w-page flex-col gap-2 px-4 pb-4"
        style={{ paddingTop: 'calc(var(--account-header-height, 0px) + 8px)' }}
      >
        <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
          <IbanLabel id="account-balance-label" value={account.name} />
          {lastUpdated ? (
            <p className="text-muted-foreground shrink-0 text-sm sm:text-right">
              {t('account.lastUpdated')}: {formatRelativeDateTime(lastUpdated, t, today)}
            </p>
          ) : null}
        </div>
        <div
          ref={amountRef}
          role="group"
          aria-labelledby="account-balance-label"
          className="z-30 w-fit"
        >
          <BalanceDisplay account={account} isManual={isManual} overrideValue={sparklineValue} />
        </div>
        <AccountSparkline accountId={account.id} onActiveDayChange={setSparklineValue} />
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
        ) : (
          <ExpectedAddHeaderButton
            accountId={account.id}
            onToggle={() => setAddingExpected((prev) => !prev)}
          />
        )}

        <div className="mt-4 flex flex-col gap-6">
          {isManual && addingTxn ? (
            <ManualTransactionForm
              accountId={account.id}
              mode="create"
              onDone={() => setAddingTxn(false)}
            />
          ) : null}

          {!isManual && addingExpected ? (
            <ExpectedTransactionForm
              accountId={account.id}
              onDone={() => setAddingExpected(false)}
            />
          ) : null}

          {isManual ? <RecurringTransactionsList accountId={account.id} /> : null}

          {!isManual ? (
            <ExpectedTransactionsList
              accountId={account.id}
              onAdd={() => setAddingExpected((prev) => !prev)}
            />
          ) : null}

          {hasAnyTransactions ? (
            <TransactionGroupList
              accountId={account.id}
              groups={groups}
              today={today}
              isManual={isManual}
              isMarketValued={account.is_market_valued}
              highlightId={highlightId}
            />
          ) : isLoading ? (
            <p className="text-muted-foreground text-sm">{t('common.loading')}</p>
          ) : (
            <p className="text-muted-foreground text-sm">{t('account.empty')}</p>
          )}

          {hasNextPage ? (
            <InfiniteScrollSentinel onIntersect={onLoadMore} isFetching={isFetchingNextPage} />
          ) : null}
        </div>
      </div>
    </main>
  )
}

function BalanceDisplay({
  account,
  isManual,
  overrideValue,
}: {
  account: AccountRead
  isManual: boolean
  overrideValue?: number | null
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<number | undefined>(account.balance)
  const update = useUpdateAccount()

  const valid = draft !== undefined

  const commit = async () => {
    if (draft === undefined || draft === account.balance) {
      setEditing(false)
      return
    }
    try {
      await update.mutateAsync({ accountId: account.id, balance: draft })
      toast.success(t('common.saved'))
      setEditing(false)
    } catch {
      toast.error(t('credentials.detail.saveFailed'))
    }
  }

  const cancel = () => {
    setDraft(account.balance)
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="flex items-center gap-2">
        <AmountInput
          id={`account-balance-${account.id}`}
          value={draft}
          onChange={setDraft}
          autoFocus
          formatOnBlur
          disabled={update.isPending}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void commit()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              cancel()
            }
          }}
          aria-label={t('common.balance')}
          placeholder={formatDecimal(0)}
          inputClassName="h-10 max-w-[10rem] text-xl font-semibold tabular-nums"
          aria-invalid={!valid || undefined}
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

  const displayValue = overrideValue ?? account.balance
  return (
    <div className="flex items-center gap-2">
      <p
        className={cn(
          'private-amount text-4xl font-bold tracking-tight tabular-nums',
          displayValue < 0 ? 'text-destructive' : 'text-primary',
        )}
      >
        {formatMoney(displayValue)}
      </p>
      {isManual ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setDraft(account.balance)
            setEditing(true)
          }}
          aria-label={t('common.balance')}
          className="text-muted-foreground hover:text-foreground"
        >
          <Pencil className="size-4" aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  )
}

function TransactionGroupList({
  accountId,
  groups,
  today,
  isManual = false,
  isMarketValued = false,
  highlightId,
}: {
  accountId: number
  groups: ReturnType<typeof groupTransactionsByDate>
  today?: Date
  isManual?: boolean
  isMarketValued?: boolean
  highlightId?: number | null
}) {
  return (
    <ul className="flex flex-col gap-6">
      {groups.map((group) => {
        const isFuture = isFutureDateString(group.date, today)
        return (
          <li
            key={group.date}
            className="-mx-3 flex flex-col gap-2 px-3"
            style={{
              contentVisibility: 'auto',
              containIntrinsicSize: `auto ${32 + group.transactions.length * 56}px`,
            }}
          >
            <DateHeader
              date={group.date}
              endOfDayBalance={group.endOfDayBalance}
              today={today}
              isMarketValued={isMarketValued}
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
  isMarketValued = false,
}: {
  date: string
  endOfDayBalance: number | null
  today?: Date
  isMarketValued?: boolean
}) {
  const { t } = useTranslation()
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
    <header
      className="bg-background sticky z-[1] grid grid-cols-[1fr_auto] items-baseline gap-2 py-1"
      style={{ top: 'calc(var(--account-header-height, 0px) - 2px)' }}
    >
      <h2 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">{label}</h2>
      {endOfDayBalance !== null ? (
        <span className="private-amount text-muted-foreground text-xs tabular-nums">
          {isMarketValued ? <span className="mr-1">{t('account.marketValue')}</span> : null}
          {formatMoney(endOfDayBalance)}
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
  isFuture?: boolean
  isManual?: boolean
  highlighted?: boolean
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const remove = useDeleteTransaction(accountId)

  const negative = transaction.amount < 0
  const pending = transaction.pending ?? false
  const otherParty = transactionPartyName(transaction) || t('account.unknownParty')
  const purpose = transaction.purpose?.trim()
  const subline = purpose && purpose !== otherParty ? purpose : null

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
          to="/transactions/$transactionId"
          params={{ transactionId: String(transaction.id) }}
          className={cn(
            'hover:bg-muted/60 flex items-center gap-3 rounded-md py-3 pl-2 transition-colors',
            (isFuture || pending) && 'opacity-60',
          )}
        >
          <CategoryAvatar
            category={transaction.category}
            className="size-8"
            iconClassName="size-4"
          />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-medium">{otherParty}</span>
              {pending ? (
                <span className="bg-muted text-muted-foreground shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium">
                  {t('transaction.pendingBadge')}
                </span>
              ) : null}
            </span>
            {subline ? (
              <span className="text-muted-foreground truncate text-xs">{subline}</span>
            ) : null}
          </span>
          <span
            className={cn(
              'text-sm font-semibold tabular-nums',
              isFuture || pending
                ? 'text-muted-foreground'
                : negative
                  ? 'text-destructive'
                  : 'text-success',
            )}
          >
            {formatMoney(transaction.amount)}
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
      <CategoryAvatar category={transaction.category} className="size-8" iconClassName="size-4" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{otherParty}</span>
        {subline ? <span className="text-muted-foreground truncate text-xs">{subline}</span> : null}
      </span>
      <span
        className={cn(
          'text-sm font-semibold tabular-nums',
          isFuture ? 'text-muted-foreground' : negative ? 'text-destructive' : 'text-success',
        )}
      >
        {formatMoney(transaction.amount)}
      </span>
      <RowActions
        className="-mr-2.5"
        onEdit={() => setEditing(true)}
        onDelete={onDelete}
        deleting={remove.isPending}
      />
    </li>
  )
}

function RecurringTransactionsList({ accountId }: { accountId: number }) {
  const { t } = useTranslation()
  const { data: rules } = useRecurringTransactions(accountId)

  if (!rules || rules.length === 0) return null

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
        {t('credentials.manualTransactions.recurringTitle')}
      </h2>
      <ul className="border-border divide-border bg-card flex flex-col divide-y rounded-lg border">
        {rules.map((rule) => (
          <RecurringTransactionRow key={rule.id} accountId={accountId} rule={rule} />
        ))}
      </ul>
    </section>
  )
}

function RecurringTransactionRow({
  accountId,
  rule,
}: {
  accountId: number
  rule: RecurringTransactionRead
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const remove = useDeleteRecurringTransaction(accountId)
  const negative = rule.amount < 0

  const frequencyLabel = t(`credentials.manualTransactions.frequency.${rule.frequency}`)
  const scheduleSummary =
    rule.frequency === 'MONTHLY'
      ? t('credentials.manualTransactions.dayOfMonthSummary', {
          day: String(rule.day_of_month).padStart(2, '0'),
        })
      : t(`common.weekdays.${rule.day_of_week}`)

  const onDelete = async () => {
    try {
      await remove.mutateAsync(rule.id)
      toast.success(t('credentials.manualTransactions.recurringDeleted'))
    } catch {
      toast.error(t('credentials.manualTransactions.recurringDeleteFailed'))
    }
  }

  if (editing) {
    return (
      <li className="p-2">
        <ManualTransactionForm
          accountId={accountId}
          mode="edit"
          recurringTransaction={rule}
          onDone={() => setEditing(false)}
        />
      </li>
    )
  }

  return (
    <li className="flex items-center gap-3 px-3 py-3">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">
          {rule.other_party?.trim() || frequencyLabel}
        </span>
        <span className="text-muted-foreground flex flex-col text-xs sm:flex-row sm:gap-1">
          <span>{scheduleSummary}</span>
          <span className="hidden sm:inline" aria-hidden="true">
            ·
          </span>
          <span>
            {t('credentials.manualTransactions.nextRun')}:{' '}
            {formatDateWithoutYear(rule.next_run_date)}
          </span>
        </span>
      </div>
      <span
        className={cn(
          'text-sm font-semibold tabular-nums',
          negative ? 'text-destructive' : 'text-success',
        )}
      >
        {formatMoney(rule.amount)}
      </span>
      <RowActions onEdit={() => setEditing(true)} onDelete={onDelete} deleting={remove.isPending} />
    </li>
  )
}

function ExpectedAddHeaderButton({
  accountId,
  onToggle,
}: {
  accountId: number
  onToggle: () => void
}) {
  const { t } = useTranslation()
  const { data: expected } = useExpectedTransactions(accountId)

  if (expected && expected.length > 0) return null

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <Button type="button" size="sm" variant="outline" onClick={onToggle}>
        <Plus className="size-3.5" aria-hidden="true" />
        {t('expectedTransactions.add')}
      </Button>
    </div>
  )
}

function ExpectedTransactionsList({ accountId, onAdd }: { accountId: number; onAdd: () => void }) {
  const { t } = useTranslation()
  const { data: expected } = useExpectedTransactions(accountId)
  const { isCollapsed, toggle } = useCollapsedGroups()

  if (!expected || expected.length === 0) return null

  return (
    <Collapsible.Root
      open={!isCollapsed(EXPECTED_TRANSACTIONS_KEY)}
      onOpenChange={() => toggle(EXPECTED_TRANSACTIONS_KEY)}
      className="flex flex-col gap-2"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex-1">
          <Collapsible.Trigger className="group/collapsible flex w-full cursor-pointer items-center gap-2">
            <ChevronRight
              aria-hidden="true"
              className="text-muted-foreground size-3.5 shrink-0 transition-transform duration-200 ease-in-out group-data-[state=open]/collapsible:rotate-90"
            />
            <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
              {t('expectedTransactions.title')}
            </span>
          </Collapsible.Trigger>
        </h2>
        <Button type="button" size="sm" variant="outline" onClick={onAdd}>
          <Plus className="size-3.5" aria-hidden="true" />
          {t('expectedTransactions.addShort')}
        </Button>
      </div>
      <Collapsible.Content className="collapsible-content overflow-hidden">
        <ul className="border-border divide-border bg-card flex flex-col divide-y rounded-lg border">
          {expected.map((expectation) => (
            <ExpectedTransactionRow
              key={expectation.id}
              accountId={accountId}
              expectation={expectation}
            />
          ))}
        </ul>
      </Collapsible.Content>
    </Collapsible.Root>
  )
}

function ExpectedTransactionRow({
  accountId,
  expectation,
}: {
  accountId: number
  expectation: ExpectedTransactionRead
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const remove = useDeleteExpectedTransaction(accountId)
  const negative = expectation.amount < 0

  const onDelete = async () => {
    try {
      await remove.mutateAsync(expectation.id)
      toast.success(t('expectedTransactions.deleted'))
    } catch {
      toast.error(t('expectedTransactions.deleteFailed'))
    }
  }

  if (editing) {
    return (
      <li className="p-2">
        <ExpectedTransactionForm
          accountId={accountId}
          expected={expectation}
          onDone={() => setEditing(false)}
        />
      </li>
    )
  }

  return (
    <li className="flex items-center gap-3 px-3 py-3">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">
          {expectation.other_party?.trim() || t('expectedTransactions.anyParty')}
        </span>
        {expectation.note?.trim() ? (
          <span className="text-muted-foreground truncate text-xs">{expectation.note.trim()}</span>
        ) : null}
      </div>
      <span
        className={cn(
          'text-sm font-semibold tabular-nums',
          negative ? 'text-destructive' : 'text-success',
        )}
      >
        {formatMoney(expectation.amount)}
      </span>
      <RowActions onEdit={() => setEditing(true)} onDelete={onDelete} deleting={remove.isPending} />
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
