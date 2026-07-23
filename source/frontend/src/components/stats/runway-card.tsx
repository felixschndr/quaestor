import { useTranslation } from 'react-i18next'
import { Hourglass } from 'lucide-react'

import type { CredentialRead } from '@/lib/auth'
import { sumFactoredBalance } from '@/lib/accountDisplayGroups'
import { formatMoney, formatMonths } from '@/lib/format'
import { ChartCard } from '@/components/stats/chart-card'
import { StatMetricGroup } from '@/components/stats/stat-metric'
import {
  averageMonthlyExpenses,
  runwayMonths,
  runwayYearsMonths,
  type MonthlyCashflow,
} from '@/lib/statistics'
import type { TFunction } from 'i18next'

function formatRunway(months: number | null, t: TFunction): string {
  if (months === null) return t('stats.runway.infinite')
  if (months < 12) return `${formatMonths(months)} ${t('stats.runway.monthsUnit')}`
  const { years, months: rest } = runwayYearsMonths(months)
  const yearsLabel = t('stats.runway.yearsValue', { count: years })
  return rest > 0 ? `${yearsLabel} ${t('stats.runway.monthsValue', { count: rest })}` : yearsLabel
}

export function RunwayCard({
  credentials,
  accountIds,
  cashflow,
}: {
  credentials: CredentialRead[]
  accountIds: number[]
  cashflow: MonthlyCashflow[] | undefined
}) {
  const { t } = useTranslation()

  const accounts = credentials
    .flatMap((credential) => credential.accounts)
    .filter((account) => accountIds.includes(account.id))
  const balance = sumFactoredBalance(accounts)

  const avgExpenses = averageMonthlyExpenses(cashflow ?? [])
  const months = runwayMonths(balance, avgExpenses)

  const metrics = [
    { label: t('stats.runway.balance'), value: formatMoney(balance) },
    { label: t('stats.runway.avgExpenses'), value: formatMoney(avgExpenses) },
    { label: t('stats.runway.remaining'), value: formatRunway(months, t) },
  ]

  return (
    <ChartCard
      title={t('stats.runway.title')}
      icon={<Hourglass className="size-4" aria-hidden="true" />}
      isLoading={cashflow === undefined}
      isError={false}
      isEmpty={cashflow !== undefined && cashflow.length === 0}
    >
      <StatMetricGroup metrics={metrics} />
    </ChartCard>
  )
}
