import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Repeat } from 'lucide-react'

import { sumContractsForPeriod, useContracts } from '@/lib/contract'
import { formatMoney, formatPercent } from '@/lib/format'
import { ChartCard } from '@/components/stats/chart-card'
import { StatMetricGroup } from '@/components/stats/stat-metric'
import { averageMonthlyIncome, fixedCostRatio, type MonthlyCashflow } from '@/lib/statistics'
import type { TransactionCategory } from '@/lib/transaction'

export function ContractsSummaryCard({
  accountIds,
  categories,
  cashflow,
}: {
  accountIds: number[]
  categories: TransactionCategory[]
  cashflow: MonthlyCashflow[] | undefined
}) {
  const { t } = useTranslation()
  const { data } = useContracts()
  const contracts = (data ?? []).filter(
    (contract) =>
      accountIds.includes(contract.account_id) &&
      (categories.length === 0 ||
        (contract.category !== null && categories.includes(contract.category))),
  )
  const ratio = fixedCostRatio(
    sumContractsForPeriod(contracts, 'MONTHLY'),
    averageMonthlyIncome(cashflow ?? []),
  )

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
      <StatMetricGroup
        metrics={[
          {
            label: t('stats.contracts.perDay'),
            value: formatMoney(sumContractsForPeriod(contracts, 'DAY')),
          },
          {
            label: t('stats.contracts.perMonth'),
            value: formatMoney(sumContractsForPeriod(contracts, 'MONTHLY')),
          },
          {
            label: t('stats.contracts.perYear'),
            value: formatMoney(sumContractsForPeriod(contracts, 'YEARLY')),
          },
          {
            label: t('stats.contracts.fixedCostRatio'),
            value: ratio === null ? '–' : formatPercent(ratio),
          },
        ]}
      />
    </ChartCard>
  )
}
