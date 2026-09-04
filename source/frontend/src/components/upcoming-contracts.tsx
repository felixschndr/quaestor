import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Collapsible } from 'radix-ui'
import { ArrowRight, ChevronRight } from 'lucide-react'

import { CategoryAvatar } from '@/lib/categoryIcons'
import { UPCOMING_CONTRACTS_KEY, useCollapsedGroups } from '@/lib/collapsedGroups'
import { useContracts, type ContractRead } from '@/lib/contract'
import {
  formatDateWithoutYear,
  formatMoney,
  formatRelativeDate,
  relativeDateKey,
} from '@/lib/format'
import { cn } from '@/lib/utils'

const UPCOMING_LIMIT = 3

function dueLabel(
  contract: ContractRead,
  t: (key: string, options?: Record<string, unknown>) => string,
  { relative = false, today }: { relative?: boolean; today?: Date } = {},
): string {
  const [year, month, day] = contract.expected_next_date!.split('-').map(Number)
  const local = new Date(year, month - 1, day)
  if (contract.is_overdue) return t('common.overdue')
  const key = relativeDateKey(local, today)
  if (key === 'today') return t('account.today')
  if (key === 'tomorrow') return t('common.tomorrow')
  // Collapsed there is no room for a full date, and "in 6 days" is what the glance is asking for.
  if (relative) return formatRelativeDate(local, today)
  return t('common.onDate', { date: formatDateWithoutYear(local) })
}

function CollapsedSummary({ contract }: { contract: ContractRead }) {
  const { t } = useTranslation()
  return (
    <span className="ml-auto flex items-baseline gap-2 text-xs whitespace-nowrap">
      <span className={contract.is_overdue ? 'text-warning' : 'text-muted-foreground'}>
        {dueLabel(contract, t, { relative: true })}
      </span>
      {contract.median_amount !== null ? (
        <span className="font-semibold tabular-nums">{formatMoney(contract.median_amount)}</span>
      ) : null}
    </span>
  )
}

export function UpcomingContracts({ accountIds }: { accountIds: number[] }) {
  const { t } = useTranslation()
  const { isCollapsed, toggle } = useCollapsedGroups()
  const { data } = useContracts()
  const dated = (data ?? []).filter(
    (contract) => contract.expected_next_date && accountIds.includes(contract.account_id),
  )
  const byDate = (a: ContractRead, b: ContractRead) =>
    a.expected_next_date!.localeCompare(b.expected_next_date!)
  const rows = [
    ...dated.filter((contract) => contract.is_overdue).sort(byDate),
    ...dated
      .filter((contract) => !contract.is_overdue)
      .sort(byDate)
      .slice(0, UPCOMING_LIMIT),
  ]
  if (rows.length === 0) return null
  const open = !isCollapsed(UPCOMING_CONTRACTS_KEY)
  const next = rows[0]

  return (
    <Collapsible.Root open={open} onOpenChange={() => toggle(UPCOMING_CONTRACTS_KEY)} asChild>
      <section>
        <div className="flex items-center gap-2">
          <h2 className="min-w-0 flex-1">
            <Collapsible.Trigger className="group/collapsible focus-visible:ring-ring flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-left focus-visible:ring-2 focus-visible:outline-none">
              <ChevronRight
                aria-hidden="true"
                className="text-muted-foreground size-3.5 shrink-0 transition-transform duration-200 ease-in-out group-data-[state=open]/collapsible:rotate-90"
              />
              <span className="text-muted-foreground shrink-0 text-xs font-semibold tracking-wide">
                {t('overview.upcoming')}
              </span>
              {open ? null : <CollapsedSummary contract={next} />}
            </Collapsible.Trigger>
          </h2>
          {open ? (
            <Link
              to="/contracts"
              className="text-primary hover:text-primary/80 focus-visible:ring-ring inline-flex shrink-0 items-center gap-1 rounded-md pr-2 text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none"
            >
              {t('stats.contracts.viewAll')}
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          ) : null}
        </div>
        <Collapsible.Content className="collapsible-content overflow-hidden">
          <ul className="flex flex-col pt-2">
            {rows.map((contract) => (
              <li key={contract.id}>
                <Link
                  to="/contracts/$contractId"
                  params={{ contractId: String(contract.id) }}
                  className="hover:bg-muted/60 focus-visible:ring-ring flex items-center gap-3 rounded-md px-2 py-2.5 transition-colors focus-visible:ring-2 focus-visible:outline-none"
                >
                  <CategoryAvatar
                    category={contract.category ?? 'UNKNOWN'}
                    className="size-8"
                    iconClassName="size-4"
                  />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">{contract.name}</span>
                    <span
                      className={cn(
                        'text-xs',
                        contract.is_overdue ? 'text-warning' : 'text-muted-foreground',
                      )}
                    >
                      {dueLabel(contract, t)}
                    </span>
                  </span>
                  {contract.median_amount !== null ? (
                    <span className="text-sm font-semibold tabular-nums">
                      {formatMoney(contract.median_amount)}
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </Collapsible.Content>
      </section>
    </Collapsible.Root>
  )
}
