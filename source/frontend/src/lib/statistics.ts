import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  differenceInCalendarDays,
  differenceInCalendarMonths,
  eachDayOfInterval,
  eachMonthOfInterval,
  eachWeekOfInterval,
  endOfMonth,
  format,
  parseISO,
  subDays,
  subMonths,
  subWeeks,
  subYears,
} from 'date-fns'

import { api } from './api'
import type { TransactionRead } from './accountHistory'
import {
  TRANSACTION_CATEGORIES,
  type TransactionCategory,
  type TransactionType,
} from './transaction'
import { accountScopedParams } from '@/lib/searchParams'

export const statisticsQueryKeys = {
  all: ['statistics'] as const,
}

export type StatsDirection = 'INCOMING' | 'OUTGOING'

export type ChartType = 'bar' | 'pie' | 'trend'

export interface StatsFilters {
  date_from?: string // ISO yyyy-mm-dd
  date_to?: string
}

export interface StatsTypeFilters {
  transaction_types?: TransactionType[]
}

export const FILTERABLE_CATEGORIES: TransactionCategory[] = [...TRANSACTION_CATEGORIES]

export const RUNWAY_EXCLUDED_CATEGORIES: TransactionCategory[] = ['INVESTMENT', 'SAVINGS']

export interface CategorySlice {
  category: TransactionCategory
  total: number
}

export interface CategoryTrendSlice {
  category: TransactionCategory
  current: number
  baseline: number
}

export interface MonthlyCashflow {
  month: string // "YYYY-MM"
  income: number
  expenses: number
}

const DAYS_PER_MONTH = 365.25 / 12

export function averageMonthlyExpenses(
  cashflow: MonthlyCashflow[],
  dateFrom?: string,
  dateTo?: string,
): number {
  const total = cashflow.reduce((sum, month) => sum + month.expenses, 0)
  if (dateFrom && dateTo) {
    const days = differenceInCalendarDays(parseISO(dateTo), parseISO(dateFrom)) + 1
    if (days > 0) return total / (days / DAYS_PER_MONTH)
  }
  return cashflow.length > 0 ? total / cashflow.length : 0
}

export function averageMonthlyIncome(cashflow: MonthlyCashflow[]): number {
  if (cashflow.length === 0) return 0
  return cashflow.reduce((sum, month) => sum + month.income, 0) / cashflow.length
}

export function runwayMonths(balance: number, avgMonthlyExpenses: number): number | null {
  if (avgMonthlyExpenses <= 0) return null
  return Math.max(0, balance / avgMonthlyExpenses)
}

export function fixedCostRatio(monthlyContracts: number, avgMonthlyIncome: number): number | null {
  if (avgMonthlyIncome <= 0) return null
  return monthlyContracts / avgMonthlyIncome
}

export function runwayYearsMonths(totalMonths: number): { years: number; months: number } {
  const whole = Math.round(totalMonths)
  return { years: Math.floor(whole / 12), months: whole % 12 }
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

export type TransactionCountsGroupBy = 'day' | 'week' | 'month' | 'weekday'

export const TRANSACTION_COUNT_GROUPINGS: readonly TransactionCountsGroupBy[] = [
  'day',
  'week',
  'month',
  'weekday',
]

export interface TransactionCountBucket {
  bucket: string
  count: number
  amount: number
}

export type TransactionCountMetric = 'count' | 'amount'

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

export type DateRangePreset = '2w' | '1m' | '3m' | '6m' | '1y' | '3y'

export const DATE_RANGE_PRESETS: readonly DateRangePreset[] = ['2w', '1m', '3m', '6m', '1y', '3y']

export type DetailRangePreset = '1d' | '3d' | '1w' | '2w' | '1m'

export const DETAIL_RANGE_PRESETS: readonly DetailRangePreset[] = ['1d', '3d', '1w', '2w', '1m']

const formatDay = (date: Date): string => format(date, 'yyyy-MM-dd')

const PRESET_START: Record<DateRangePreset | DetailRangePreset, (end: Date) => Date> = {
  '1d': (end) => subDays(end, 1),
  '3d': (end) => subDays(end, 3),
  '1w': (end) => subWeeks(end, 1),
  '2w': (end) => subWeeks(end, 2),
  '1m': (end) => subMonths(end, 1),
  '3m': (end) => subMonths(end, 3),
  '6m': (end) => subMonths(end, 6),
  '1y': (end) => subYears(end, 1),
  '3y': (end) => subYears(end, 3),
}

function matchPreset<P extends DateRangePreset | DetailRangePreset>(
  presets: readonly P[],
  from: string,
  to: string,
  today: Date,
): P | null {
  if (formatDay(today) !== to) return null
  return presets.find((preset) => formatDay(PRESET_START[preset](today)) === from) ?? null
}

export function presetDateRange(
  preset: DateRangePreset,
  today: Date = new Date(),
): Required<StatsFilters> {
  return {
    date_from: formatDay(PRESET_START[preset](today)),
    date_to: formatDay(today),
  }
}

export function baselineDateRange(
  dateFrom: string,
  dateTo: string,
  periods: number,
): { from: string; to: string } {
  const from = parseISO(dateFrom)
  const windowSpanDays = differenceInCalendarDays(parseISO(dateTo), from) + 1
  return {
    from: formatDay(subDays(from, windowSpanDays * periods)),
    to: formatDay(subDays(from, 1)),
  }
}

export type BaselineRangeUnit = 'weeks' | 'months' | 'days'

export interface BaselineRangeDescriptor {
  unit: BaselineRangeUnit
  len: number
  periods: number
  totalDays: number
}

export function baselineRangeDescriptor(
  dateFrom: string,
  dateTo: string,
  periods: number,
): BaselineRangeDescriptor {
  const from = parseISO(dateFrom)
  const to = parseISO(dateTo)
  const days = differenceInCalendarDays(to, from)
  const months = differenceInCalendarMonths(to, from)
  if (months >= 1 && formatDay(subMonths(to, months)) === dateFrom) {
    return { unit: 'months', len: months, periods, totalDays: 0 }
  }
  if (days >= 7 && days % 7 === 0) {
    return { unit: 'weeks', len: days / 7, periods, totalDays: 0 }
  }
  return { unit: 'days', len: days, periods, totalDays: days * periods }
}

export function monthDateRange(month: string): { from: string; to: string } {
  const start = parseISO(`${month}-01`)
  return { from: formatDay(start), to: formatDay(endOfMonth(start)) }
}

export function detailPresetRange(
  preset: DetailRangePreset,
  today: Date = new Date(),
): { start: string; end: string } {
  return {
    start: formatDay(PRESET_START[preset](today)),
    end: formatDay(today),
  }
}

export function matchingDetailPreset(
  start: string,
  end: string,
  today: Date = new Date(),
): DetailRangePreset | null {
  return matchPreset(DETAIL_RANGE_PRESETS, start, end, today)
}

export function defaultStatsDateRange(today: Date = new Date()): Required<StatsFilters> {
  return presetDateRange('1m', today)
}

export function matchingPreset(
  filters: StatsFilters,
  today: Date = new Date(),
): DateRangePreset | null {
  if (!filters.date_from || !filters.date_to) return null
  return matchPreset(DATE_RANGE_PRESETS, filters.date_from, filters.date_to, today)
}

export function buildStatsQueryString(
  accountIds: number[],
  filters: StatsFilters,
  extra: Record<string, string | number | string[] | undefined> = {},
  categories: TransactionCategory[] = [],
): string {
  return accountScopedParams(accountIds, { categories, ...filters, ...extra }).toString()
}

const sortedIds = (accountIds: number[]) => [...accountIds].sort((a, b) => a - b)
const sortedCategories = (categories: TransactionCategory[]) => [...categories].sort()

function useStats<T>(args: {
  path: string
  accountIds: number[]
  filters: StatsFilters
  categories?: TransactionCategory[]
  typeFilters?: StatsTypeFilters
  extra?: Record<string, string | number | string[] | undefined>
  enabled?: boolean
}) {
  const { path, accountIds, filters, categories = [], typeFilters = {}, extra = {} } = args
  const queryString = buildStatsQueryString(
    accountIds,
    filters,
    { ...extra, ...typeFilters },
    categories,
  )
  return useQuery({
    queryKey: [
      ...statisticsQueryKeys.all,
      path,
      sortedIds(accountIds),
      filters,
      sortedCategories(categories),
      typeFilters,
      extra,
    ],
    queryFn: () => api<T>(`/statistics/${path}?${queryString}`),
    enabled: (args.enabled ?? true) && accountIds.length > 0,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  })
}

export function showsStaleData(query: {
  isFetching: boolean
  isPlaceholderData: boolean
}): boolean {
  return query.isFetching && query.isPlaceholderData
}

export function useCategoryStats(
  accountIds: number[],
  filters: StatsFilters,
  direction: StatsDirection,
  categories: TransactionCategory[],
  typeFilters: StatsTypeFilters = {},
  enabled: boolean = true,
) {
  return useStats<CategorySlice[]>({
    path: 'categories',
    accountIds,
    filters,
    categories,
    typeFilters,
    extra: { direction },
    enabled,
  })
}

export const TREND_PERIOD_OPTIONS: readonly number[] = [3, 6, 12]

export const DEFAULT_TREND_PERIODS = 6

export function useCategoryTrendStats(
  accountIds: number[],
  filters: StatsFilters,
  direction: StatsDirection,
  categories: TransactionCategory[],
  baselineWindows: number,
  typeFilters: StatsTypeFilters = {},
  enabled: boolean = true,
) {
  return useStats<CategoryTrendSlice[]>({
    path: 'categories/trend',
    accountIds,
    filters,
    categories,
    typeFilters,
    extra: { direction, baseline_windows: baselineWindows },
    enabled,
  })
}

export function useCashflowStats(
  accountIds: number[],
  filters: StatsFilters,
  categories: TransactionCategory[],
  typeFilters: StatsTypeFilters = {},
  enabled: boolean = true,
) {
  return useStats<MonthlyCashflow[]>({
    path: 'cashflow',
    accountIds,
    filters,
    categories,
    typeFilters,
    enabled,
  })
}

export function useNetSavingsStats(
  accountIds: number[],
  filters: StatsFilters,
  categories: TransactionCategory[],
  typeFilters: StatsTypeFilters = {},
  enabled: boolean = true,
) {
  return useStats<MonthlyNetSavings[]>({
    path: 'net-savings',
    accountIds,
    filters,
    categories,
    typeFilters,
    enabled,
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
  return useStats<OtherPartySlice[]>({
    path: 'other-parties',
    accountIds,
    filters,
    categories,
    typeFilters,
    extra: { direction },
    enabled,
  })
}

export function useTransactionCountStats(
  accountIds: number[],
  filters: StatsFilters,
  categories: TransactionCategory[],
  typeFilters: StatsTypeFilters,
  groupBy: TransactionCountsGroupBy,
  enabled: boolean = true,
) {
  return useStats<TransactionCountBucket[]>({
    path: 'transaction-counts',
    accountIds,
    filters,
    categories,
    typeFilters,
    extra: { group_by: groupBy },
    enabled,
  })
}

export function useNetWorthStats(
  accountIds: number[],
  filters: StatsFilters,
  enabled: boolean = true,
  applyFactor: boolean = true,
) {
  return useStats<NetWorthResponse>({
    path: 'net-worth',
    accountIds,
    filters,
    extra: applyFactor ? {} : { apply_factor: 'false' },
    enabled,
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
    queryKey: [...statisticsQueryKeys.all, 'net-worth', 'range', start, end, sortedIds(accountIds)],
    queryFn: () => api<NetWorthRangeResponse>(`/statistics/net-worth/range?${params.toString()}`),
    enabled: accountIds.length > 0 && start.length > 0 && end.length > 0,
    staleTime: 30_000,
  })
}

// Weekday buckets in display order (Monday-first); values are SQLite %w numbers.
export const WEEKDAY_BUCKETS: readonly string[] = ['1', '2', '3', '4', '5', '6', '0']

export function fillTransactionCountBuckets(
  data: TransactionCountBucket[],
  groupBy: TransactionCountsGroupBy,
  dateFrom?: string,
  dateTo?: string,
): TransactionCountBucket[] {
  const byBucket = new Map(data.map((entry) => [entry.bucket, entry]))
  const at = (bucket: string): TransactionCountBucket =>
    byBucket.get(bucket) ?? { bucket, count: 0, amount: 0 }
  if (groupBy === 'weekday') {
    return WEEKDAY_BUCKETS.map(at)
  }
  // The backend returns buckets sorted ascending, so the extent is first/last.
  const start = dateFrom ?? data[0]?.bucket
  const end = dateTo ?? data[data.length - 1]?.bucket
  if (!start || !end) return []
  const interval = { start: parseISO(start), end: parseISO(end) }
  if (interval.start > interval.end) return []
  const buckets =
    groupBy === 'day'
      ? eachDayOfInterval(interval).map((day) => format(day, 'yyyy-MM-dd'))
      : groupBy === 'week'
        ? eachWeekOfInterval(interval, { weekStartsOn: 1 }).map((day) => format(day, 'yyyy-MM-dd'))
        : eachMonthOfInterval(interval).map((day) => format(day, 'yyyy-MM'))
  return buckets.map(at)
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

const CHART_PALETTE = Array.from({ length: 12 }, (_, i) => `var(--chart-${i + 1})`)

const OTHER_COLOR = 'var(--chart-other)'

export function paletteColor(index: number): string {
  return CHART_PALETTE[index % CHART_PALETTE.length]
}

const CATEGORY_COLORS: Record<TransactionCategory, string> = {
  SALARY: CHART_PALETTE[2],
  ALLOWANCE: CHART_PALETTE[10],
  PENSION: CHART_PALETTE[4],
  SIDE_INCOME: CHART_PALETTE[9],
  REIMBURSEMENT: CHART_PALETTE[0],
  INTEREST: CHART_PALETTE[6],
  INVESTMENT: CHART_PALETTE[3],
  RENT: CHART_PALETTE[0],
  UTILITIES: CHART_PALETTE[9],
  SUPERMARKET: CHART_PALETTE[2],
  ONLINE_SHOPPING: CHART_PALETTE[1],
  RESTAURANTS: CHART_PALETTE[11],
  FUEL: CHART_PALETTE[5],
  SUBSCRIPTIONS: CHART_PALETTE[6],
  ENTERTAINMENT: CHART_PALETTE[3],
  TRAVEL: CHART_PALETTE[4],
  FITNESS: CHART_PALETTE[10],
  CLOTHING: CHART_PALETTE[8],
  DRUGSTORE: CHART_PALETTE[7],
  PERSONAL_CARE: CHART_PALETTE[3],
  GIFTS: CHART_PALETTE[8],
  FEES: CHART_PALETTE[5],
  SAVINGS: CHART_PALETTE[4],
  WITHDRAWAL: CHART_PALETTE[11],
  DEPOSIT: CHART_PALETTE[10],
  TRANSFER: CHART_PALETTE[0],
  UNKNOWN: OTHER_COLOR,
}

export function sliceColor(category: TransactionCategory | 'OTHER'): string {
  return category === 'OTHER' ? OTHER_COLOR : CATEGORY_COLORS[category]
}
