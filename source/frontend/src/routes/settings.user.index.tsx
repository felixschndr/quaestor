import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/user/')({
  component: SettingsUserPage,
})

function SettingsUserPage() {
  return (
    <main className="mx-auto max-w-2xl p-4">
      <h1 className="text-2xl font-semibold">User settings</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        TODO: display name, password, language, delete
      </p>
    </main>
  )
}
