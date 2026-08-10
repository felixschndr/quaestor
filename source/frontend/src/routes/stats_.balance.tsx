import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

import { AccountBalancesPage } from '@/pages/stats_.balance'
import { oneOrMany } from '@/lib/searchParams'

const searchParamsSchema = z.object({
  account_ids: oneOrMany(z.coerce.number()).optional(),
})

export const Route = createFileRoute('/stats_/balance')({
  component: AccountBalancesPage,
  validateSearch: (search) => searchParamsSchema.parse(search),
})
