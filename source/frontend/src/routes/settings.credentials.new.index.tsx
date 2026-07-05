import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { z } from 'zod'

import { useAuthMe } from '@/lib/auth'
import { useSupportedBanks } from '@/lib/credentials'
import { BankPickerView } from '@/pages/settings.credentials.new.index'

// The picker's navigation state lives in the URL so browser back/forward works and the
// search survives a round-trip to a bank's form: `q` is the top-level search, `family` the
// drilled-into group, `fq` the search within that group.
const pickerSearchSchema = z.object({
  q: z.string().optional(),
  family: z.string().optional(),
  fq: z.string().optional(),
})

export const Route = createFileRoute('/settings/credentials/new/')({
  component: BankPickerPage,
  validateSearch: (search) => pickerSearchSchema.parse(search),
})

function BankPickerPage() {
  const banks = useSupportedBanks()
  const { data: user } = useAuthMe()
  const { q, family, fq } = Route.useSearch()
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
      family={family ?? null}
      familyQuery={fq ?? ''}
      // Typing replaces the current entry (no history spam); opening/closing a group pushes
      // one, so browser back collapses the group instead of leaving the picker.
      onSearch={(value) =>
        navigate({ search: (prev) => ({ ...prev, q: value || undefined }), replace: true })
      }
      // Carry the top-level query into the group so a search that surfaced a member is
      // still applied after drilling in (the user can clear it there if they want).
      onOpenFamily={(slug) =>
        navigate({ search: (prev) => ({ ...prev, family: slug, fq: prev.q || undefined }) })
      }
      onCloseFamily={() =>
        navigate({ search: (prev) => ({ ...prev, family: undefined, fq: undefined }) })
      }
      onFamilySearch={(value) =>
        navigate({ search: (prev) => ({ ...prev, fq: value || undefined }), replace: true })
      }
    />
  )
}
