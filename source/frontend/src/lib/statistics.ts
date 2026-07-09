import { useQuery } from '@tanstack/react-query'
import { format, subDays, subMonths, subWeeks, subYears } from 'date-fns'

import { api } from './api'
import type { TransactionRead } from './accountHistory'
import {
  TRANSACTION_CATEGORIES,
  type TransactionCategory,
  type TransactionType,
} from './transaction'

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

export type StatsLinked = 'linked' | 'unlinked'

export interface StatsTypeFilters {
  transaction_types?: TransactionType[]
  linked?: StatsLinked
}

export const FILTERABLE_CATEGORIES: TransactionCategory[] = [...TRANSACTION_CATEGORIES]

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

export interface DailyNetWorth {
  date: string // ISO yyyy-mm-dd
  value: number
}

export interface NetWorthSummary {
  minimum: number
  average: number
  maximum: number
}

export interface NetWorthResponse {
  series: DailyNetWorth[]
  summary: NetWorthSummary | null // null when the series is empty.
}

export interface AccountRangeChange {
  account_id: number
  balance_at_start: number | null
  balance_at_end: number | null
  difference: number
  transactions: TransactionRead[]
}

export interface NetWorthRangeResponse {
  start: string
  end: string
  accounts: AccountRangeChange[]
  total_at_start: number
  total_at_end: number
  total_difference: number
}

/** Identifier for the shortcut buttons of the date-range picker. */
export type DateRangePreset = '2w' | '1m' | '3m' | '6m' | '1y' | '3y'

export const DATE_RANGE_PRESETS: readonly DateRangePreset[] = ['2w', '1m', '3m', '6m', '1y', '3y']

const formatDay = (date: Date): string => format(date, 'yyyy-MM-dd')

function presetStart(preset: DateRangePreset, today: Date): Date {
  switch (preset) {
    case '2w':
      return subWeeks(today, 2)
    case '1m':
      return subMonths(today, 1)
    case '3m':
      return subMonths(today, 3)
    case '6m':
      return subMonths(today, 6)
    case '1y':
      return subYears(today, 1)
    case '3y':
      return subYears(today, 3)
  }
}

/**
 * The date range a shortcut button represents: a span ending today.
 * `today` is injectable so tests can pin a date instead of depending on the
 * wall clock.
 */
export function presetDateRange(
  preset: DateRangePreset,
  today: Date = new Date(),
): Required<StatsFilters> {
  return {
    date_from: formatDay(presetStart(preset, today)),
    date_to: formatDay(today),
  }
}

export type DetailRangePreset = '1d' | '3d' | '1w' | '2w' | '1m'

export const DETAIL_RANGE_PRESETS: readonly DetailRangePreset[] = ['1d', '3d', '1w', '2w', '1m']

function detailPresetStart(preset: DetailRangePreset, end: Date): Date {
  switch (preset) {
    case '1d':
      return subDays(end, 1)
    case '3d':
      return subDays(end, 3)
    case '1w':
      return subWeeks(end, 1)
    case '2w':
      return subWeeks(end, 2)
    case '1m':
      return subMonths(end, 1)
  }
}

export function detailPresetRange(
  preset: DetailRangePreset,
  today: Date = new Date(),
): { start: string; end: string } {
  return {
    start: formatDay(detailPresetStart(preset, today)),
    end: formatDay(today),
  }
}

export function matchingDetailPreset(
  start: string,
  end: string,
  today: Date = new Date(),
): DetailRangePreset | null {
  for (const preset of DETAIL_RANGE_PRESETS) {
    const range = detailPresetRange(preset, today)
    if (range.start === start && range.end === end) {
      return preset
    }
  }
  return null
}

export function defaultStatsDateRange(today: Date = new Date()): Required<StatsFilters> {
  return presetDateRange('1m', today)
}

export function matchingPreset(
  filters: StatsFilters,
  today: Date = new Date(),
): DateRangePreset | null {
  if (!filters.date_from || !filters.date_to) return null
  for (const preset of DATE_RANGE_PRESETS) {
    const range = presetDateRange(preset, today)
    if (range.date_from === filters.date_from && range.date_to === filters.date_to) {
      return preset
    }
  }
  return null
}

export function buildStatsQueryString(
  accountIds: number[],
  filters: StatsFilters,
  extra: Record<string, string | number | string[] | undefined> = {},
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
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, String(item))
      continue
    }
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
    typeFilters: StatsTypeFilters,
  ) =>
    [
      'statistics',
      'categories',
      sortedIds(accountIds),
      filters,
      direction,
      sortedCategories(categories),
      typeFilters,
    ] as const,
  cashflow: (
    accountIds: number[],
    filters: StatsFilters,
    categories: TransactionCategory[],
    typeFilters: StatsTypeFilters,
  ) =>
    [
      'statistics',
      'cashflow',
      sortedIds(accountIds),
      filters,
      sortedCategories(categories),
      typeFilters,
    ] as const,
  netSavings: (
    accountIds: number[],
    filters: StatsFilters,
    categories: TransactionCategory[],
    typeFilters: StatsTypeFilters,
  ) =>
    [
      'statistics',
      'net-savings',
      sortedIds(accountIds),
      filters,
      sortedCategories(categories),
      typeFilters,
    ] as const,
  otherParties: (
    accountIds: number[],
    filters: StatsFilters,
    direction: StatsDirection,
    categories: TransactionCategory[],
    typeFilters: StatsTypeFilters,
  ) =>
    [
      'statistics',
      'otherParties',
      sortedIds(accountIds),
      filters,
      direction,
      sortedCategories(categories),
      typeFilters,
    ] as const,
  netWorth: (accountIds: number[], filters: StatsFilters) =>
    ['statistics', 'net-worth', sortedIds(accountIds), filters] as const,
  netWorthRange: (start: string, end: string, accountIds: number[]) =>
    ['statistics', 'net-worth', 'range', start, end, sortedIds(accountIds)] as const,
}

export function useCategoryStats(
  accountIds: number[],
  filters: StatsFilters,
  direction: StatsDirection,
  categories: TransactionCategory[],
  typeFilters: StatsTypeFilters = {},
  enabled: boolean = true,
) {
  const queryString = buildStatsQueryString(
    accountIds,
    filters,
    { direction, ...typeFilters },
    categories,
  )
  return useQuery({
    queryKey: statisticsQueryKeys.categories(
      accountIds,
      filters,
      direction,
      categories,
      typeFilters,
    ),
    queryFn: () => api<CategorySlice[]>(`/statistics/categories?${queryString}`),
    enabled: enabled && accountIds.length > 0,
    staleTime: 30_000,
  })
}

export function useCashflowStats(
  accountIds: number[],
  filters: StatsFilters,
  categories: TransactionCategory[],
  typeFilters: StatsTypeFilters = {},
  enabled: boolean = true,
) {
  const queryString = buildStatsQueryString(accountIds, filters, { ...typeFilters }, categories)
  return useQuery({
    queryKey: statisticsQueryKeys.cashflow(accountIds, filters, categories, typeFilters),
    queryFn: () => api<MonthlyCashflow[]>(`/statistics/cashflow?${queryString}`),
    enabled: enabled && accountIds.length > 0,
    staleTime: 30_000,
  })
}

export function useNetSavingsStats(
  accountIds: number[],
  filters: StatsFilters,
  categories: TransactionCategory[],
  typeFilters: StatsTypeFilters = {},
  enabled: boolean = true,
) {
  const queryString = buildStatsQueryString(accountIds, filters, { ...typeFilters }, categories)
  return useQuery({
    queryKey: statisticsQueryKeys.netSavings(accountIds, filters, categories, typeFilters),
    queryFn: () => api<MonthlyNetSavings[]>(`/statistics/net-savings?${queryString}`),
    enabled: enabled && accountIds.length > 0,
    staleTime: 30_000,
  })
}

export function useOtherPartyStats(
  accountIds: number[],
  filters: StatsFilters,
  direction: StatsDirection,
  categories: TransactionCategory[],
  typeFilters: StatsTypeFilters = {},
  enabled: boolean = true,
) {
  const queryString = buildStatsQueryString(
    accountIds,
    filters,
    { direction, ...typeFilters },
    categories,
  )
  return useQuery({
    queryKey: statisticsQueryKeys.otherParties(
      accountIds,
      filters,
      direction,
      categories,
      typeFilters,
    ),
    queryFn: () => api<OtherPartySlice[]>(`/statistics/other-parties?${queryString}`),
    enabled: enabled && accountIds.length > 0,
    staleTime: 30_000,
  })
}

export function useNetWorthStats(
  accountIds: number[],
  filters: StatsFilters,
  enabled: boolean = true,
) {
  const queryString = buildStatsQueryString(accountIds, filters, {}, [])
  return useQuery({
    queryKey: statisticsQueryKeys.netWorth(accountIds, filters),
    queryFn: () => api<NetWorthResponse>(`/statistics/net-worth?${queryString}`),
    enabled: enabled && accountIds.length > 0,
    staleTime: 30_000,
  })
}

export function useNetWorthRange(start: string, end: string, accountIds: number[]) {
  const params = new URLSearchParams()
  params.append('start', start)
  params.append('end', end)
  for (const accountId of accountIds) {
    params.append('account_ids', String(accountId))
  }
  return useQuery({
    queryKey: statisticsQueryKeys.netWorthRange(start, end, accountIds),
    queryFn: () => api<NetWorthRangeResponse>(`/statistics/net-worth/range?${params.toString()}`),
    enabled: accountIds.length > 0 && start.length > 0 && end.length > 0,
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

export function paletteColor(index: number): string {
  return CHART_PALETTE[index % CHART_PALETTE.length]
}

export function sliceColor(category: TransactionCategory | 'OTHER', index: number): string {
  return category === 'OTHER' ? OTHER_COLOR : paletteColor(index)
}
