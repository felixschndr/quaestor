import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/')({
  component: SettingsIndexPage,
})

function SettingsIndexPage() {
  return (
    <main className="mx-auto max-w-2xl p-4">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        TODO: user, credentials, sessions, logout
      </p>
    </main>
  )
}
