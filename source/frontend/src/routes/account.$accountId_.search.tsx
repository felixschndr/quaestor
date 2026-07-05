import { useCallback } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { z } from 'zod'

import { useAuthMe, type CredentialRead } from '@/lib/auth'
import { TRANSACTION_CATEGORIES, TRANSACTION_TYPES } from '@/lib/transaction'
import { type TransactionFilters } from '@/lib/transactionSearch'
import { TransactionSearchView } from '@/pages/account.$accountId_.search'

const searchParamsSchema = z.object({
  text: z.string().optional(),
  amount_from: z.coerce.number().optional(),
  amount_to: z.coerce.number().optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  transaction_types: z
    .union([z.enum(TRANSACTION_TYPES), z.array(z.enum(TRANSACTION_TYPES))])
    .transform((value) => (Array.isArray(value) ? value : [value]))
    .optional(),
  categories: z
    .union([z.enum(TRANSACTION_CATEGORIES), z.array(z.enum(TRANSACTION_CATEGORIES))])
    .transform((value) => (Array.isArray(value) ? value : [value]))
    .optional(),
  linked: z.enum(['linked', 'unlinked']).optional(),
  account_ids: z
    .union([z.array(z.coerce.number()), z.coerce.number()])
    .transform((value) => (Array.isArray(value) ? value : [value]))
    .optional(),
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
        search: { ...filters, account_ids: accountIds } as TransactionSearchParams,
        replace: true,
      }),
    [navigate],
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
