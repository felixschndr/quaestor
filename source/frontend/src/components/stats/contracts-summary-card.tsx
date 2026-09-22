import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Repeat } from 'lucide-react'

import { sumContractsForPeriod, useContracts, type ContractCostPeriod } from '@/lib/contract'
import { formatMoney } from '@/lib/format'
import { ChartCard } from '@/components/stats/chart-card'
import type { CategoryKey } from '@/lib/transaction'

export function ContractsSummaryCard({
  accountIds,
  categories,
}: {
  accountIds: number[]
  categories: CategoryKey[]
}) {
  const { t } = useTranslation()
  const { data } = useContracts()
  const contracts = (data ?? []).filter(
    (contract) =>
      accountIds.includes(contract.account_id) &&
      (categories.length === 0 ||
        (contract.category !== null && categories.includes(contract.category))),
  )

  const periods: { key: ContractCostPeriod; label: string; hideOnMobile?: boolean }[] = [
    { key: 'DAY', label: t('common.perDay') },
    { key: 'MONTHLY', label: t('common.perMonth') },
    { key: 'YEARLY', label: t('stats.contracts.perYear'), hideOnMobile: true },
  ]
  const expenses = contracts.filter((c) => (c.amount_per_day ?? 0) < 0)
  const income = contracts.filter((c) => (c.amount_per_day ?? 0) > 0)
  const rows: { label: string; contracts: typeof contracts; className?: string }[] = [
    { label: t('common.expenses'), contracts: expenses },
    { label: t('common.income'), contracts: income },
    {
      label: t('stats.contracts.sum'),
      contracts,
      className: 'border-border/60 border-t font-semibold',
    },
  ]
  const cellColor = (period: ContractCostPeriod, subset: typeof contracts): string => {
    const value = sumContractsForPeriod(subset, period)
    return value < 0 ? 'text-destructive' : value > 0 ? 'text-success' : ''
  }

  return (
    <ChartCard
      title={t('contracts.title')}
      icon={<Repeat className="size-4" aria-hidden="true" />}
      isLoading={data === undefined}
      isError={false}
      isEmpty={contracts.length === 0}
      emptyLabel={t('contracts.noMatches')}
      action={
        <Link
          to="/contracts"
          search={{
            account_ids: accountIds,
            categories: categories.length > 0 ? categories : undefined,
          }}
          className="text-primary hover:text-primary/80 inline-flex items-center gap-1 text-sm transition-colors"
        >
          {t('stats.contracts.viewAll')}
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      }
    >
      <table className="w-full border-collapse text-sm tabular-nums">
        <thead>
          <tr className="text-muted-foreground text-xs">
            <th className="w-px" />
            {periods.map((period) => (
              <th
                key={period.key}
                className={`px-2 py-1 text-right font-medium ${period.hideOnMobile ? 'hidden sm:table-cell' : ''}`}
              >
                {period.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className={row.className}>
              <th className="text-muted-foreground py-1.5 pr-2 text-left font-normal whitespace-nowrap">
                {row.label}
              </th>
              {periods.map((period) => (
                <td
                  key={period.key}
                  className={`px-2 py-1.5 text-right ${period.hideOnMobile ? 'hidden sm:table-cell' : ''} ${cellColor(period.key, row.contracts)}`}
                >
                  {formatMoney(sumContractsForPeriod(row.contracts, period.key))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </ChartCard>
  )
}
