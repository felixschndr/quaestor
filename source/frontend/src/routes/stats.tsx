import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { z } from 'zod'

import { useAuthMe, type CredentialRead } from '@/lib/auth'
import { defaultAccountIds, sameAccountSelection } from '@/lib/accounts'
import {
  TRANSACTION_CATEGORIES,
  TRANSACTION_TYPES,
  type TransactionCategory,
  type TransactionType,
} from '@/lib/transaction'
import {
  FILTERABLE_CATEGORIES,
  type ChartType,
  type StatsDirection,
  type StatsFilters,
  type StatsLinked,
  type TransactionCountsGroupBy,
} from '@/lib/statistics'
import { StatsView } from '@/pages/stats'
import { oneOrMany } from '@/lib/searchParams'

const hiddenCategorySchema = z.enum([...TRANSACTION_CATEGORIES, 'OTHER'] as const)

const searchParamsSchema = z.object({
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  chart_type: z.enum(['bar', 'pie', 'trend']).optional(),
  count_group: z.enum(['day', 'week', 'month', 'weekday']).optional(),
  trend_periods: z.coerce.number().int().positive().optional(),
  direction: z.enum(['INCOMING', 'OUTGOING']).optional(),
  transaction_types: oneOrMany(z.enum(TRANSACTION_TYPES)).optional(),
  linked: z.enum(['linked', 'unlinked', 'any', 'none']).optional(),
  account_ids: oneOrMany(z.coerce.number()).optional(),
  categories: oneOrMany(z.enum(TRANSACTION_CATEGORIES)).optional(),
  hidden_categories: oneOrMany(hiddenCategorySchema).optional(),
  hidden_parties: oneOrMany(z.coerce.string()).optional(),
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

  const defaultIds = defaultAccountIds(user.credentials)

  return (
    <StatsView
      credentials={user.credentials}
      search={search}
      onChange={(next) =>
        navigate({
          search: {
            account_ids: sameAccountSelection(next.accountIds, defaultIds)
              ? undefined
              : next.accountIds,
            date_from: next.filters.date_from,
            date_to: next.filters.date_to,
            chart_type: next.chartType,
            count_group: next.countGroup,
            trend_periods: next.trendPeriods,
            direction: next.direction,
            transaction_types:
              next.transactionTypes.length === TRANSACTION_TYPES.length
                ? undefined
                : next.transactionTypes,
            linked:
              next.linked === undefined
                ? 'any'
                : next.linked === 'unlinked'
                  ? undefined
                  : next.linked,
            categories:
              next.categories.length === FILTERABLE_CATEGORIES.length ? undefined : next.categories,
            hidden_categories: next.hiddenCategories.length ? next.hiddenCategories : undefined,
            hidden_parties: next.hiddenParties.length ? next.hiddenParties : undefined,
          },
          replace: true,
          resetScroll: false,
        })
      }
      onOpenSearch={(drill) => {
        navigate({
          to: '/search',
          search: {
            account_ids: drill.accountIds,
            date_from: drill.dateFrom,
            date_to: drill.dateTo,
            categories: drill.categories?.length ? drill.categories : undefined,
            text: drill.text,
            transaction_types: drill.transactionTypes?.length ? drill.transactionTypes : undefined,
            linked: drill.linked,
            amount_from: drill.direction === 'INCOMING' ? 0 : undefined,
            amount_to: drill.direction === 'OUTGOING' ? 0 : undefined,
          },
        })
      }}
      onOpenDay={(date, accountIds) =>
        navigate({
          to: '/stats/detail',
          search: { end: date, account_ids: accountIds },
        })
      }
    />
  )
}

export interface StatsViewState {
  accountIds: number[]
  filters: StatsFilters
  chartType: ChartType
  countGroup: TransactionCountsGroupBy
  trendPeriods: number
  direction: StatsDirection
  categories: TransactionCategory[]
  transactionTypes: TransactionType[]
  linked?: StatsLinked
  hiddenCategories: Array<TransactionCategory | 'OTHER'>
  hiddenParties: string[]
}

export interface StatsDrilldown {
  accountIds: number[]
  dateFrom?: string
  dateTo?: string
  direction?: StatsDirection
  categories?: TransactionCategory[]
  text?: string
  transactionTypes?: TransactionType[]
  linked?: StatsLinked
}

export interface StatsViewProps {
  credentials: CredentialRead[]
  search: StatsSearchParams
  onChange: (next: StatsViewState) => void
  onOpenSearch: (drill: StatsDrilldown) => void
  onOpenDay: (date: string, accountIds: number[]) => void
}
