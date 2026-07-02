import { Link, createFileRoute, useCanGoBack, useNavigate, useRouter } from '@tanstack/react-router'
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
import { formatEuro, formatFactorMultiplier, formatIban } from '@/lib/format'
import { cn } from '@/lib/utils'

const idListSchema = z
  .union([z.array(z.coerce.number()), z.coerce.number()])
  .transform((value) => (Array.isArray(value) ? value : [value]))
  .optional()

const searchParamsSchema = z.object({
  start: z.string().optional(),
  end: z.string().optional(),
  account_ids: idListSchema,
  expanded: idListSchema,
})

function formatIsoDate(date: Date): string {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function shiftIsoDay(iso: string, delta: number): string {
  const [year, month, day] = iso.split('-').map(Number)
  return formatIsoDate(new Date(year, month - 1, day + delta))
}

export const Route = createFileRoute('/stats_/detail')({
  component: NetWorthDetailPage,
  validateSearch: (search) => searchParamsSchema.parse(search),
})

function formatSignedEuro(value: number): string {
  return value > 0 ? `+${formatEuro(value)}` : formatEuro(value)
}

export function NetWorthDetailPage() {
  const search = Route.useSearch()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const router = useRouter()
  const canGoBack = useCanGoBack()
  const { data: user } = useAuthMe()
  const layout = useAccountGroupLayout()
  const accountIds = search.account_ids ?? []
  // `end` is the closing day (defaults to today); the start defaults to the
  // day before, which reproduces the original single-day comparison.
  const endDate = search.end ?? formatIsoDate(new Date())
  const startDate = search.start ?? shiftIsoDay(endDate, -1)
  const range = useNetWorthRange(startDate, endDate, accountIds)

  const changeStart = (next: string) => {
    if (!next) return
    // The start can never sit after the end; clamp it to the end date.
    const clamped = next > endDate ? endDate : next
    navigate({
      to: '/stats/detail',
      search: { ...search, start: clamped, end: endDate },
    })
  }

  const changeEnd = (next: string) => {
    if (!next || next === endDate) return
    // Keep an explicit start only while it still precedes the new end;
    // otherwise drop it so it falls back to "the day before".
    const keepStart = search.start && search.start <= next ? search.start : undefined
    navigate({
      to: '/stats/detail',
      search: { ...search, start: keepStart, end: next },
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

  const factored = (balance: number | null, account: AccountWithBank) =>
    ((balance ?? 0) * account.balance_factor) / 100
  let totalAtEnd = 0
  let totalAtStart = 0
  for (const account of groups.flatMap((group) => group.accounts)) {
    const change = changeByAccount.get(account.id)
    totalAtEnd += factored(change?.balance_at_end ?? null, account)
    totalAtStart += factored(change?.balance_at_start ?? null, account)
  }
  const totalDifference = Math.round((totalAtEnd - totalAtStart) * 100) / 100

  return (
    <main className="mx-auto flex min-h-full max-w-3xl flex-col gap-6 p-4">
      <header className="flex items-center gap-2">
        <Link
          to="/stats"
          onClick={(event) => {
            if (canGoBack) {
              event.preventDefault()
              router.history.back()
            }
          }}
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
          <DatePicker id="day-end" value={endDate} onChange={changeEnd} />
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
                        open={expandedIds.has(account.id)}
                        onOpenChange={(next) => setExpanded(account.id, next)}
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
                <span>{formatEuro(totalAtEnd)}</span>
                <DifferenceAmount value={totalDifference} />
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
    <li>
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
            <span className="flex items-baseline gap-1.5">
              <span className="truncate text-sm font-medium">{accountDisplayName(account)}</span>
              {account.balance_factor !== 100 ? (
                <span className="text-muted-foreground shrink-0 text-xs font-normal tabular-nums">
                  x {formatFactorMultiplier(account.balance_factor / 100)}
                </span>
              ) : null}
            </span>
            <span className="text-muted-foreground truncate text-xs tabular-nums">
              {formatEuro(change?.balance_at_start ?? 0)} →{' '}
              {formatEuro(change?.balance_at_end ?? 0)}
            </span>
          </span>
          <DifferenceAmount value={difference} />
        </Collapsible.Trigger>
        <Collapsible.Content className="collapsible-content overflow-hidden">
          {transactions.length === 0 ? (
            // Indent to line up with the account name above (chevron + logo + gaps).
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
    </li>
  )
}

function TransactionLine({ transaction }: { transaction: TransactionRead }) {
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
          {formatEuro(transaction.amount)}
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
