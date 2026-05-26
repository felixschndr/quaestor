import { Outlet, createRootRouteWithContext } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { Toaster } from 'sonner'
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { QueryClient } from '@tanstack/react-query'

import { ensureAuthenticated } from '@/lib/auth'

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient
}>()({
  beforeLoad: ({ context, location }) =>
    ensureAuthenticated({
      queryClient: context.queryClient,
      pathname: location.pathname,
      search: location.searchStr,
    }),
  component: RootComponent,
  pendingComponent: LoadingScreen,
})

function RootComponent() {
  return (
    <>
      <Outlet />
      <Toaster position="bottom-center" theme="dark" richColors />
      {import.meta.env.DEV && (
        <>
          <TanStackRouterDevtools position="bottom-right" />
          <ReactQueryDevtools buttonPosition="bottom-left" />
        </>
      )}
    </>
  )
}

export function LoadingScreen() {
  const { t } = useTranslation()
  const label = t('common.loading')
  return (
    <main
      role="status"
      aria-live="polite"
      aria-label={label}
      className="flex min-h-screen items-center justify-center"
    >
      <Loader2 className="text-primary size-8 animate-spin" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </main>
  )
}
