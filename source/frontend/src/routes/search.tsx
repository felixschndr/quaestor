import { useCallback } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'

import { useAuthMe } from '@/lib/auth'
import { type TransactionFilters } from '@/lib/transactionSearch'
import {
  transactionSearchParamsSchema,
  type TransactionSortKey,
} from '@/lib/transactionSearchParams'
import { TransactionSearchView, nextSearchParams } from '@/pages/search'

export const Route = createFileRoute('/search')({
  component: GlobalTransactionSearchPage,
  validateSearch: (search) => transactionSearchParamsSchema.parse(search),
})

function GlobalTransactionSearchPage() {
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const { data: user } = useAuthMe()

  const onChange = useCallback(
    (payload: { accountIds: number[]; filters: TransactionFilters }) => {
      navigate({
        search: nextSearchParams(payload, search, user?.credentials ?? []),
        replace: true,
      })
    },
    [navigate, user, search],
  )

  const onSortChange = useCallback(
    (sort: TransactionSortKey) => {
      navigate({
        search: { ...search, sort: sort === 'date_desc' ? undefined : sort },
        replace: true,
      })
    },
    [navigate, search],
  )

  if (!user) return null

  return (
    <TransactionSearchView
      credentials={user.credentials}
      search={search}
      onChange={onChange}
      onSortChange={onSortChange}
    />
  )
}
