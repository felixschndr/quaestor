import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/login')({
  component: LoginPage,
})

function LoginPage() {
  return (
    <main className="mx-auto max-w-sm p-4">
      <h1 className="text-2xl font-semibold">Login</h1>
      <p className="text-muted-foreground mt-2 text-sm">TODO: login / register toggle</p>
    </main>
  )
}
