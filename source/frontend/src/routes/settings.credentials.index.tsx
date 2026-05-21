import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/credentials/')({
  component: SettingsCredentialsPage,
})

function SettingsCredentialsPage() {
  return (
    <main className="mx-auto max-w-2xl p-4">
      <h1 className="text-2xl font-semibold">Credentials</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        TODO: list, add via bank picker, sync, delete
      </p>
    </main>
  )
}
