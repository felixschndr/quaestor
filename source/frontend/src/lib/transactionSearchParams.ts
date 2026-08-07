import { z } from 'zod'

import { TRANSACTION_CATEGORIES, TRANSACTION_TYPES } from './transaction'
import { oneOrMany } from './searchParams'

// Lives in its own module rather than in transactionSearch.ts: that file is
// imported by transaction.ts, so pulling the category/type constants back in
// there would form a cycle and leave the enums undefined at schema-build time.
//
// Shared by both entry points into the search view — the global /search route
// and the account-scoped /account/$accountId/search one.
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
})

export type TransactionSearchParams = z.infer<typeof transactionSearchParamsSchema>
