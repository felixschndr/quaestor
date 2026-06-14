import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Collapsible } from 'radix-ui'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { z } from 'zod'

import { BankLogo } from '@/components/BankLogo'
import { DatePicker } from '@/components/ui/date-picker'
import { Label } from '@/components/ui/label'
import { useAuthMe } from '@/lib/auth'
import { useAccountGroupLayout } from '@/lib/accountGroups'
import { buildDisplayGroups, type AccountWithBank } from '@/lib/accountDisplayGroups'
import { useNetWorthRange, type AccountRangeChange } from '@/lib/statistics'
import type { TransactionRead } from '@/lib/accountHistory'
import { accountDisplayName } from '@/lib/accounts'
import { formatEuro, formatIban } from '@/lib/format'
import { cn } from '@/lib/utils'

const searchParamsSchema = z.object({
  // Optional "before" reference date. When absent it defaults to the day
  // before the end date, reproducing a single-day view.
  start: z.string().optional(),
  account_ids: z
    .union([z.array(z.coerce.number()), z.coerce.number()])
    .transform((value) => (Array.isArray(value) ? value : [value]))
    .optional(),
})

/** Shift an ISO yyyy-mm-dd date by `delta` days, returning ISO yyyy-mm-dd. */
function shiftIsoDay(iso: string, delta: number): string {
  const [year, month, day] = iso.split('-').map(Number)
  const date = new Date(year, month - 1, day + delta)
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export const Route = createFileRoute('/stats_/day/$date')({
  component: NetWorthDayPage,
  validateSearch: (search) => searchParamsSchema.parse(search),
})

function formatSignedEuro(value: number): string {
  return value > 0 ? `+${formatEuro(value)}` : formatEuro(value)
}

export function NetWorthDayPage() {
  const { date } = Route.useParams()
  const search = Route.useSearch()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data: user } = useAuthMe()
  const layout = useAccountGroupLayout()
  const accountIds = search.account_ids ?? []
  // `date` (the route param) is the end of the range; the start defaults to
  // the day before, which reproduces the original single-day comparison.
  const startDate = search.start ?? shiftIsoDay(date, -1)
  const range = useNetWorthRange(startDate, date, accountIds)

  const changeStart = (next: string) => {
    if (!next) return
    // The start can never sit after the end; clamp it to the end date.
    const clamped = next > date ? date : next
    navigate({
      to: '/stats/day/$date',
      params: { date },
      search: { account_ids: accountIds, start: clamped },
    })
  }

  const changeEnd = (next: string) => {
    if (!next || next === date) return
    // Keep an explicit start only while it still precedes the new end;
    // otherwise drop it so it falls back to "the day before".
    const keepStart = search.start && search.start <= next ? search.start : undefined
    navigate({
      to: '/stats/day/$date',
      params: { date: next },
      search: { account_ids: accountIds, start: keepStart },
    })
  }

  if (!user) return null // root guard already redirected on 401

  const selectedIds = new Set(accountIds)
  const changeByAccount = new Map<number, AccountRangeChange>(
    (range.data?.accounts ?? []).map((change) => [change.account_id, change]),
  )
  const groups = buildDisplayGroups(user, layout.data)
    .map((group) => ({
      ...group,
      accounts: group.accounts.filter((account) => selectedIds.has(account.id)),
    }))
    .filter((group) => group.accounts.length > 0)

  return (
    <main className="mx-auto flex min-h-full max-w-3xl flex-col gap-6 p-4">
      <header className="flex items-center gap-2">
        <Link
          to="/stats"
          aria-label={t('stats.day.back')}
          className="text-primary hover:text-primary/80 -ml-1.5 rounded-md p-1.5 transition-colors"
        >
          <ChevronLeft className="size-5" />
        </Link>
        <h1 className="text-foreground flex-1 text-lg font-semibold">{t('stats.day.title')}</h1>
      </header>

      <div className="grid grid-cols-2 gap-3 px-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="day-start">{t('stats.day.from')}</Label>
          <DatePicker id="day-start" value={startDate} onChange={changeStart} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="day-end">{t('stats.day.to')}</Label>
          <DatePicker id="day-end" value={date} onChange={changeEnd} />
        </div>
      </div>

      {range.isLoading ? (
        <p className="text-muted-foreground text-sm">{t('stats.day.loading')}</p>
      ) : range.isError ? (
        <p className="text-destructive text-sm">{t('stats.day.error')}</p>
      ) : groups.length === 0 ? (
        <p className="text-muted-foreground border-border bg-card rounded-lg border border-dashed p-8 text-center text-sm">
          {t('stats.day.empty')}
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-6">
            {groups.map((group) => {
              const heading =
                group.heading === '__ungrouped__'
                  ? t('credentials.groups.ungroupedHeading')
                  : group.heading
              return (
                <li key={group.key} className="flex flex-col gap-1">
                  {heading ? (
                    <h2 className="text-muted-foreground px-2 text-xs font-semibold tracking-wide uppercase">
                      {heading}
                    </h2>
                  ) : null}
                  <ul className="flex flex-col">
                    {group.accounts.map((account) => (
                      <AccountChangeRow
                        key={account.id}
                        account={account}
                        change={changeByAccount.get(account.id)}
                      />
                    ))}
                  </ul>
                </li>
              )
            })}
          </ul>

          {range.data ? (
            <div className="border-border mx-2 flex items-center justify-between border-t pt-3 text-sm font-semibold tabular-nums">
              <span>{t('stats.day.total')}</span>
              <span className="flex items-baseline gap-3">
                <span>{formatEuro(range.data.total_at_end)}</span>
                <DifferenceAmount value={range.data.total_difference} />
              </span>
            </div>
          ) : null}
        </>
      )}
    </main>
  )
}

function AccountChangeRow({
  account,
  change,
}: {
  account: AccountWithBank
  change: AccountRangeChange | undefined
}) {
  const { t } = useTranslation()
  const difference = change?.difference ?? 0
  const transactions = change?.transactions ?? []

  return (
    <li>
      <Collapsible.Root>
        <Collapsible.Trigger className="group/row hover:bg-muted/60 focus-visible:ring-ring flex w-full items-center gap-3 rounded-md px-2 py-3 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none">
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
            <span className="truncate text-sm font-medium">{accountDisplayName(account)}</span>
            <span className="text-muted-foreground truncate text-xs tabular-nums">
              {formatEuro(change?.balance_at_start ?? 0)} →{' '}
              {formatEuro(change?.balance_at_end ?? 0)}
            </span>
          </span>
          <DifferenceAmount value={difference} />
        </Collapsible.Trigger>
        <Collapsible.Content className="collapsible-content overflow-hidden">
          {transactions.length === 0 ? (
            <p className="text-muted-foreground px-2 py-2 pl-12 text-xs">
              {t('stats.day.noTransactions')}
            </p>
          ) : (
            <ul className="flex flex-col pb-1 pl-9">
              {transactions.map((transaction) => (
                <TransactionLine key={transaction.id} transaction={transaction} />
              ))}
            </ul>
          )}
        </Collapsible.Content>
      </Collapsible.Root>
    </li>
  )
}

function TransactionLine({ transaction }: { transaction: TransactionRead }) {
  const { t } = useTranslation()
  const negative = transaction.amount < 0
  const otherParty = formatIban(transaction.other_party?.trim() || '') || t('account.unknownParty')
  return (
    <li className="grid grid-cols-[1fr_auto] items-baseline gap-3 px-2 py-2">
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
        {formatEuro(transaction.amount)}
      </span>
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
