import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/account/$accountId/transactions/$transactionId')({
  component: TransactionDetailPage,
})

function TransactionDetailPage() {
  const { accountId, transactionId } = Route.useParams()
  return (
    <main className="mx-auto max-w-2xl p-4">
      <h1 className="text-2xl font-semibold">Transaction {transactionId}</h1>
      <p className="text-muted-foreground mt-2 text-sm">Account {accountId} — TODO</p>
    </main>
  )
}
