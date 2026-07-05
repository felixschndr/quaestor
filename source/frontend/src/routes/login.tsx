import { createFileRoute, useRouter } from '@tanstack/react-router'
import { z } from 'zod'

import { redirectIfAuthenticated } from '@/lib/auth'
import { LoginPageContent } from '@/pages/login'

const loginSearchSchema = z.object({
  next: z.string().optional(),
})

export const Route = createFileRoute('/login')({
  component: LoginPage,
  validateSearch: (search) => loginSearchSchema.parse(search),
  beforeLoad: async ({ context, search }) => {
    await redirectIfAuthenticated({ queryClient: context.queryClient, next: search.next })
  },
})

function LoginPage() {
  const { next } = Route.useSearch()
  const router = useRouter()
  return (
    <LoginPageContent
      next={next}
      // history.push accepts arbitrary in-app paths (e.g. /account/42/transactions/7)
      // that the typed navigate() API can't represent generically.
      onSuccess={(to) => router.history.push(to)}
    />
  )
}
