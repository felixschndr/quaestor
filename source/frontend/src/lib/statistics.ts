import { useQuery } from '@tanstack/react-query'
import { format, subMonths } from 'date-fns'

import { api } from './api'
import { TRANSACTION_CATEGORIES, type TransactionCategory } from './transaction'

// Direction of money flow a statistic is computed over. Mirrors the backend's
// StatisticsDirection and the TransactionType member names: OUTGOING = money out
// (negative amounts), INCOMING = money in (positive amounts).
export type StatsDirection = 'INCOMING' | 'OUTGOING'

// Which visual a chart renders in. Only the category chart is switchable.
export type ChartType = 'bar' | 'pie'

export interface StatsFilters {
  date_from?: string // ISO yyyy-mm-dd
  date_to?: string
}

// Categories offered in the stats filter. Excludes TRANSFER: it is not a member
// of the backend's TransactionCategory enum (no transaction ever has it), so
// sending it would 422.
export const FILTERABLE_CATEGORIES: TransactionCategory[] = TRANSACTION_CATEGORIES.filter(
  (category) => category !== 'TRANSFER',
)

// Response shapes — mirror source/backend/api/schemas/statistics.py.
export interface CategorySlice {
  category: TransactionCategory
  total: number
}

export interface MonthlyCashflow {
  month: string // "YYYY-MM"
  income: number
  expenses: number
}

export interface MonthlyNetSavings {
  month: string
  net: number
  savings_rate: number
}

export interface OtherPartySlice {
  other_party: string
  total: number
}

const NUMBER_OF_DEFAULT_MONTHS = 3

/**
 * Default filter range for the stats page: the last three months up to today.
 * `today` is injectable so tests can pin a date instead of depending on the
 * wall clock.
 */
export function defaultStatsDateRange(today: Date = new Date()): Required<StatsFilters> {
  return {
    date_from: format(subMonths(today, NUMBER_OF_DEFAULT_MONTHS), 'yyyy-MM-dd'),
    date_to: format(today, 'yyyy-MM-dd'),
  }
}

/**
 * Build the querystring shared by every stats request: repeated `account_ids`
 * plus the filter fields and any extras (direction, limit). Mirrors
 * buildFilterQueryString in transactionSearch.ts — drop undefined/empty, keep 0.
 */
export function buildStatsQueryString(
  accountIds: number[],
  filters: StatsFilters,
  extra: Record<string, string | number | undefined> = {},
  categories: TransactionCategory[] = [],
): string {
  const params = new URLSearchParams()
  for (const accountId of accountIds) {
    params.append('account_ids', String(accountId))
  }
  // Empty `categories` means "all" — the backend applies no category filter.
  for (const category of categories) {
    params.append('categories', category)
  }
  for (const [key, value] of Object.entries({ ...filters, ...extra })) {
    if (value === undefined || value === null) continue
    if (typeof value === 'string' && value.length === 0) continue
    params.append(key, String(value))
  }
  return params.toString()
}

const sortedIds = (accountIds: number[]) => [...accountIds].sort((a, b) => a - b)
const sortedCategories = (categories: TransactionCategory[]) => [...categories].sort()

export const statisticsQueryKeys = {
  categories: (
    accountIds: number[],
    filters: StatsFilters,
    direction: StatsDirection,
    categories: TransactionCategory[],
  ) =>
    [
      'statistics',
      'categories',
      sortedIds(accountIds),
      filters,
      direction,
      sortedCategories(categories),
    ] as const,
  cashflow: (accountIds: number[], filters: StatsFilters, categories: TransactionCategory[]) =>
    [
      'statistics',
      'cashflow',
      sortedIds(accountIds),
      filters,
      sortedCategories(categories),
    ] as const,
  netSavings: (accountIds: number[], filters: StatsFilters, categories: TransactionCategory[]) =>
    [
      'statistics',
      'net-savings',
      sortedIds(accountIds),
      filters,
      sortedCategories(categories),
    ] as const,
  otherParties: (
    accountIds: number[],
    filters: StatsFilters,
    direction: StatsDirection,
    categories: TransactionCategory[],
  ) =>
    [
      'statistics',
      'otherParties',
      sortedIds(accountIds),
      filters,
      direction,
      sortedCategories(categories),
    ] as const,
}

export function useCategoryStats(
  accountIds: number[],
  filters: StatsFilters,
  direction: StatsDirection,
  categories: TransactionCategory[],
) {
  const queryString = buildStatsQueryString(accountIds, filters, { direction }, categories)
  return useQuery({
    queryKey: statisticsQueryKeys.categories(accountIds, filters, direction, categories),
    queryFn: () => api<CategorySlice[]>(`/statistics/categories?${queryString}`),
    enabled: accountIds.length > 0,
    staleTime: 30_000,
  })
}

export function useCashflowStats(
  accountIds: number[],
  filters: StatsFilters,
  categories: TransactionCategory[],
) {
  const queryString = buildStatsQueryString(accountIds, filters, {}, categories)
  return useQuery({
    queryKey: statisticsQueryKeys.cashflow(accountIds, filters, categories),
    queryFn: () => api<MonthlyCashflow[]>(`/statistics/cashflow?${queryString}`),
    enabled: accountIds.length > 0,
    staleTime: 30_000,
  })
}

export function useNetSavingsStats(
  accountIds: number[],
  filters: StatsFilters,
  categories: TransactionCategory[],
) {
  const queryString = buildStatsQueryString(accountIds, filters, {}, categories)
  return useQuery({
    queryKey: statisticsQueryKeys.netSavings(accountIds, filters, categories),
    queryFn: () => api<MonthlyNetSavings[]>(`/statistics/net-savings?${queryString}`),
    enabled: accountIds.length > 0,
    staleTime: 30_000,
  })
}

export function useOtherPartyStats(
  accountIds: number[],
  filters: StatsFilters,
  direction: StatsDirection,
  categories: TransactionCategory[],
) {
  const queryString = buildStatsQueryString(accountIds, filters, { direction }, categories)
  return useQuery({
    queryKey: statisticsQueryKeys.otherParties(accountIds, filters, direction, categories),
    queryFn: () => api<OtherPartySlice[]>(`/statistics/other-parties?${queryString}`),
    enabled: accountIds.length > 0,
    staleTime: 30_000,
  })
}

// One datum of the category chart. `category` is the enum value, or the
// 'OTHER' sentinel for the aggregated tail of the pie.
export interface CategoryChartDatum {
  category: TransactionCategory | 'OTHER'
  label: string
  value: number
}

/**
 * Collapse all but the `n` biggest categories into a single "Other" slice so a
 * pie with ~24 categories stays readable. Returns the input untouched when it
 * already fits. Pure — unit-tested directly.
 */
export function aggregateTopN(
  data: CategoryChartDatum[],
  n: number,
  otherLabel: string,
): CategoryChartDatum[] {
  if (data.length <= n) return data
  const sorted = [...data].sort((a, b) => b.value - a.value)
  const top = sorted.slice(0, n)
  const otherValue = sorted.slice(n).reduce((sum, datum) => sum + datum.value, 0)
  if (otherValue <= 0) return top
  return [
    ...top,
    { category: 'OTHER', label: otherLabel, value: Math.round(otherValue * 100) / 100 },
  ]
}

// Chart palette: mid-lightness oklch hues that read on both the dark and light
// themes (which only swap the background). Ordered so consecutive entries jump
// across the hue wheel (warm/cool alternating) — adjacent slices/bars then
// contrast strongly. The first ~9 (all a pie ever shows: top-8 + "Other") are
// well-separated hues, so no two visible slices look alike.
const CHART_PALETTE = [
  'oklch(0.66 0.16 250)', // blue
  'oklch(0.73 0.17 60)', // orange
  'oklch(0.72 0.17 150)', // green
  'oklch(0.66 0.20 330)', // magenta
  'oklch(0.75 0.13 195)', // teal
  'oklch(0.66 0.20 25)', // red
  'oklch(0.64 0.17 285)', // purple
  'oklch(0.80 0.16 100)', // yellow
  'oklch(0.70 0.18 355)', // pink
  'oklch(0.71 0.13 220)', // sky
  'oklch(0.74 0.16 120)', // lime
  'oklch(0.70 0.13 40)', // amber
]

const OTHER_COLOR = 'oklch(0.6 0 0)'

/**
 * The single source of chart colors: the bar/slice color for a given rank
 * (position in the share-sorted data). Positional — not keyed on the entity —
 * so the first N items always use N distinct palette entries, and every chart
 * (category bar, pie, otherParties) colors rank N identically.
 */
export function paletteColor(index: number): string {
  return CHART_PALETTE[index % CHART_PALETTE.length]
}

/** Like {@link paletteColor} but with the 'OTHER' pie bucket rendered neutral gray. */
export function sliceColor(category: TransactionCategory | 'OTHER', index: number): string {
  return category === 'OTHER' ? OTHER_COLOR : paletteColor(index)
}
