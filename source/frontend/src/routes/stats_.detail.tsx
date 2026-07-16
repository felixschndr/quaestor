import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

import { NetWorthDetailPage } from '@/pages/stats_.detail'
import { oneOrMany } from '@/lib/searchParams'

const idListSchema = oneOrMany(z.coerce.number()).optional()

const searchParamsSchema = z.object({
  start: z.string().optional(),
  end: z.string().optional(),
  account_ids: idListSchema,
  expanded: idListSchema,
})

export const Route = createFileRoute('/stats_/detail')({
  component: NetWorthDetailPage,
  validateSearch: (search) => searchParamsSchema.parse(search),
})
