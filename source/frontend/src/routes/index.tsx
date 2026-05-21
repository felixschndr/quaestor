import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: OverviewPage,
})

function OverviewPage() {
  return (
    <main className="mx-auto max-w-2xl p-4">
      <h1 className="text-2xl font-semibold">Overview</h1>
      <p className="text-muted-foreground mt-2 text-sm">TODO: hello, total balance, accounts</p>
    </main>
  )
}
