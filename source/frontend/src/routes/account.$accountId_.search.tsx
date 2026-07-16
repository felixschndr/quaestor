import { useCallback } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { z } from 'zod'

import { useAuthMe, type CredentialRead } from '@/lib/auth'
import { TRANSACTION_CATEGORIES, TRANSACTION_TYPES } from '@/lib/transaction'
import { type TransactionFilters } from '@/lib/transactionSearch'
import { TransactionSearchView } from '@/pages/account.$accountId_.search'
import { oneOrMany } from '@/lib/searchParams'

const searchParamsSchema = z.object({
  text: z.string().optional(),
  amount_from: z.coerce.number().optional(),
  amount_to: z.coerce.number().optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  transaction_types: oneOrMany(z.enum(TRANSACTION_TYPES)).optional(),
  categories: oneOrMany(z.enum(TRANSACTION_CATEGORIES)).optional(),
  linked: z.enum(['linked', 'unlinked']).optional(),
  account_ids: oneOrMany(z.coerce.number()).optional(),
  link_account_id: z.coerce.number().optional(),
  link_transaction_id: z.coerce.number().optional(),
})

export type TransactionSearchParams = z.infer<typeof searchParamsSchema>

export const Route = createFileRoute('/account/$accountId_/search')({
  component: TransactionSearchPage,
  validateSearch: (search) => searchParamsSchema.parse(search),
})

function TransactionSearchPage() {
  const { accountId: rawId } = Route.useParams()
  const accountId = Number(rawId)
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const { data: user } = useAuthMe()

  const onChange = useCallback(
    ({ accountIds, filters }: { accountIds: number[]; filters: TransactionFilters }) =>
      navigate({
        search: {
          ...filters,
          account_ids: accountIds,
          link_account_id: search.link_account_id,
          link_transaction_id: search.link_transaction_id,
        } as TransactionSearchParams,
        replace: true,
      }),
    [navigate, search.link_account_id, search.link_transaction_id],
  )

  if (!user) return null // root guard already redirected

  return (
    <TransactionSearchView
      anchorAccountId={accountId}
      credentials={user.credentials}
      search={search}
      onChange={onChange}
    />
  )
}

export interface TransactionSearchViewProps {
  anchorAccountId: number
  credentials: CredentialRead[]
  search: TransactionSearchParams
  onChange: (payload: { accountIds: number[]; filters: TransactionFilters }) => void
}
