import { useTranslation } from 'react-i18next'
import { Hourglass } from 'lucide-react'

import type { CredentialRead } from '@/lib/auth'
import { formatMoney, formatMonths } from '@/lib/format'
import { ChartCard } from '@/components/stats/chart-card'
import { InfoHint } from '@/components/ui/info-hint'
import { StatMetricGroup } from '@/components/stats/stat-metric'
import {
  averageMonthlyExpenses,
  runwayMonths,
  runwayYearsMonths,
  RUNWAY_EXCLUDED_CATEGORIES,
  showsStaleData,
  useCashflowStats,
  type StatsFilters,
  type StatsTypeFilters,
} from '@/lib/statistics'
import type { TransactionCategory } from '@/lib/transaction'
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
  filters,
  categories,
  typeFilters,
  enabled,
  onViewTransactions,
  onViewBalance,
}: {
  credentials: CredentialRead[]
  accountIds: number[]
  filters: StatsFilters
  categories: TransactionCategory[]
  typeFilters: StatsTypeFilters
  enabled: boolean
  onViewTransactions?: (categories: TransactionCategory[]) => void
  onViewBalance?: () => void
}) {
  const { t, i18n } = useTranslation()

  const excludedCategories = new Intl.ListFormat(i18n.language, {
    style: 'long',
    type: 'conjunction',
  }).format(RUNWAY_EXCLUDED_CATEGORIES.map((category) => t(`common.transactionLabel.${category}`)))

  const runwayCategories = categories.filter(
    (category) => !RUNWAY_EXCLUDED_CATEGORIES.includes(category),
  )
  const noCategories = runwayCategories.length === 0
  const cashflow = useCashflowStats(
    accountIds,
    filters,
    runwayCategories,
    typeFilters,
    enabled && !noCategories,
  )

  const accounts = credentials
    .flatMap((credential) => credential.accounts)
    .filter((account) => accountIds.includes(account.id))
  const balance = accounts.reduce((sum, account) => sum + account.balance, 0)

  const avgExpenses = noCategories
    ? 0
    : averageMonthlyExpenses(cashflow.data ?? [], filters.date_from, filters.date_to)
  const months = runwayMonths(balance, avgExpenses)

  const metrics = [
    {
      label: t('stats.runway.balance'),
      value: formatMoney(balance),
      onDrill: onViewBalance,
      drillLabel: t('stats.balance.title'),
    },
    {
      label: t('stats.runway.avgExpenses'),
      value: formatMoney(avgExpenses),
      onDrill:
        onViewTransactions && !noCategories
          ? () => onViewTransactions(runwayCategories)
          : undefined,
      drillLabel: t('stats.runway.viewTransactions'),
    },
    { label: t('stats.runway.remaining'), value: formatRunway(months, t) },
  ]

  return (
    <ChartCard
      title={t('stats.runway.title')}
      icon={<Hourglass className="size-4" aria-hidden="true" />}
      info={<InfoHint>{t('stats.runway.info', { categories: excludedCategories })}</InfoHint>}
      isLoading={!noCategories && cashflow.isLoading}
      isError={!noCategories && cashflow.isError}
      isEmpty={!noCategories && cashflow.data?.length === 0}
      isStale={!noCategories && showsStaleData(cashflow)}
    >
      <StatMetricGroup metrics={metrics} />
    </ChartCard>
  )
}
