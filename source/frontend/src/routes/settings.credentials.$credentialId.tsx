import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/credentials/$credentialId')({
  component: CredentialDetailPage,
})

function CredentialDetailPage() {
  const { credentialId } = Route.useParams()
  return (
    <main className="mx-auto max-w-2xl p-4">
      <h1 className="text-2xl font-semibold">Credential {credentialId}</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        TODO: account list with balance_factor editor
      </p>
    </main>
  )
}
