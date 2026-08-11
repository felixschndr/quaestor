import { Link, getRouteApi, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Collapsible } from 'radix-ui'
import { ChevronRight } from 'lucide-react'

import { BackLink } from '@/components/back-link'
import { BankLogo } from '@/components/BankLogo'
import { QueryStates } from '@/components/query-states'
import { DateRangeFields } from '@/components/ui/date-range-fields'
import { useAuthMe } from '@/lib/auth'
import type { AccountWithBank } from '@/lib/accountDisplayGroups'
import {
  AccountGroupList,
  AccountLabel,
  useDisplayGroups,
} from '@/components/stats/account-group-list'
import { SegmentedToggle } from '@/components/stats/segmented-toggle'
import {
  DETAIL_RANGE_PRESETS,
  detailPresetRange,
  matchingDetailPreset,
  useNetWorthRange,
  type AccountRangeChange,
  type DetailRangePreset,
} from '@/lib/statistics'
import type { TransactionRead } from '@/lib/accountHistory'
import { formatMoney, formatIban } from '@/lib/format'
import { cn } from '@/lib/utils'

const detailRoute = getRouteApi('/stats_/detail')

// en-CA locale formats as YYYY-MM-DD
const toIsoDate = (date: Date): string => date.toLocaleDateString('en-CA')

function shiftIsoDay(iso: string, delta: number): string {
  const [year, month, day] = iso.split('-').map(Number)
  return toIsoDate(new Date(year, month - 1, day + delta))
}

function formatSignedEuro(value: number): string {
  return value > 0 ? `+${formatMoney(value)}` : formatMoney(value)
}

export function NetWorthDetailPage() {
  const search = detailRoute.useSearch()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data: user } = useAuthMe()
  const accountIds = search.account_ids ?? []
  const endDate = search.end ?? toIsoDate(new Date())
  const startDate = search.start ?? shiftIsoDay(endDate, -1)
  const range = useNetWorthRange(startDate, endDate, accountIds)
  const groups = useDisplayGroups(accountIds)

  const changeStart = (next: string | undefined) => {
    if (!next) return
    const clamped = next > endDate ? endDate : next
    navigate({
      to: '/stats/detail',
      search: { ...search, start: clamped, end: endDate },
      replace: true,
    })
  }

  const applyPreset = (preset: DetailRangePreset) => {
    const range = detailPresetRange(preset)
    navigate({
      to: '/stats/detail',
      search: { ...search, start: range.start, end: range.end },
      replace: true,
    })
  }

  const changeEnd = (next: string | undefined) => {
    if (!next || next === endDate) return
    const keepStart = search.start && search.start <= next ? search.start : undefined
    navigate({
      to: '/stats/detail',
      search: { ...search, start: keepStart, end: next },
      replace: true,
    })
  }

  const expandedIds = new Set(search.expanded ?? [])
  const setExpanded = (accountId: number, open: boolean) => {
    const next = new Set(expandedIds)
    if (open) next.add(accountId)
    else next.delete(accountId)
    navigate({
      to: '/stats/detail',
      search: { ...search, expanded: next.size ? [...next] : undefined },
      replace: true,
    })
  }

  if (!user || !groups) return null // root guard already redirected on 401

  const changeByAccount = new Map<number, AccountRangeChange>(
    (range.data?.accounts ?? []).map((change) => [change.account_id, change]),
  )

  const totalAtEnd = range.data?.total_at_end ?? 0
  const totalDifference = range.data?.total_difference ?? 0

  return (
    <main className="mx-auto flex min-h-full max-w-page flex-col gap-6 p-4">
      <header className="flex items-center gap-2">
        <BackLink to="/stats">{t('stats.title')}</BackLink>
        <h1 className="text-foreground flex-1 text-lg font-semibold">{t('stats.day.title')}</h1>
      </header>

      <div className="flex flex-col gap-3 px-2">
        <DateRangeFields
          idPrefix="day"
          dateFrom={startDate}
          dateTo={endDate}
          onDateFromChange={changeStart}
          onDateToChange={changeEnd}
        />
        <SegmentedToggle
          fullWidth
          ariaLabel={t('stats.rangeLabel')}
          value={matchingDetailPreset(startDate, endDate)}
          onChange={applyPreset}
          options={DETAIL_RANGE_PRESETS.map((preset) => ({
            value: preset,
            label: t(`stats.day.range.${preset}`),
          }))}
        />
      </div>

      <QueryStates
        query={range}
        loadingText={t('common.loading')}
        errorText={t('stats.day.error')}
        isEmpty={groups.length === 0}
        emptyText={t('stats.day.empty')}
        emptyClassName="border-border bg-card rounded-lg border border-dashed p-8 text-center"
      >
        <AccountGroupList
          groups={groups}
          renderAccount={(account) => (
            <AccountChangeRow
              account={account}
              change={changeByAccount.get(account.id)}
              open={expandedIds.has(account.id)}
              onOpenChange={(next) => setExpanded(account.id, next)}
            />
          )}
        />

        {range.data ? (
          <div className="border-border mx-2 flex items-center justify-between border-t pt-3 text-sm font-semibold tabular-nums">
            <span>{t('common.total')}</span>
            <span className="flex items-baseline gap-3">
              <span>{formatMoney(totalAtEnd)}</span>
              <DifferenceAmount value={totalDifference} />
            </span>
          </div>
        ) : null}
      </QueryStates>
    </main>
  )
}

function AccountChangeRow({
  account,
  change,
  open,
  onOpenChange,
}: {
  account: AccountWithBank
  change: AccountRangeChange | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const difference = change?.difference ?? 0
  const transactions = change?.transactions ?? []

  return (
    <Collapsible.Root open={open} onOpenChange={onOpenChange}>
      <Collapsible.Trigger className="group/row hover:bg-muted/60 focus-visible:ring-ring flex w-full cursor-pointer items-center gap-3 rounded-md px-2 py-3 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none">
        <ChevronRight
          aria-hidden="true"
          className="text-muted-foreground size-3.5 shrink-0 transition-transform duration-200 ease-in-out group-data-[state=open]/row:rotate-90"
        />
        <BankLogo
          icon={account.bankIcon}
          name={account.bankName ?? account.bank}
          seed={account.bankName ?? account.bank}
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <AccountLabel account={account} />
          <span className="text-muted-foreground truncate text-xs tabular-nums">
            {formatMoney(change?.balance_at_start ?? 0)} →{' '}
            {formatMoney(change?.balance_at_end ?? 0)}
          </span>
        </span>
        <DifferenceAmount value={difference} />
      </Collapsible.Trigger>
      <Collapsible.Content className="collapsible-content overflow-hidden">
        {transactions.length === 0 ? (
          <p className="text-muted-foreground py-2 pr-2 pl-[4.875rem] text-xs">
            {t('stats.day.noTransactions')}
          </p>
        ) : (
          <ul className="flex flex-col pb-1">
            {transactions.map((transaction) => (
              <TransactionLine key={transaction.id} transaction={transaction} />
            ))}
          </ul>
        )}
      </Collapsible.Content>
    </Collapsible.Root>
  )
}

function TransactionLine({ transaction }: { transaction: TransactionRead }) {
  const { t } = useTranslation()
  const negative = transaction.amount < 0
  const otherParty = formatIban(transaction.other_party?.trim() || '') || t('account.unknownParty')
  return (
    <li>
      <Link
        to="/transactions/$transactionId"
        params={{ transactionId: String(transaction.id) }}
        className="hover:bg-muted/60 ml-[4.375rem] grid grid-cols-[1fr_auto] items-baseline gap-3 rounded-md px-2 py-2 transition-colors"
      >
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm">{otherParty}</span>
          {transaction.purpose ? (
            <span className="text-muted-foreground truncate text-xs">{transaction.purpose}</span>
          ) : null}
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

function DifferenceAmount({ value }: { value: number }) {
  return (
    <span
      className={cn(
        'shrink-0 text-sm font-semibold tabular-nums',
        value > 0 ? 'text-success' : value < 0 ? 'text-destructive' : 'text-muted-foreground',
      )}
    >
      {formatSignedEuro(value)}
    </span>
  )
}
