import { createFileRoute, useRouter } from '@tanstack/react-router'

import { useSupportedBanks } from '@/lib/credentials'
import { NewCredentialFormView } from '@/pages/settings.credentials.new.$bank'

export const Route = createFileRoute('/settings/credentials/new/$bank')({
  component: NewCredentialFormPage,
})

function NewCredentialFormPage() {
  const { bank: bankKey } = Route.useParams()
  const banks = useSupportedBanks()
  const router = useRouter()
  const matched = banks.data?.find((b) => b.key === bankKey)

  return (
    <NewCredentialFormView
      bankKey={bankKey}
      bank={matched}
      isLoading={banks.isLoading}
      onCancel={() => router.history.push('/settings/credentials')}
      // Manual credentials land empty (no accounts yet) and need a follow-up
      // visit to /settings/credentials/<id> to add accounts. Synced credentials
      // already have accounts after sync, so jump straight to the overview.
      onConnected={(credentialId) =>
        router.history.push(bankKey === 'manual' ? `/settings/credentials/${credentialId}` : '/')
      }
      onSyncFailed={() => router.history.push('/settings/credentials')}
    />
  )
}
