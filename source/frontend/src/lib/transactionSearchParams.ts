import { z } from 'zod'

import { TRANSACTION_CATEGORIES, TRANSACTION_TYPES } from './transaction'
import { oneOrMany } from './searchParams'

export const TRANSACTION_SORT_KEYS = [
  'date_desc',
  'date_asc',
  'amount_desc',
  'amount_asc',
  'amount_abs_desc',
  'amount_abs_asc',
] as const

export type TransactionSortKey = (typeof TRANSACTION_SORT_KEYS)[number]

export const transactionSearchParamsSchema = z.object({
  text: z.string().optional(),
  amount_from: z.coerce.number().optional(),
  amount_to: z.coerce.number().optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  transaction_types: oneOrMany(z.enum(TRANSACTION_TYPES)).optional(),
  categories: oneOrMany(z.enum(TRANSACTION_CATEGORIES)).optional(),
  linked: z.enum(['linked', 'unlinked', 'none']).optional(),
  has_attachment: z.enum(['with', 'without', 'none']).optional(),
  account_ids: oneOrMany(z.coerce.number()).optional(),
  link_account_id: z.coerce.number().optional(),
  link_transaction_id: z.coerce.number().optional(),
  sort: z.enum(TRANSACTION_SORT_KEYS).optional(),
})

export type TransactionSearchParams = z.infer<typeof transactionSearchParamsSchema>
