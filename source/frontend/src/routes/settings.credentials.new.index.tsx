import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { z } from 'zod'

import { useAuthMe } from '@/lib/auth'
import { useSupportedBanks } from '@/lib/credentials'
import { BankPickerView } from '@/pages/settings.credentials.new.index'

const pickerSearchSchema = z.object({
  q: z.string().optional(),
})

export const Route = createFileRoute('/settings/credentials/new/')({
  component: BankPickerPage,
  validateSearch: (search) => pickerSearchSchema.parse(search),
})

function BankPickerPage() {
  const banks = useSupportedBanks()
  const { data: user } = useAuthMe()
  const { q } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })

  const existingAccountCounts: Record<string, number> = {}
  for (const credential of user?.credentials ?? []) {
    existingAccountCounts[credential.bank] =
      (existingAccountCounts[credential.bank] ?? 0) + credential.accounts.length
  }

  return (
    <BankPickerView
      isLoading={banks.isLoading}
      isError={banks.isError}
      banks={banks.data ?? []}
      existingAccountCounts={existingAccountCounts}
      query={q ?? ''}
      onSearch={(value) =>
        navigate({ search: (prev) => ({ ...prev, q: value || undefined }), replace: true })
      }
    />
  )
}
