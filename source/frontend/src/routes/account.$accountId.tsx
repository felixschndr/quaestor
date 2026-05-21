import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/account/$accountId')({
  component: AccountDetailPage,
})

function AccountDetailPage() {
  const { accountId } = Route.useParams()
  return (
    <main className="mx-auto max-w-2xl p-4">
      <h1 className="text-2xl font-semibold">Account {accountId}</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        TODO: balance, transactions, infinite scroll
      </p>
    </main>
  )
}
