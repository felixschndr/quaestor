import { useTranslation } from 'react-i18next'
import { ArrowLeftRight, BarChart3, LineChart, PieChart, PiggyBank, Users } from 'lucide-react'

import { BackLink } from '@/components/back-link'
import { AccountMultiSelect } from '@/components/ui/account-multi-select'
import { AdvancedFilters } from '@/components/ui/advanced-filters'
import { FilterHeading } from '@/components/ui/filter-heading'
import { DateRangeFields } from '@/components/ui/date-range-fields'
import { Label } from '@/components/ui/label'
import { TransactionFilterFields } from '@/components/ui/transaction-filter-fields'
import { CategoryChart } from '@/components/stats/category-chart'
import { CategoryTrendChart } from '@/components/stats/category-trend-chart'
import { CashflowChart } from '@/components/stats/cashflow-chart'
import { ChartCard } from '@/components/stats/chart-card'
import { ContractsSummaryCard } from '@/components/stats/contracts-summary-card'
import { RunwayCard } from '@/components/stats/runway-card'
import { DrillArrowIcon } from '@/components/stats/chart-parts'
import { OtherPartyChart } from '@/components/stats/other-party-chart'
import { NetSavingsChart } from '@/components/stats/net-savings-chart'
import { NetWorthChart } from '@/components/stats/net-worth-chart'
import { SegmentedToggle } from '@/components/stats/segmented-toggle'
import { TransactionCountChart } from '@/components/stats/transaction-count-chart'
import {
  TRANSACTION_TYPES,
  type TransactionCategory,
  type TransactionType,
} from '@/lib/transaction'
import {
  baselineDateRange,
  baselineRangeDescriptor,
  DATE_RANGE_PRESETS,
  defaultStatsDateRange,
  FILTERABLE_CATEGORIES,
  DEFAULT_TREND_PERIODS,
  matchingPreset,
  monthDateRange,
  presetDateRange,
  showsStaleData,
  TRANSACTION_COUNT_GROUPINGS,
  TREND_PERIOD_OPTIONS,
  useCashflowStats,
  useCategoryStats,
  useCategoryTrendStats,
  useNetWorthStats,
  useOtherPartyStats,
  useNetSavingsStats,
  useTransactionCountStats,
  type ChartType,
  type DateRangePreset,
  type StatsDirection,
  type StatsFilters,
  type StatsLinked,
  type StatsTypeFilters,
  type TransactionCountsGroupBy,
} from '@/lib/statistics'
import { defaultAccountIds } from '@/lib/accounts'
import { useScrollRestoration } from '@/lib/useScrollRestoration'
import type { TransactionSortKey } from '@/lib/transactionSearchParams'
import type { StatsViewProps, StatsViewState } from '@/routes/stats'

export function StatsView({
  credentials,
  search,
  onChange,
  onOpenSearch,
  onOpenDay,
  onOpenBalance,
}: StatsViewProps) {
  const { t } = useTranslation()
  useScrollRestoration('stats')
  const defaultIds = defaultAccountIds(credentials)
  const defaults = defaultStatsDateRange()

  const accountIds = search.account_ids ?? defaultIds
  const filters: StatsFilters = {
    date_from: search.date_from ?? defaults.date_from,
    date_to: search.date_to ?? defaults.date_to,
  }
  const chartType: ChartType = search.chart_type ?? 'bar'
  const countGroup: TransactionCountsGroupBy = search.count_group ?? 'day'
  const trendPeriods = search.trend_periods ?? DEFAULT_TREND_PERIODS
  const trendRange = baselineRangeDescriptor(
    filters.date_from ?? defaults.date_from,
    filters.date_to ?? defaults.date_to,
    trendPeriods,
  )
  const trendRangeKey =
    trendRange.unit === 'days'
      ? 'rangeDays'
      : trendRange.unit === 'weeks'
        ? 'rangeWeeks'
        : 'rangeMonths'
  const trendRangeLabel = t(`stats.categoryTrend.${trendRangeKey}`, {
    periods: trendRange.periods,
    len: trendRange.len,
    total: trendRange.unit === 'days' ? trendRange.totalDays : trendRange.periods * trendRange.len,
  })
  const direction: StatsDirection = search.direction ?? 'OUTGOING'
  const selectedCategories: TransactionCategory[] = search.categories ?? [...FILTERABLE_CATEGORIES]
  const selectedTypes: TransactionType[] = search.transaction_types ?? [...TRANSACTION_TYPES]
  const linked: StatsLinked | undefined =
    search.linked === 'any' ? undefined : (search.linked ?? 'unlinked')
  const hiddenCategories = search.hidden_categories ?? []
  const hiddenParties = search.hidden_parties ?? []

  const sync = (next: Partial<StatsViewState>) =>
    onChange({
      accountIds,
      filters,
      chartType,
      countGroup,
      trendPeriods,
      direction,
      categories: selectedCategories,
      transactionTypes: selectedTypes,
      linked,
      hiddenCategories,
      hiddenParties,
      ...next,
    })

  const filtersActive =
    accountIds.length !== defaultIds.length ||
    filters.date_from !== defaults.date_from ||
    filters.date_to !== defaults.date_to ||
    direction !== 'OUTGOING' ||
    selectedCategories.length !== FILTERABLE_CATEGORIES.length ||
    selectedTypes.length !== TRANSACTION_TYPES.length ||
    linked !== 'unlinked' ||
    hiddenCategories.length > 0 ||
    hiddenParties.length > 0
  const resetFilters = () =>
    sync({
      accountIds: defaultIds,
      filters: defaults,
      direction: 'OUTGOING',
      categories: [...FILTERABLE_CATEGORIES],
      transactionTypes: [...TRANSACTION_TYPES],
      linked: 'unlinked',
      hiddenCategories: [],
      hiddenParties: [],
    })

  const updateAccounts = (next: number[]) => sync({ accountIds: next })
  const updateFilter = (key: keyof StatsFilters, value: string | undefined) =>
    sync({ filters: { ...filters, [key]: value } })
  const applyPreset = (preset: DateRangePreset) => sync({ filters: presetDateRange(preset) })
  const updateChartType = (next: ChartType) => sync({ chartType: next })
  const updateTrendPeriods = (next: number) => sync({ trendPeriods: next })
  const updateCountGroup = (next: TransactionCountsGroupBy) => sync({ countGroup: next })
  const updateDirection = (next: StatsDirection) => sync({ direction: next })
  const updateCategories = (next: TransactionCategory[]) => sync({ categories: next })
  const updateTypes = (next: TransactionType[]) => sync({ transactionTypes: next })
  const updateLinked = (next: StatsLinked | undefined) => sync({ linked: next })
  const toggleHiddenCategory = (category: TransactionCategory | 'OTHER') =>
    sync({
      hiddenCategories: hiddenCategories.includes(category)
        ? hiddenCategories.filter((entry) => entry !== category)
        : [...hiddenCategories, category],
    })
  const toggleHiddenParty = (party: string) =>
    sync({
      hiddenParties: hiddenParties.includes(party)
        ? hiddenParties.filter((entry) => entry !== party)
        : [...hiddenParties, party],
    })

  const categoriesParam =
    selectedCategories.length === FILTERABLE_CATEGORIES.length ? [] : selectedCategories
  const typesParam = selectedTypes.length === TRANSACTION_TYPES.length ? [] : selectedTypes
  const typeFilters: StatsTypeFilters = { transaction_types: typesParam, linked }

  const hasSelection =
    accountIds.length > 0 &&
    selectedCategories.length > 0 &&
    selectedTypes.length > 0 &&
    linked !== 'none'

  const marketValued = new Set(
    credentials
      .flatMap((credential) => credential.accounts)
      .filter((account) => account.is_market_valued)
      .map((account) => account.id),
  )
  const cashAccountIds = accountIds.filter((id) => !marketValued.has(id))

  const drillSort: TransactionSortKey = direction === 'INCOMING' ? 'amount_desc' : 'amount_asc'

  const openSearch = (extra: {
    categories?: TransactionCategory[]
    text?: string
    dateFrom?: string
    dateTo?: string
    direction?: StatsDirection
  }) =>
    onOpenSearch({
      accountIds: cashAccountIds,
      dateFrom: filters.date_from,
      dateTo: filters.date_to,
      direction,
      transactionTypes: typesParam,
      linked,
      categories: categoriesParam,
      sort: drillSort,
      ...extra,
    })

  const openMonthSearch = (month: string, monthDirection: StatsDirection) => {
    const { from, to } = monthDateRange(month)
    openSearch({ dateFrom: from, dateTo: to, direction: monthDirection })
  }

  const openBaselineSearch = (category: TransactionCategory) => {
    const range = baselineDateRange(
      filters.date_from ?? defaults.date_from,
      filters.date_to ?? defaults.date_to,
      trendPeriods,
    )
    onOpenSearch({
      accountIds: cashAccountIds,
      dateFrom: range.from,
      dateTo: range.to,
      direction,
      transactionTypes: typesParam,
      linked,
      categories: [category],
      sort: drillSort,
    })
  }

  const openNetWorthSearch = () =>
    onOpenSearch({ accountIds, dateFrom: filters.date_from, dateTo: filters.date_to })

  const openRunwaySearch = (runwayCategories: TransactionCategory[]) =>
    onOpenSearch({
      accountIds,
      dateFrom: filters.date_from,
      dateTo: filters.date_to,
      direction: 'OUTGOING',
      transactionTypes: typesParam,
      linked,
      categories: runwayCategories,
      sort: 'amount_asc',
    })

  const trendMode = chartType === 'trend'
  const categories = useCategoryStats(
    accountIds,
    filters,
    direction,
    categoriesParam,
    typeFilters,
    hasSelection && !trendMode,
  )
  const categoryTrend = useCategoryTrendStats(
    accountIds,
    filters,
    direction,
    categoriesParam,
    trendPeriods,
    typeFilters,
    hasSelection && trendMode,
  )
  const categoryQuery = trendMode ? categoryTrend : categories
  const cashflow = useCashflowStats(accountIds, filters, categoriesParam, typeFilters, hasSelection)
  const transactionCounts = useTransactionCountStats(
    accountIds,
    filters,
    categoriesParam,
    typeFilters,
    countGroup,
    hasSelection,
  )
  const netSavings = useNetSavingsStats(
    accountIds,
    filters,
    categoriesParam,
    typeFilters,
    hasSelection,
  )
  const netWorth = useNetWorthStats(accountIds, filters, hasSelection)
  const otherParties = useOtherPartyStats(
    accountIds,
    filters,
    direction,
    categoriesParam,
    typeFilters,
    hasSelection,
  )

  return (
    <main className="mx-auto flex min-h-full max-w-page flex-col gap-6 p-4">
      <header className="flex items-center gap-2">
        <BackLink to="/" />
        <h1 className="text-foreground text-lg font-semibold">{t('stats.title')}</h1>
      </header>

      <section className="border-border bg-card flex flex-col gap-3 rounded-lg border p-3">
        <FilterHeading onReset={filtersActive ? resetFilters : undefined} />
        <SegmentedToggle
          fullWidth
          ariaLabel={t('stats.rangeLabel')}
          value={matchingPreset(filters)}
          onChange={applyPreset}
          options={DATE_RANGE_PRESETS.map((preset) => ({
            value: preset,
            label: t(`stats.range.${preset}`),
          }))}
        />
        <SegmentedToggle
          fullWidth
          ariaLabel={t('common.direction')}
          value={direction}
          onChange={updateDirection}
          options={[
            { value: 'OUTGOING', label: t('common.expenses') },
            { value: 'INCOMING', label: t('common.income') },
          ]}
        />

        <AdvancedFilters storageKey="stats">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="stats-accounts">{t('common.accounts')}</Label>
            <AccountMultiSelect
              id="stats-accounts"
              credentials={credentials}
              selectedIds={accountIds}
              onChange={updateAccounts}
            />
          </div>
          <DateRangeFields
            idPrefix="stats"
            dateFrom={filters.date_from}
            dateTo={filters.date_to}
            onDateFromChange={(next) => updateFilter('date_from', next)}
            onDateToChange={(next) => updateFilter('date_to', next)}
          />
          <TransactionFilterFields
            idPrefix="stats"
            selectedCategories={selectedCategories}
            onCategoriesChange={updateCategories}
            selectedTypes={selectedTypes}
            onTypesChange={updateTypes}
            transfer={linked}
            onTransferChange={updateLinked}
          />
        </AdvancedFilters>
      </section>

      {!hasSelection ? (
        <p className="text-muted-foreground text-sm">{t('stats.noMatches')}</p>
      ) : (
        <>
          <ContractsSummaryCard accountIds={accountIds} categories={categoriesParam} />

          <RunwayCard
            credentials={credentials}
            accountIds={accountIds}
            filters={filters}
            categories={selectedCategories}
            typeFilters={typeFilters}
            enabled={hasSelection}
            onViewTransactions={openRunwaySearch}
            onViewBalance={() => onOpenBalance(accountIds)}
          />

          <ChartCard
            title={t('stats.netWorth.title')}
            icon={<LineChart className="size-4" aria-hidden="true" />}
            isLoading={netWorth.isLoading}
            isStale={showsStaleData(netWorth)}
            isError={netWorth.isError}
            isEmpty={(netWorth.data?.series.length ?? 0) === 0}
            action={
              <button
                type="button"
                onClick={openNetWorthSearch}
                aria-label={t('stats.netWorth.viewTransactions')}
                className="stats-drill-arrow -m-1 inline-flex items-center gap-1 rounded-md p-1 text-xs font-medium"
              >
                <span className="sm:hidden">{t('stats.netWorth.viewTransactionsShort')}</span>
                <span className="hidden sm:inline">{t('stats.netWorth.viewTransactions')}</span>
                <DrillArrowIcon />
              </button>
            }
          >
            <NetWorthChart
              data={netWorth.data?.series ?? []}
              summary={netWorth.data?.summary ?? null}
              onOpenDay={(date) => onOpenDay(date, accountIds)}
            />
          </ChartCard>

          <ChartCard
            title={t('stats.categories.title')}
            icon={<PieChart className="size-4" aria-hidden="true" />}
            isLoading={categoryQuery.isLoading}
            isStale={showsStaleData(categoryQuery)}
            isError={categoryQuery.isError}
            isEmpty={(categoryQuery.data?.length ?? 0) === 0}
            action={
              <SegmentedToggle
                ariaLabel={t('stats.chartTypeLabel')}
                value={chartType}
                onChange={updateChartType}
                options={[
                  { value: 'bar', label: t('stats.chartType.bar') },
                  { value: 'pie', label: t('stats.chartType.pie') },
                  { value: 'trend', label: t('stats.chartType.trend') },
                ]}
              />
            }
          >
            {trendMode ? (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-muted-foreground text-xs">
                    {t('stats.categoryTrend.hint', { range: trendRangeLabel })}
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground text-xs">
                      {t('stats.categoryTrend.periodsLabel')}
                    </span>
                    <SegmentedToggle
                      ariaLabel={t('stats.categoryTrend.periodsLabel')}
                      value={trendPeriods}
                      onChange={updateTrendPeriods}
                      options={TREND_PERIOD_OPTIONS.map((count) => ({
                        value: count,
                        label: String(count),
                      }))}
                    />
                  </div>
                </div>
                <CategoryTrendChart
                  slices={categoryTrend.data ?? []}
                  direction={direction}
                  onDrill={(category) =>
                    openSearch({ categories: [category as TransactionCategory] })
                  }
                  onDrillBaseline={(category) =>
                    openBaselineSearch(category as TransactionCategory)
                  }
                />
              </div>
            ) : (
              <CategoryChart
                slices={categories.data ?? []}
                chartType={chartType}
                hidden={new Set(hiddenCategories)}
                onToggleHidden={toggleHiddenCategory}
                onDrill={(categories) => openSearch({ categories })}
              />
            )}
          </ChartCard>

          <ChartCard
            title={t('stats.cashflow.title')}
            icon={<ArrowLeftRight className="size-4" aria-hidden="true" />}
            isLoading={cashflow.isLoading}
            isStale={showsStaleData(cashflow)}
            isError={cashflow.isError}
            isEmpty={(cashflow.data?.length ?? 0) === 0}
          >
            <CashflowChart data={cashflow.data ?? []} onSelectMonth={openMonthSearch} />
          </ChartCard>

          <ChartCard
            title={t('stats.transactionCounts.title')}
            icon={<BarChart3 className="size-4" aria-hidden="true" />}
            isLoading={transactionCounts.isLoading}
            isStale={showsStaleData(transactionCounts)}
            isError={transactionCounts.isError}
            isEmpty={(transactionCounts.data?.length ?? 0) === 0}
            action={
              <SegmentedToggle
                ariaLabel={t('stats.transactionCounts.groupLabel')}
                value={countGroup}
                onChange={updateCountGroup}
                options={TRANSACTION_COUNT_GROUPINGS.map((grouping) => ({
                  value: grouping,
                  label: t(`stats.transactionCounts.group.${grouping}`),
                }))}
              />
            }
          >
            <TransactionCountChart
              data={transactionCounts.data ?? []}
              groupBy={countGroup}
              dateFrom={filters.date_from}
              dateTo={filters.date_to}
            />
          </ChartCard>

          <ChartCard
            title={t('stats.netSavings.title')}
            icon={<PiggyBank className="size-4" aria-hidden="true" />}
            isLoading={netSavings.isLoading}
            isStale={showsStaleData(netSavings)}
            isError={netSavings.isError}
            isEmpty={(netSavings.data?.length ?? 0) === 0}
          >
            <NetSavingsChart data={netSavings.data ?? []} />
          </ChartCard>

          <ChartCard
            title={
              direction === 'OUTGOING'
                ? t('stats.otherParties.titleOutgoing')
                : t('stats.otherParties.titleIncoming')
            }
            icon={<Users className="size-4" aria-hidden="true" />}
            isLoading={otherParties.isLoading}
            isStale={showsStaleData(otherParties)}
            isError={otherParties.isError}
            isEmpty={(otherParties.data?.length ?? 0) === 0}
          >
            <OtherPartyChart
              data={otherParties.data ?? []}
              hidden={new Set(hiddenParties)}
              onToggleHidden={toggleHiddenParty}
              onDrill={(party) => openSearch({ text: party })}
            />
          </ChartCard>
        </>
      )}
    </main>
  )
}
