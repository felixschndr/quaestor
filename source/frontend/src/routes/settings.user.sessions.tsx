import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/user/sessions')({
  component: SettingsSessionsPage,
})

function SettingsSessionsPage() {
  return (
    <main className="mx-auto max-w-2xl p-4">
      <h1 className="text-2xl font-semibold">Sessions</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        TODO: list, revoke, sign out everywhere else
      </p>
    </main>
  )
}
