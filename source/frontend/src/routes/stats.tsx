import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ChevronLeft } from 'lucide-react'
import { z } from 'zod'

import { AccountMultiSelect } from '@/components/ui/account-multi-select'
import { DatePicker } from '@/components/ui/date-picker'
import { Label } from '@/components/ui/label'
import { CategoryChart } from '@/components/stats/category-chart'
import { CategoryMultiSelect } from '@/components/stats/category-multi-select'
import { CashflowChart } from '@/components/stats/cashflow-chart'
import { ChartCard } from '@/components/stats/chart-card'
import { DrillArrowIcon } from '@/components/stats/chart-parts'
import { OtherPartyChart } from '@/components/stats/other-party-chart'
import { NetSavingsChart } from '@/components/stats/net-savings-chart'
import { NetWorthChart } from '@/components/stats/net-worth-chart'
import { SegmentedToggle } from '@/components/stats/segmented-toggle'
import { useAuthMe, type CredentialRead } from '@/lib/auth'
import { TRANSACTION_CATEGORIES, type TransactionCategory } from '@/lib/transaction'
import {
  DATE_RANGE_PRESETS,
  defaultStatsDateRange,
  FILTERABLE_CATEGORIES,
  matchingPreset,
  presetDateRange,
  useCashflowStats,
  useCategoryStats,
  useNetWorthStats,
  useOtherPartyStats,
  useNetSavingsStats,
  type ChartType,
  type DateRangePreset,
  type StatsDirection,
  type StatsFilters,
} from '@/lib/statistics'

// URL-state schema. `account_ids` may be omitted (→ all accounts) or carry a
// single account when opened from an account detail view; `categories` is
// omitted when all are selected (→ all categories).
const searchParamsSchema = z.object({
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  chart_type: z.enum(['bar', 'pie']).optional(),
  direction: z.enum(['INCOMING', 'OUTGOING']).optional(),
  account_ids: z
    .union([z.array(z.coerce.number()), z.coerce.number()])
    .transform((value) => (Array.isArray(value) ? value : [value]))
    .optional(),
  categories: z
    .union([z.enum(TRANSACTION_CATEGORIES), z.array(z.enum(TRANSACTION_CATEGORIES))])
    .transform((value) => (Array.isArray(value) ? value : [value]))
    .optional(),
})

export type StatsSearchParams = z.infer<typeof searchParamsSchema>

export const Route = createFileRoute('/stats')({
  component: StatsPage,
  validateSearch: (search) => searchParamsSchema.parse(search),
})

function StatsPage() {
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const { data: user } = useAuthMe()

  if (!user) return null // root guard already redirected on 401

  return (
    <StatsView
      credentials={user.credentials}
      search={search}
      onChange={(next) =>
        navigate({
          search: {
            account_ids: next.accountIds,
            date_from: next.filters.date_from,
            date_to: next.filters.date_to,
            chart_type: next.chartType,
            direction: next.direction,
            // Omit from the URL when all are selected (the default).
            categories:
              next.categories.length === FILTERABLE_CATEGORIES.length ? undefined : next.categories,
          },
          replace: false,
        })
      }
      onOpenSearch={(drill) => {
        const anchor = drill.accountIds[0]
        if (anchor == null) return
        // Map the stats "direction" (sign of amount) to the search's amount
        // range so the user lands on exactly the transactions the bar summed.
        navigate({
          to: '/account/$accountId/search',
          params: { accountId: String(anchor) },
          search: {
            account_ids: drill.accountIds,
            date_from: drill.dateFrom,
            date_to: drill.dateTo,
            category: drill.category,
            text: drill.text,
            amount_from: drill.direction === 'INCOMING' ? 0 : undefined,
            amount_to: drill.direction === 'OUTGOING' ? 0 : undefined,
            submitted: '1',
          },
        })
      }}
      onOpenDay={(date, accountIds) =>
        navigate({
          to: '/stats/day/$date',
          params: { date },
          search: { account_ids: accountIds },
        })
      }
    />
  )
}

export interface StatsViewState {
  accountIds: number[]
  filters: StatsFilters
  chartType: ChartType
  direction: StatsDirection
  categories: TransactionCategory[]
}

export interface StatsDrilldown {
  accountIds: number[]
  dateFrom?: string
  dateTo?: string
  direction?: StatsDirection
  category?: TransactionCategory
  text?: string
}

export interface StatsViewProps {
  credentials: CredentialRead[]
  search: StatsSearchParams
  onChange: (next: StatsViewState) => void
  onOpenSearch: (drill: StatsDrilldown) => void
  onOpenDay: (date: string, accountIds: number[]) => void
}

export function StatsView({
  credentials,
  search,
  onChange,
  onOpenSearch,
  onOpenDay,
}: StatsViewProps) {
  const { t } = useTranslation()
  const allAccountIds = credentials.flatMap((credential) =>
    credential.accounts.map((account) => account.id),
  )
  const defaults = defaultStatsDateRange()

  const accountIds = search.account_ids ?? allAccountIds
  const filters: StatsFilters = {
    date_from: search.date_from ?? defaults.date_from,
    date_to: search.date_to ?? defaults.date_to,
  }
  const chartType: ChartType = search.chart_type ?? 'bar'
  const direction: StatsDirection = search.direction ?? 'OUTGOING'
  // No `categories` in the URL → all selected (the default).
  const selectedCategories: TransactionCategory[] = search.categories ?? [...FILTERABLE_CATEGORIES]

  const sync = (next: Partial<StatsViewState>) =>
    onChange({ accountIds, filters, chartType, direction, categories: selectedCategories, ...next })

  const updateAccounts = (next: number[]) => sync({ accountIds: next })
  const updateFilter = (key: keyof StatsFilters, value: string | undefined) =>
    sync({ filters: { ...filters, [key]: value } })
  const applyDateRange = (from: string, to: string) =>
    sync({ filters: { date_from: from, date_to: to } })
  const applyPreset = (preset: DateRangePreset) => sync({ filters: presetDateRange(preset) })
  const updateChartType = (next: ChartType) => sync({ chartType: next })
  const updateDirection = (next: StatsDirection) => sync({ direction: next })
  const updateCategories = (next: TransactionCategory[]) => sync({ categories: next })

  // All categories selected → send none (the backend then applies no category
  // filter); a subset → send exactly that subset.
  const categoriesParam =
    selectedCategories.length === FILTERABLE_CATEGORIES.length ? [] : selectedCategories

  const openSearch = (extra: { category?: TransactionCategory; text?: string }) =>
    onOpenSearch({
      accountIds,
      dateFrom: filters.date_from,
      dateTo: filters.date_to,
      direction,
      ...extra,
    })

  // Net worth covers every transaction in the selected accounts over the range
  // (no category/direction), so its drill omits both to show exactly those.
  const openNetWorthSearch = () =>
    onOpenSearch({ accountIds, dateFrom: filters.date_from, dateTo: filters.date_to })

  const categories = useCategoryStats(accountIds, filters, direction, categoriesParam)
  const cashflow = useCashflowStats(accountIds, filters, categoriesParam)
  const netSavings = useNetSavingsStats(accountIds, filters, categoriesParam)
  const netWorth = useNetWorthStats(accountIds, filters)
  const otherParties = useOtherPartyStats(accountIds, filters, direction, categoriesParam)

  return (
    <main className="mx-auto flex min-h-full max-w-3xl flex-col gap-6 p-4">
      <header className="flex items-center gap-2">
        <Link
          to="/"
          aria-label={t('stats.back')}
          className="text-primary hover:text-primary/80 -ml-1.5 rounded-md p-1.5 transition-colors"
        >
          <ChevronLeft className="size-5" />
        </Link>
        <h1 className="text-foreground text-lg font-semibold">{t('stats.title')}</h1>
      </header>

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="stats-accounts">{t('stats.accountsLabel')}</Label>
          <AccountMultiSelect
            id="stats-accounts"
            credentials={credentials}
            selectedIds={accountIds}
            onChange={updateAccounts}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="stats-categories">{t('stats.categoriesLabel')}</Label>
          <CategoryMultiSelect
            id="stats-categories"
            selectedIds={selectedCategories}
            onChange={updateCategories}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="stats-date-from">{t('stats.dateFrom')}</Label>
            <DatePicker
              id="stats-date-from"
              value={filters.date_from ?? ''}
              onChange={(next) => updateFilter('date_from', next || undefined)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="stats-date-to">{t('stats.dateTo')}</Label>
            <DatePicker
              id="stats-date-to"
              value={filters.date_to ?? ''}
              onChange={(next) => updateFilter('date_to', next || undefined)}
            />
          </div>
        </div>
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
          ariaLabel={t('stats.directionLabel')}
          value={direction}
          onChange={updateDirection}
          options={[
            { value: 'OUTGOING', label: t('stats.direction.OUTGOING') },
            { value: 'INCOMING', label: t('stats.direction.INCOMING') },
          ]}
        />
      </section>

      {accountIds.length === 0 ? (
        <p className="text-muted-foreground border-border bg-card rounded-lg border border-dashed p-8 text-center text-sm">
          {t('stats.noAccounts')}
        </p>
      ) : selectedCategories.length === 0 ? (
        <p className="text-muted-foreground border-border bg-card rounded-lg border border-dashed p-8 text-center text-sm">
          {t('stats.noCategories')}
        </p>
      ) : (
        <>
          <ChartCard
            title={t('stats.netWorth.title')}
            isLoading={netWorth.isLoading}
            isError={netWorth.isError}
            isEmpty={(netWorth.data?.series.length ?? 0) === 0}
            action={
              <button
                type="button"
                onClick={openNetWorthSearch}
                aria-label={t('stats.netWorth.viewTransactions')}
                className="stats-drill-arrow -m-1 rounded-md p-1"
              >
                <DrillArrowIcon />
              </button>
            }
          >
            <NetWorthChart
              data={netWorth.data?.series ?? []}
              summary={netWorth.data?.summary ?? null}
              onSelectRange={applyDateRange}
              onOpenDay={(date) => onOpenDay(date, accountIds)}
            />
          </ChartCard>

          <ChartCard
            title={t('stats.categories.title')}
            isLoading={categories.isLoading}
            isError={categories.isError}
            isEmpty={(categories.data?.length ?? 0) === 0}
            action={
              <SegmentedToggle
                ariaLabel={t('stats.chartTypeLabel')}
                value={chartType}
                onChange={updateChartType}
                options={[
                  { value: 'bar', label: t('stats.chartType.bar') },
                  { value: 'pie', label: t('stats.chartType.pie') },
                ]}
              />
            }
          >
            <CategoryChart
              slices={categories.data ?? []}
              chartType={chartType}
              onDrill={(category) => openSearch({ category })}
            />
          </ChartCard>

          <ChartCard
            title={t('stats.cashflow.title')}
            isLoading={cashflow.isLoading}
            isError={cashflow.isError}
            isEmpty={(cashflow.data?.length ?? 0) === 0}
          >
            <CashflowChart data={cashflow.data ?? []} />
          </ChartCard>

          <ChartCard
            title={t('stats.netSavings.title')}
            isLoading={netSavings.isLoading}
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
            isLoading={otherParties.isLoading}
            isError={otherParties.isError}
            isEmpty={(otherParties.data?.length ?? 0) === 0}
          >
            <OtherPartyChart
              data={otherParties.data ?? []}
              onDrill={(party) => openSearch({ text: party })}
            />
          </ChartCard>
        </>
      )}
    </main>
  )
}
