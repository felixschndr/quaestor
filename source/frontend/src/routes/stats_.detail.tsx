import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

import { NetWorthDetailPage } from '@/pages/stats_.detail'

const idListSchema = z
  .union([z.array(z.coerce.number()), z.coerce.number()])
  .transform((value) => (Array.isArray(value) ? value : [value]))
  .optional()

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
