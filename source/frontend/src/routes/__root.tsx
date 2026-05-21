import { Outlet, createRootRouteWithContext } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { Toaster } from 'sonner'
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
